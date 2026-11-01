import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { DB } from '../domain/types';
import { TABLES, fromRow, toRow } from './schema';

/**
 * Supabase sync. The app keeps its in-memory store and all business rules; after every commit only the records
 * that changed are upserted (deletes run child-first). Unsent changes stay pending and retry automatically, and a
 * copy is kept in IndexedDB so the app works offline. Signed-in ACTIVE staff only (RLS in 0001_init.sql).
 * ponytail: whole-store JSON diff per commit is O(records); fine for one academy. Move hot paths to RPCs/realtime if it grows.
 * ponytail: last write wins across devices; receipt numbers come from a shared counter — move to a DB sequence if
 *           several desks record payments at the same second.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const sb: SupabaseClient | null = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
export const cloudEnabled = !!sb;

// ---------------- sync status (shown in the header) ----------------
export type SyncStatus = { state: 'off' | 'saving' | 'saved' | 'offline' | 'error'; message?: string; at?: number };
let status: SyncStatus = { state: cloudEnabled ? 'saved' : 'off' };
const listeners = new Set<() => void>();
const setStatus = (s: SyncStatus) => { status = s; listeners.forEach((l) => l()); };
export const getSyncStatus = () => status;
export const subscribeSync = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

// ---------------- auth ----------------
export async function getSession(): Promise<Session | null> { return sb ? (await sb.auth.getSession()).data.session : null; }
export async function signIn(email: string, password: string) {
  const { error } = await sb!.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
}
export async function signUp(email: string, password: string): Promise<'signed-in' | 'confirm-email'> {
  const { data, error } = await sb!.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: location.origin } });
  if (error) throw new Error(error.message);
  return data.session ? 'signed-in' : 'confirm-email';
}
export async function sendReset(email: string) {
  const { error } = await sb!.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin });
  if (error) throw new Error(error.message);
}
export async function signOutCloud() { await sb?.auth.signOut(); synced.clear(); syncedState = ''; }

// ---------------- pull ----------------
async function fetchAll(table: string) {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb!.from(table).select('*').order('id').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
/** Whole database for a signed-in staff member, or null when nothing has been set up yet. */
export async function pullAll(empty: () => DB): Promise<DB | null> {
  const [{ data: has, error }, stateRes, ...lists] = await Promise.all([
    sb!.rpc('has_employees'), sb!.from('app_state').select('*').maybeSingle(), ...TABLES.map((t) => fetchAll(t.table)),
  ]);
  if (error) throw new Error(error.message);
  if (!has) return null;
  const d = empty();
  TABLES.forEach((t, i) => { (d as unknown as Record<string, unknown[]>)[t.key] = lists[i].map((r) => fromRow(t, r)); });
  if (stateRes.data) { d.version = stateRes.data.version; d.settings = { ...d.settings, ...stateRes.data.settings }; d.counters = stateRes.data.counters ?? {}; }
  markSynced(d);
  return d;
}
export async function hasEmployees() { const { data, error } = await sb!.rpc('has_employees'); if (error) throw new Error(error.message); return !!data; }

// ---------------- push (diff since last successful sync) ----------------
const synced = new Map<string, Map<string, string>>(); // table → id → row JSON as last stored
let syncedState = '';
const stateRow = (d: DB) => ({ id: 1, version: d.version, settings: d.settings, counters: d.counters });
/** Nothing is in the cloud yet: the next push uploads every record. */
export function resetSynced() { synced.clear(); syncedState = ''; }
export function markSynced(d: DB) {
  synced.clear();
  for (const t of TABLES) synced.set(t.table, new Map((d[t.key] as unknown as Record<string, unknown>[]).map((r) => [String(r.id), JSON.stringify(toRow(t, r))])));
  syncedState = JSON.stringify(stateRow(d));
}

let latest: DB | null = null, lastTried: DB | null = null, running = false, retry: ReturnType<typeof setTimeout> | undefined;
/** Queue a sync of this snapshot; calls collapse so only the newest state is sent. */
export function pushSoon(d: DB) {
  if (!sb) return;
  latest = d;
  if (!running) void run();
}
async function run() {
  running = true;
  clearTimeout(retry);
  try {
    while (latest) {
      const d = latest; latest = null;
      await push(d);
    }
    setStatus({ state: 'saved', at: Date.now() });
  } catch (e) {
    const offline = !navigator.onLine || /fetch|network/i.test((e as Error).message);
    setStatus({ state: offline ? 'offline' : 'error', message: (e as Error).message });
    retry = setTimeout(() => { if (lastTried) pushSoon(lastTried); }, 15000); // the diff still holds every unsent change
  } finally { running = false; }
}
if (typeof window !== 'undefined') window.addEventListener('online', () => { if (lastTried) pushSoon(lastTried); });

async function push(d: DB) {
  lastTried = d;
  const ups: { t: (typeof TABLES)[number]; rows: Record<string, unknown>[]; json: Map<string, string> }[] = [];
  const dels: { table: string; ids: string[] }[] = [];
  for (const t of TABLES) {
    const prev = synced.get(t.table) ?? new Map<string, string>();
    const cur = new Map<string, string>(), rows: Record<string, unknown>[] = [];
    for (const r of d[t.key] as unknown as Record<string, unknown>[]) {
      const row = toRow(t, r), j = JSON.stringify(row), id = String(r.id);
      cur.set(id, j);
      if (prev.get(id) !== j) rows.push(row);
    }
    if (rows.length) ups.push({ t, rows, json: cur });
    const gone = [...prev.keys()].filter((id) => !cur.has(id));
    if (gone.length) dels.unshift({ table: t.table, ids: gone }); // children first
  }
  const state = JSON.stringify(stateRow(d));
  if (!ups.length && !dels.length && state === syncedState) return;
  setStatus({ state: 'saving' });

  for (const u of ups) {
    for (let i = 0; i < u.rows.length; i += 500) {
      const { error } = await sb!.from(u.t.table).upsert(u.rows.slice(i, i + 500), { onConflict: 'id' });
      if (error) throw new Error(`${u.t.table}: ${error.message}`);
    }
    const m = synced.get(u.t.table) ?? new Map<string, string>();
    for (const row of u.rows) m.set(String(row.id), u.json.get(String(row.id))!);
    synced.set(u.t.table, m);
  }
  if (state !== syncedState) {
    const { error } = await sb!.from('app_state').upsert(stateRow(d), { onConflict: 'id' });
    if (error) throw new Error(`settings: ${error.message}`);
    syncedState = state;
  }
  for (const x of dels) {
    for (let i = 0; i < x.ids.length; i += 200) {
      const { error } = await sb!.from(x.table).delete().in('id', x.ids.slice(i, i + 200));
      if (error) throw new Error(`${x.table}: ${error.message}`);
    }
    const m = synced.get(x.table)!;
    for (const id of x.ids) m.delete(id);
  }
}

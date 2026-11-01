import type { ISODate, Lead } from './types';
import { normalizePhone } from './util';

export const CLOSED_LEAD_STATUSES = ['Converted', 'Lost'];

/** Priority tiers: 1 overdue follow-up, 2 due today, 3 hot, 4 new/uncontacted, 5 other. */
export function queueTier(l: Lead, today: ISODate): number {
  if (l.nextFollowUp && l.nextFollowUp < today) return 1;
  if (l.nextFollowUp === today) return 2;
  if (l.status === 'Hot') return 3;
  if (!l.lastCallAt && (l.status === 'New' || l.status === 'Not Contacted')) return 4;
  return 5;
}
export const TIER_LABELS = ['', 'Overdue follow-up', 'Due today', 'Hot lead', 'New, uncontacted', 'Other'];

export function callingQueue(leads: Lead[], today: ISODate): (Lead & { tier: number })[] {
  return leads
    .filter((l) => !CLOSED_LEAD_STATUSES.includes(l.status))
    .map((l) => ({ ...l, tier: queueTier(l, today) }))
    .sort((a, b) => a.tier - b.tier || (a.nextFollowUp ?? '9').localeCompare(b.nextFollowUp ?? '9') || a.createdAt.localeCompare(b.createdAt));
}

// ---- import ----
export type ImportField = 'name' | 'phone' | 'email' | 'source' | 'campaign' | 'notes';
export const IMPORT_FIELDS: ImportField[] = ['name', 'phone', 'email', 'source', 'campaign', 'notes'];
const HINTS: Record<ImportField, RegExp> = {
  name: /name|full/i, phone: /phone|mobile|contact|number|whatsapp/i, email: /mail/i,
  source: /source|platform|channel/i, campaign: /campaign|ad ?set|ad name|form/i, notes: /note|comment|remark|message/i,
};
export function guessMapping(headers: string[]): Partial<Record<ImportField, string>> {
  const m: Partial<Record<ImportField, string>> = {};
  for (const f of IMPORT_FIELDS) {
    const h = headers.find((x) => HINTS[f].test(x) && !Object.values(m).includes(x));
    if (h) m[f] = h;
  }
  return m;
}

export interface ImportRow { row: number; data: Record<string, string>; name: string; phone: string; email: string; source: string; campaign: string; notes: string }
export interface ImportCheck { valid: ImportRow[]; duplicates: (ImportRow & { reason: string })[]; invalid: (ImportRow & { reason: string })[] }

/** Validates rows. Nothing is dropped silently: every row ends in exactly one bucket with a reason. */
export function checkImport(rows: Record<string, unknown>[], map: Partial<Record<ImportField, string>>, existingPhones: Set<string>, defaultSource: string): ImportCheck {
  const out: ImportCheck = { valid: [], duplicates: [], invalid: [] };
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const get = (f: ImportField) => (map[f] ? String(r[map[f]!] ?? '').trim() : '');
    const data = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '')]));
    const phone = normalizePhone(get('phone'));
    const row: ImportRow = { row: i + 2, data, name: get('name'), phone: phone ?? get('phone'), email: get('email'), source: get('source') || defaultSource, campaign: get('campaign'), notes: get('notes') };
    if (!row.name) return out.invalid.push({ ...row, reason: 'Name is missing' });
    if (!phone) return out.invalid.push({ ...row, reason: `Invalid mobile number "${get('phone')}"` });
    if (row.email && !/^\S+@\S+\.\S+$/.test(row.email)) return out.invalid.push({ ...row, reason: `Invalid email "${row.email}"` });
    if (existingPhones.has(phone)) return out.duplicates.push({ ...row, reason: 'Mobile already exists in leads or students' });
    if (seen.has(phone)) return out.duplicates.push({ ...row, reason: `Same mobile as row ${seen.get(phone)} in this file` });
    seen.set(phone, row.row);
    out.valid.push(row);
  });
  return out;
}

/** Round-robin assignment of new leads across callers. */
export const roundRobin = <T>(items: T[], callers: string[]) => items.map((it, i) => ({ item: it, assignee: callers.length ? callers[i % callers.length] : '' }));

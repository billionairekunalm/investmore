import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import * as S from '../store/store';
import type { Module } from '../domain/types';
import { ROLES } from '../domain/types';
import { RANGE_LABELS, resolveRange, todayIST, fmtPhone, type RangeKey } from '../domain/util';
export type ISODateRange = [string, string];
import { Button, Input, LogoMark, Wordmark, cx } from './kit';
import { CallOutcomeModal } from './modals';
import { cloudEnabled, getSyncStatus, subscribeSync } from '../store/cloud';

// ---------------- global date range ----------------
const RangeCtx = createContext<{ key: RangeKey; range: ISODateRange; set: (k: RangeKey, custom?: ISODateRange) => void }>(null!);
export const useRange = () => useContext(RangeCtx);

// ---------------- call tracking ----------------
type CallTarget = { entity: 'lead' | 'student'; id: string; name: string; phone: string };
const CallCtx = createContext<{ start: (t: CallTarget) => void; log: (t: CallTarget) => void }>(null!);
export const useCall = () => useContext(CallCtx);

/** Opens the native dialler. The call is NOT recorded until staff log the outcome afterwards. */
export function CallButton({ target, size = 'sm', label = 'Call' }: { target: CallTarget; size?: 'sm' | 'md'; label?: string }) {
  const { start } = useCall();
  return (
    <a href={`tel:+91${target.phone}`} onClick={(e) => { e.stopPropagation(); start(target); }}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg font-medium', size === 'sm'
        ? 'h-7 px-2.5 text-[12.5px] border border-line bg-white hover:bg-ok-soft hover:text-ok hover:border-ok/30'
        : 'h-10 px-4 text-[14px] font-semibold text-white bg-[linear-gradient(135deg,#046b23,#0e9f3d)] shadow-[0_6px_14px_-6px_rgba(4,107,35,.7)] hover:brightness-110')}>
      <PhoneIcon /> {label}
    </a>
  );
}
const PhoneIcon = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 2h3l1.5 3.5-2 1.2a8 8 0 0 0 3.8 3.8l1.2-2L14 10v3a1 1 0 0 1-1 1A11 11 0 0 1 2 3a1 1 0 0 1 1-1Z" /></svg>;

// ---------------- nav ----------------
const BELL = 'M4 6.5a4 4 0 0 1 8 0c0 4 1.5 5.5 1.5 5.5h-11S4 10.5 4 6.5ZM6.5 14h3'; // top-bar notifications (no menu item)
const NAV: { to: string; label: string; mod: Module; icon: string }[] = [
  // most used first: daily front-desk work, then money, then setup
  { to: '/', label: 'Dashboard', mod: 'dashboard', icon: 'M2 9h5V2H2zM9 14h5V7H9zM2 14h5v-3H2zM9 5h5V2H9z' },
  { to: '/students', label: 'Students', mod: 'students', icon: 'M1 6l7-3.5L15 6 8 9.5zM4 7.5v3.5c1 1 2.5 1.5 4 1.5s3-.5 4-1.5V7.5' },
  { to: '/admissions', label: 'Admissions', mod: 'admissions', icon: 'M8 3v10M3 8h10' },
  { to: '/collections', label: 'Collections', mod: 'collections', icon: 'M1.5 4.5h13v8h-13zM1.5 7h13M4 10.5h2' },
  { to: '/fees', label: 'Fees', mod: 'fees', icon: 'M4 2h8v12l-2-1.2-2 1.2-2-1.2L4 14zM6 5.5h4M6 8h4' },
  { to: '/batches', label: 'Batches', mod: 'batches', icon: 'M2 3h12v10H2zM2 6h12M5.5 1.5v3M10.5 1.5v3' },
  { to: '/leads', label: 'Leads CRM', mod: 'leads', icon: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 14a5.5 5.5 0 0 1 11 0' },
  { to: '/invoices', label: 'Invoices', mod: 'fees', icon: 'M4 1.5h5.5L12 4v10.5H4zM9.5 1.5V4H12M6 7h4M6 9.5h4M6 12h2' },
  { to: '/expenses', label: 'Expenses', mod: 'expenses', icon: 'M8 1.5v13M11 4H6.5a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4H5' },
  { to: '/kits', label: 'Kits', mod: 'students', icon: 'M2 5.5 8 2.5l6 3v5L8 13.5l-6-3zM2 5.5 8 8.5l6-3M8 8.5v5' },
  { to: '/profit', label: 'Salary & Profit', mod: 'profit', icon: 'M8 1.5A6.5 6.5 0 1 0 14.5 8H8z M10 1.7V6h4.3A6.5 6.5 0 0 0 10 1.7Z' },
  { to: '/courses', label: 'Courses', mod: 'settings', icon: 'M2 3h4.5A1.5 1.5 0 0 1 8 4.5V14a1.5 1.5 0 0 0-1.5-1.5H2zM14 3H9.5A1.5 1.5 0 0 0 8 4.5V14a1.5 1.5 0 0 1 1.5-1.5H14z' },
  { to: '/certificates', label: 'Certificates', mod: 'certificates', icon: 'M2 2.5h12v8H2zM6 13.5l2-1.5 2 1.5v-3H6z' },
  { to: '/employees', label: 'Employees', mod: 'employees', icon: 'M6 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.5 13.5a4.5 4.5 0 0 1 9 0M11 2.5a2.5 2.5 0 0 1 0 4.5M12.5 9.5a4.5 4.5 0 0 1 2 4' },
  { to: '/settings', label: 'Settings', mod: 'settings', icon: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4' },
];
export const navItem = (path: string) => NAV.find((n) => n.to !== '/' && path.startsWith(n.to)) ?? NAV[0];
const Icon = ({ d }: { d: string }) => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

export function Layout({ children }: { children: ReactNode }) {
  const db = S.useDB();
  const me = S.useMe();
  const loc = useLocation();
  const nav = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const [mini, setMini] = useState(() => { try { return localStorage.getItem('sidebar') === 'mini'; } catch { return false; } });
  const toggleMini = () => { setMini(!mini); try { localStorage.setItem('sidebar', mini ? 'full' : 'mini'); } catch { /* */ } };
  const [rk, setRk] = useState<RangeKey>(() => (localStorage.getItem('range') as RangeKey) || 'month');
  const [custom, setCustom] = useState<ISODateRange | undefined>();
  const range = resolveRange(rk, todayIST(), custom);
  const [pending, setPending] = useState<{ t: CallTarget; at: number } | null>(null);
  const [logging, setLogging] = useState<CallTarget | null>(null);

  useEffect(() => setDrawer(false), [loc.pathname]);
  // When staff return from the dialler, ask for the outcome. Opening the dialler alone never counts as a call.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && pending && Date.now() - pending.at > 1500) setLogging(pending.t); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [pending]);
  // automations: on load and every minute (idempotent)
  useEffect(() => { S.runAutomations(); const t = setInterval(() => S.runAutomations(), 60000); return () => clearInterval(t); }, []);

  if (!me) return null;
  // Collections now lives inside Fee Management; the separate menu item only stays for a role that has Collections but not Fees
  const items = NAV.filter((n) => S.allowed(n.mod, 'view', db) && !(n.to === '/collections' && S.allowed('fees', 'view', db)));
  const unread = S.notificationsFor(db, me).filter((n) => !n.readBy.includes(me.id)).length;
  const current = navItem(loc.pathname);
  const role = ROLES.find((r) => r.id === me.role)?.label;
  // `m` = icon-only (desktop collapsed). The phone drawer always renders full.
  const sidebar = (m: boolean) => (
    <nav className="flex flex-col h-full whitespace-nowrap text-zinc-300">
      <div className={cx('h-16 flex items-center gap-2.5 shrink-0', m ? 'px-[18px]' : 'px-5')}>
        <LogoMark className="size-9 shrink-0 rounded-xl border-0" />
        {!m && <div className="leading-tight min-w-0"><Wordmark name={db.settings.academyName} className="block truncate text-[14px] text-white" /><div className="text-[11px] text-zinc-500">Academy management</div></div>}
      </div>
      {/* profile greeting */}
      <div className={cx('shrink-0 flex flex-col items-center text-center', m ? 'py-2' : 'pt-3 pb-5')}>
        <div className={cx('rounded-full grid place-items-center font-bold text-ink bg-lime ring-4 ring-sidebar-2 transition-all duration-300', m ? 'size-9 text-[14px]' : 'size-16 text-[24px]')} title={m ? me.name : undefined}>{me.name[0]}</div>
        {!m && <><div className="mt-3 text-[11.5px] text-zinc-500">Welcome back,</div><div className="text-[15px] font-semibold text-white truncate max-w-full px-4">{me.name}</div><div className="text-[11px] text-brand-bright font-medium">{role}</div></>}
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 space-y-1 [scrollbar-width:none]">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} title={m ? n.label : undefined} aria-label={m ? n.label : undefined}
            className={({ isActive }) => cx('relative flex items-center gap-3 rounded-2xl h-10 font-medium transition-all duration-200', m ? 'justify-center' : 'px-3.5',
              isActive ? 'bg-lime text-ink font-semibold shadow-[0_6px_18px_-8px_rgba(182,240,156,.7)]' : 'hover:text-white hover:bg-sidebar-2')}>
            <span className="shrink-0"><Icon d={n.icon} /></span>
            {!m && <span>{n.label}</span>}
            {n.mod === 'notifications' && unread > 0 && (m
              ? <span className="absolute top-1.5 right-2 size-2 rounded-full bg-brand-bright" />
              : <span className="ml-auto rounded-full bg-brand-bright text-white text-[10.5px] px-1.5 tabular">{unread}</span>)}
          </NavLink>
        ))}
      </div>
      <div className="p-3 shrink-0">
        <button onClick={() => { S.logout(); nav('/'); }} title={m ? 'Sign out' : undefined} aria-label="Sign out"
          className={cx('w-full flex items-center gap-3 rounded-2xl h-10 font-medium hover:text-white hover:bg-sidebar-2 transition-colors', m ? 'justify-center' : 'px-3.5')}>
          <Icon d="M6 2.5H3v11h3M10.5 5 13.5 8l-3 3M13.5 8H6" />{!m && 'Sign out'}
        </button>
        {!m && <div className="mt-1 px-3.5 text-[10.5px] text-zinc-600 tabular" title={`Built ${new Date(__BUILT_AT__).toLocaleString('en-IN')}`}>v {__APP_VERSION__} · {new Date(__BUILT_AT__).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>}
      </div>
    </nav>
  );

  return (
    <RangeCtx.Provider value={{ key: rk, range, set: (k, c) => { setRk(k); setCustom(c); try { localStorage.setItem('range', k); } catch { /* */ } } }}>
      <CallCtx.Provider value={{ start: (t) => setPending({ t, at: Date.now() }), log: (t) => setLogging(t) }}>
        <div className="flex h-full">
          <div className="hidden lg:block relative shrink-0 no-print p-3 pr-0">
            <aside className={cx('h-full overflow-hidden rounded-[28px] bg-sidebar shadow-[0_20px_40px_-20px_rgba(0,0,0,.5)] transition-[width] duration-300 ease-out', mini ? 'w-[72px]' : 'w-64')}>{sidebar(mini)}</aside>
            <button onClick={toggleMini} aria-label={mini ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!mini} title={mini ? 'Expand sidebar' : 'Collapse sidebar'}
              className="absolute top-[32px] -right-3 z-40 size-6 grid place-items-center rounded-full border border-line bg-white text-zinc-600 shadow-sm hover:text-ink hover:bg-lime focus-visible:outline-2 focus-visible:outline-accent">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cx('transition-transform duration-200', mini && 'rotate-180')}><path d="M10 3 5 8l5 5" /></svg>
            </button>
          </div>
          {drawer && (
            <div className="lg:hidden fixed inset-0 z-40 no-print" onClick={() => setDrawer(false)}>
              <div className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm kit-fade" />
              <aside className="absolute left-2 top-2 bottom-2 w-72 rounded-[28px] bg-sidebar overflow-hidden shadow-2xl drawer-in" onClick={(e) => e.stopPropagation()}>{sidebar(false)}</aside>
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col">
            <header className="h-16 shrink-0 flex items-center gap-2 px-3 sm:px-6 bg-canvas/85 backdrop-blur-md sticky top-0 z-30 no-print">
              <button className="lg:hidden size-10 shrink-0 grid place-items-center rounded-full bg-white shadow-card text-ink" onClick={() => setDrawer(true)} aria-label="Menu"><Icon d="M2 4h12M2 8h12M2 12h12" /></button>
              <div className="flex flex-col min-w-0 leading-tight ml-1 lg:ml-0">
                <span className="text-[16px] font-bold tracking-tight truncate">{current.label}</span>
                <span className="text-[11.5px] text-muted truncate">{db.settings.academyName}</span>
              </div>
              <div className="flex-1" />
              <SyncBadge />
              <GlobalSearch />
              <RangePicker rk={rk} range={range} onChange={(k, c) => { setRk(k); setCustom(c); try { localStorage.setItem('range', k); } catch { /* */ } }} />
              <Link to="/notifications" className="relative size-10 shrink-0 grid place-items-center rounded-full bg-white shadow-card text-ink hover:bg-lime transition-colors" aria-label="Notifications">
                <Icon d={BELL} />
                {unread > 0 && <span className="absolute top-2 right-2.5 size-2 rounded-full bg-bad ring-2 ring-white" />}
              </Link>
            </header>
            {pending && !logging && (
              <div className="mx-3 sm:mx-6 mb-2 rounded-2xl bg-lime/60 px-4 py-2 flex items-center gap-3 text-[13px] no-print">
                <span>Calling <b>{pending.t.name}</b> ({fmtPhone(pending.t.phone)}) — log the outcome when you're done.</span>
                <div className="flex-1" />
                <Button size="sm" variant="primary" onClick={() => setLogging(pending.t)}>Log outcome</Button>
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Dismiss</Button>
              </div>
            )}
            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-2 pb-32 lg:pb-8 page-in">{children}</div>
            </main>
            <MobileTabs items={items} />
          </div>
        </div>
        <CallOutcomeModal target={logging} onClose={() => { setLogging(null); setPending(null); }} />
      </CallCtx.Provider>
    </RangeCtx.Provider>
  );
}

/** Phone bottom bar: a floating, rounded bar with big icons; the open page gets a green pill. */
function MobileTabs({ items }: { items: typeof NAV }) {
  const pick = ['/', '/students', '/fees', '/collections', '/batches', '/leads'];
  const tabs = items.filter((i) => pick.includes(i.to)).slice(0, 5);
  const short: Record<string, string> = { '/': 'Home', '/students': 'Students', '/fees': 'Fees', '/collections': 'Collect', '/batches': 'Batches', '/leads': 'Leads' };
  return (
    <nav aria-label="Main" className="lg:hidden fixed bottom-0 inset-x-0 z-30 px-3 pt-2 no-print pointer-events-none" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}>
      <div className="pointer-events-auto mx-auto max-w-md flex items-stretch gap-1 rounded-[26px] bg-sidebar/95 backdrop-blur-md p-1.5 shadow-[0_14px_30px_-10px_rgba(0,0,0,.55)]">
        {tabs.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}
            className={({ isActive }) => cx('flex-1 min-w-0 flex flex-col items-center justify-center gap-1 rounded-[20px] py-2 text-[11.5px] font-semibold transition-colors',
              isActive ? 'bg-lime text-ink' : 'text-zinc-400 active:bg-sidebar-2')}>
            <svg viewBox="0 0 16 16" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={n.icon} /></svg>
            <span className="truncate max-w-full px-0.5">{short[n.to] ?? n.label.split(' ')[0]}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function RangePicker({ rk, range, onChange }: { rk: RangeKey; range: ISODateRange; onChange: (k: RangeKey, c?: ISODateRange) => void }) {
  const [a, setA] = useState(range[0]);
  const [b, setB] = useState(range[1]);
  return (
    <div className="flex items-center gap-1.5">
      <select value={rk} onChange={(e) => { const k = e.target.value as RangeKey; onChange(k, k === 'custom' ? [a, b] : undefined); }}
        className="h-10 rounded-full bg-white shadow-card px-3.5 text-[13px] font-medium max-w-[9.5rem] outline-none focus:ring-3 focus:ring-lime" aria-label="Date range">
        {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => <option key={k} value={k}>{RANGE_LABELS[k]}</option>)}
      </select>
      {rk === 'custom' && (
        <div className="hidden md:flex items-center gap-1">
          <Input type="date" value={a} onChange={(e) => { setA(e.target.value); onChange('custom', [e.target.value, b]); }} className="w-36" />
          <Input type="date" value={b} onChange={(e) => { setB(e.target.value); onChange('custom', [a, e.target.value]); }} className="w-36" />
        </div>
      )}
    </div>
  );
}

function GlobalSearch() {
  const db = S.useDB();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  const t = q.trim().toLowerCase();
  const students = t.length > 1 && S.allowed('students', 'view', db) ? db.students.filter((s) => s.name.toLowerCase().includes(t) || s.phone.includes(t) || s.code.toLowerCase().includes(t)).slice(0, 5) : [];
  const leads = t.length > 1 ? S.visibleLeads(db).filter((l) => l.name.toLowerCase().includes(t) || l.phone.includes(t) || l.id.toLowerCase().includes(t)).slice(0, 5) : [];
  const go = (to: string) => { setQ(''); setOpen(false); nav(to); };
  return (
    <div className="relative hidden md:block w-64">
      <Input ref={ref} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search students, leads…  Ctrl K" className="pl-4 rounded-full border-0 shadow-card" />
      {open && t.length > 1 && (
        <div className="absolute right-0 mt-2 w-80 rounded-2xl bg-white shadow-xl z-50 py-2 max-h-96 overflow-y-auto kit-zoom">
          {!students.length && !leads.length && <div className="px-3 py-3 text-muted">No matches for “{q}”</div>}
          {!!students.length && <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted">Students</div>}
          {students.map((s) => <button key={s.id} onMouseDown={() => go(`/students/${s.id}`)} className="block w-full text-left px-3 py-1.5 hover:bg-surface">{s.name} <span className="text-muted">· {s.code} · {fmtPhone(s.phone)}</span></button>)}
          {!!leads.length && <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted">Leads</div>}
          {leads.map((l) => <button key={l.id} onMouseDown={() => go(`/leads?lead=${l.id}`)} className="block w-full text-left px-3 py-1.5 hover:bg-surface">{l.name} <span className="text-muted">· {l.status} · {fmtPhone(l.phone)}</span></button>)}
        </div>
      )}
    </div>
  );
}

/** Cloud save status: lets staff see their work has reached Supabase. */
function SyncBadge() {
  const st = useSyncExternalStore(subscribeSync, getSyncStatus);
  if (!cloudEnabled) return null;
  const [label, cls, dot] = st.state === 'saving' ? ['Saving…', 'text-zinc-600', 'bg-zinc-400 animate-pulse']
    : st.state === 'offline' ? ['Offline · saved on this device', 'text-warn', 'bg-warn']
    : st.state === 'error' ? ['Not saved · retrying', 'text-bad', 'bg-bad']
    : ['Saved', 'text-zinc-500', 'bg-accent'];
  return (
    <span title={st.message ?? 'All changes are saved to the academy database'} className={cx('hidden sm:inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap', cls)}>
      <span className={cx('size-2 rounded-full', dot)} />{label}
    </span>
  );
}

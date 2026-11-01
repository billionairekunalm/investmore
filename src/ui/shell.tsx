import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import * as S from '../store/store';
import type { Module } from '../domain/types';
import { ROLES } from '../domain/types';
import { RANGE_LABELS, resolveRange, todayIST, fmtPhone, type RangeKey } from '../domain/util';
export type ISODateRange = [string, string];
import { Button, Input, LogoMark, Wordmark, cx } from './kit';
import { CallOutcomeModal, ExpenseModal, LeadModal, PaymentModal } from './modals';
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
      className={cx('inline-flex items-center gap-1.5 rounded-lg border border-line bg-white font-medium hover:bg-ok-soft hover:text-ok hover:border-ok/30', size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-9 px-3.5')}>
      <PhoneIcon /> {label}
    </a>
  );
}
const PhoneIcon = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 2h3l1.5 3.5-2 1.2a8 8 0 0 0 3.8 3.8l1.2-2L14 10v3a1 1 0 0 1-1 1A11 11 0 0 1 2 3a1 1 0 0 1 1-1Z" /></svg>;

// ---------------- nav ----------------
const NAV: { to: string; label: string; mod: Module; icon: string }[] = [
  { to: '/', label: 'Dashboard', mod: 'dashboard', icon: 'M2 9h5V2H2zM9 14h5V7H9zM2 14h5v-3H2zM9 5h5V2H9z' },
  { to: '/leads', label: 'Leads CRM', mod: 'leads', icon: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 14a5.5 5.5 0 0 1 11 0' },
  { to: '/students', label: 'Students', mod: 'students', icon: 'M1 6l7-3.5L15 6 8 9.5zM4 7.5v3.5c1 1 2.5 1.5 4 1.5s3-.5 4-1.5V7.5' },
  { to: '/kits', label: 'Kits', mod: 'students', icon: 'M2 5.5 8 2.5l6 3v5L8 13.5l-6-3zM2 5.5 8 8.5l6-3M8 8.5v5' },
  { to: '/admissions', label: 'Admissions', mod: 'admissions', icon: 'M8 3v10M3 8h10' },
  { to: '/fees', label: 'Fee Management', mod: 'fees', icon: 'M4 2h8v12l-2-1.2-2 1.2-2-1.2L4 14zM6 5.5h4M6 8h4' },
  { to: '/collections', label: 'Collections', mod: 'collections', icon: 'M1.5 4.5h13v8h-13zM1.5 7h13M4 10.5h2' },
  { to: '/invoices', label: 'Invoices', mod: 'fees', icon: 'M4 1.5h5.5L12 4v10.5H4zM9.5 1.5V4H12M6 7h4M6 9.5h4M6 12h2' },
  { to: '/courses', label: 'Courses', mod: 'settings', icon: 'M2 3h4.5A1.5 1.5 0 0 1 8 4.5V14a1.5 1.5 0 0 0-1.5-1.5H2zM14 3H9.5A1.5 1.5 0 0 0 8 4.5V14a1.5 1.5 0 0 1 1.5-1.5H14z' },
  { to: '/batches', label: 'Batches', mod: 'batches', icon: 'M2 3h12v10H2zM2 6h12M5.5 1.5v3M10.5 1.5v3' },
  { to: '/certificates', label: 'Certificates', mod: 'certificates', icon: 'M2 2.5h12v8H2zM6 13.5l2-1.5 2 1.5v-3H6z' },
  { to: '/expenses', label: 'Expenses', mod: 'expenses', icon: 'M8 1.5v13M11 4H6.5a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4H5' },
  { to: '/profit', label: 'Salary & Profit', mod: 'profit', icon: 'M8 1.5A6.5 6.5 0 1 0 14.5 8H8z M10 1.7V6h4.3A6.5 6.5 0 0 0 10 1.7Z' },
  { to: '/reports', label: 'Reports & Analytics', mod: 'reports', icon: 'M2 14V2M2 14h12M5 11V8M8 11V5M11 11V7' },
  { to: '/employees', label: 'Employees', mod: 'employees', icon: 'M6 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.5 13.5a4.5 4.5 0 0 1 9 0M11 2.5a2.5 2.5 0 0 1 0 4.5M12.5 9.5a4.5 4.5 0 0 1 2 4' },
  { to: '/notifications', label: 'Notifications', mod: 'notifications', icon: 'M4 6.5a4 4 0 0 1 8 0c0 4 1.5 5.5 1.5 5.5h-11S4 10.5 4 6.5ZM6.5 14h3' },
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
  const [quick, setQuick] = useState<'' | 'lead' | 'payment' | 'expense'>('');

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
  const items = NAV.filter((n) => S.allowed(n.mod, 'view', db));
  const unread = S.notificationsFor(db, me).filter((n) => !n.readBy.includes(me.id)).length;
  const current = navItem(loc.pathname);
  // `m` = icon-only (desktop collapsed). The phone drawer always renders full.
  const sidebar = (m: boolean) => (
    <nav className="flex flex-col h-full whitespace-nowrap">
      <div className="px-4 h-14 flex items-center gap-2.5 border-b border-line">
        <LogoMark className="size-8 shrink-0" />
        <div className={cx('leading-tight min-w-0 transition-opacity', m && 'opacity-0')}><Wordmark name={db.settings.academyName} className="block truncate text-[13.5px]" /><div className="text-[11px] text-muted">Academy management</div></div>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-0.5">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} title={m ? n.label : undefined} aria-label={m ? n.label : undefined}
            className={({ isActive }) => cx('relative flex items-center gap-2.5 rounded-lg h-8 font-medium transition-colors', m ? 'px-4' : 'px-2.5', isActive ? 'bg-white text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-zinc-600 hover:text-ink hover:bg-zinc-100')}>
            <span className="shrink-0"><Icon d={n.icon} /></span>
            <span className={cx('transition-opacity', m && 'opacity-0')}>{n.label}</span>
            {n.mod === 'notifications' && unread > 0 && (m
              ? <span className="absolute top-1 left-7 size-2 rounded-full bg-accent" />
              : <span className="ml-auto rounded-full bg-accent text-white text-[10.5px] px-1.5 tabular">{unread}</span>)}
          </NavLink>
        ))}
      </div>
      <div className={cx('py-3 border-t border-line', m ? 'px-4' : 'px-3')}>
        <div className="flex items-center gap-2.5">
          <div className="size-8 shrink-0 rounded-full bg-accent-soft text-accent grid place-items-center font-semibold" title={m ? me.name : undefined}>{me.name[0]}</div>
          <div className={cx('min-w-0 flex-1 leading-tight transition-opacity', m && 'opacity-0')}><div className="font-medium truncate">{me.name}</div><div className="text-[11px] text-muted">{ROLES.find((r) => r.id === me.role)?.label}</div></div>
          <button onClick={() => { S.logout(); nav('/'); }} tabIndex={m ? -1 : undefined} className={cx('text-xs text-muted hover:text-ink', m && 'invisible')}>Sign out</button>
        </div>
        {!m && <div className="mt-2 text-[10.5px] text-zinc-400 tabular" title={`Built ${new Date(__BUILT_AT__).toLocaleString('en-IN')}`}>v {__APP_VERSION__} · {new Date(__BUILT_AT__).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>}
      </div>
    </nav>
  );

  return (
    <RangeCtx.Provider value={{ key: rk, range, set: (k, c) => { setRk(k); setCustom(c); try { localStorage.setItem('range', k); } catch { /* */ } } }}>
      <CallCtx.Provider value={{ start: (t) => setPending({ t, at: Date.now() }), log: (t) => setLogging(t) }}>
        <div className="flex h-full">
          <div className="hidden lg:block relative shrink-0 no-print">
            <aside className={cx('h-full overflow-hidden border-r border-line bg-surface transition-[width] duration-200 ease-out', mini ? 'w-16' : 'w-60')}>{sidebar(mini)}</aside>
            <button onClick={toggleMini} aria-label={mini ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!mini} title={mini ? 'Expand sidebar' : 'Collapse sidebar'}
              className="absolute top-[17px] -right-3 z-40 size-6 grid place-items-center rounded-full border border-line bg-white text-zinc-600 shadow-sm hover:text-accent hover:border-accent/40 focus-visible:outline-2 focus-visible:outline-accent">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cx('transition-transform duration-200', mini && 'rotate-180')}><path d="M10 3 5 8l5 5" /></svg>
            </button>
          </div>
          {drawer && (
            <div className="lg:hidden fixed inset-0 z-40 no-print" onClick={() => setDrawer(false)}>
              <div className="absolute inset-0 bg-zinc-900/30" />
              <aside className="absolute left-0 top-0 bottom-0 w-72 bg-surface border-r border-line" onClick={(e) => e.stopPropagation()}>{sidebar(false)}</aside>
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col">
            <header className="h-14 shrink-0 border-b border-line flex items-center gap-2 px-3 sm:px-5 bg-white/90 backdrop-blur sticky top-0 z-30 no-print">
              <button className="lg:hidden p-1.5 -ml-1 text-zinc-600" onClick={() => setDrawer(true)} aria-label="Menu"><Icon d="M2 4h12M2 8h12M2 12h12" /></button>
              <div className="hidden sm:flex items-center gap-1.5 text-muted min-w-0">
                <span>{db.settings.academyName}</span><span>/</span><span className="text-ink font-medium truncate">{current.label}</span>
              </div>
              <div className="flex-1" />
              <SyncBadge />
              <GlobalSearch />
              <RangePicker rk={rk} range={range} onChange={(k, c) => { setRk(k); setCustom(c); try { localStorage.setItem('range', k); } catch { /* */ } }} />
              <QuickAdd onPick={(k) => (k === 'admission' ? nav('/admissions') : setQuick(k))} />
              <Link to="/notifications" className="relative p-2 text-zinc-600 hover:text-ink" aria-label="Notifications">
                <Icon d={NAV.find((n) => n.mod === 'notifications')!.icon} />
                {unread > 0 && <span className="absolute top-1 right-1 size-2 rounded-full bg-bad" />}
              </Link>
            </header>
            {pending && !logging && (
              <div className="bg-accent-soft border-b border-accent/15 px-4 py-2 flex items-center gap-3 text-[13px] no-print">
                <span>Calling <b>{pending.t.name}</b> ({fmtPhone(pending.t.phone)}) — log the outcome when you're done.</span>
                <div className="flex-1" />
                <Button size="sm" variant="primary" onClick={() => setLogging(pending.t)}>Log outcome</Button>
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Dismiss</Button>
              </div>
            )}
            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[1400px] p-4 sm:p-6 pb-24 lg:pb-8">{children}</div>
            </main>
            <MobileTabs items={items} />
          </div>
        </div>
        <CallOutcomeModal target={logging} onClose={() => { setLogging(null); setPending(null); }} />
        <LeadModal open={quick === 'lead'} onClose={() => setQuick('')} />
        <PaymentModal open={quick === 'payment'} onClose={() => setQuick('')} />
        <ExpenseModal open={quick === 'expense'} onClose={() => setQuick('')} />
      </CallCtx.Provider>
    </RangeCtx.Provider>
  );
}

function MobileTabs({ items }: { items: typeof NAV }) {
  const pick = ['/', '/leads', '/students', '/collections', '/notifications'];
  const tabs = items.filter((i) => pick.includes(i.to)).slice(0, 5);
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-line flex no-print" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {tabs.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cx('flex-1 flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium', isActive ? 'text-accent' : 'text-zinc-500')}>
          <Icon d={n.icon} />{n.label.split(' ')[0]}
        </NavLink>
      ))}
    </nav>
  );
}

function QuickAdd({ onPick }: { onPick: (k: 'lead' | 'admission' | 'payment' | 'expense') => void }) {
  const db = S.useDB();
  const [open, setOpen] = useState(false);
  const opts = ([
    ['lead', 'New lead', S.allowed('leads', 'create', db)],
    ['admission', 'New admission', S.allowed('admissions', 'create', db)],
    ['payment', 'Record payment', S.allowed('fees', 'create', db)],
    ['expense', 'Add expense', S.allowed('expenses', 'create', db)],
  ] as const).filter((o) => o[2]);
  if (!opts.length) return null;
  return (
    <div className="relative">
      <Button variant="primary" onClick={() => setOpen(!open)} className="px-2.5 sm:px-3.5"><span className="text-base leading-none">+</span><span className="hidden sm:inline">New</span></Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-48 rounded-lg border border-line bg-white shadow-lg z-50 py-1">
            {opts.map(([k, l]) => <button key={k} onClick={() => { setOpen(false); onPick(k); }} className="block w-full text-left px-3 py-2 hover:bg-surface">{l}</button>)}
          </div>
        </>
      )}
    </div>
  );
}

function RangePicker({ rk, range, onChange }: { rk: RangeKey; range: ISODateRange; onChange: (k: RangeKey, c?: ISODateRange) => void }) {
  const [a, setA] = useState(range[0]);
  const [b, setB] = useState(range[1]);
  return (
    <div className="flex items-center gap-1.5">
      <select value={rk} onChange={(e) => { const k = e.target.value as RangeKey; onChange(k, k === 'custom' ? [a, b] : undefined); }}
        className="h-9 rounded-lg border border-line bg-white px-2 text-[13px] max-w-[9.5rem]" aria-label="Date range">
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
        placeholder="Search students, leads…  Ctrl K" className="pl-3" />
      {open && t.length > 1 && (
        <div className="absolute right-0 mt-1 w-80 rounded-lg border border-line bg-white shadow-lg z-50 py-1 max-h-96 overflow-y-auto">
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

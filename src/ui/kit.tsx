import { forwardRef, createContext, useContext, useEffect, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type ButtonHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AppError } from '../store/store';
import { fmtINR } from '../domain/util';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------- brand ----------------
/** INVESTMORE wordmark (charcoal + brand green) when the academy keeps its brand name; otherwise the configured name. */
export const Wordmark = ({ name, className }: { name: string; className?: string }) =>
  name.trim().toLowerCase() === 'investmore'
    ? <span className={cx('font-bold uppercase tracking-[0.14em]', className)}>Invest<span className="text-brand-bright">More</span></span>
    : <span className={cx('font-semibold', className)}>{name}</span>;
/** Invoice / receipt header: the IM mark, large, with "Training Academy" underneath. */
export const DocBrand = () => (
  <div className="inline-flex flex-col items-center">
    <img src="/logo-mark.png" alt="InvestMore" className="h-40 sm:h-44 w-auto -my-4 mix-blend-multiply" />
    <div className="text-[15px] font-bold uppercase tracking-[0.3em] text-navy">Training Academy</div>
  </div>
);
/** Faint IM mark in the middle of a printed document (the parent must be `relative`). */
export const DocWatermark = () => (
  <img src="/logo-mark.png" alt="" aria-hidden
    className="pointer-events-none select-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] max-w-[420px] opacity-[0.06] mix-blend-multiply [print-color-adjust:exact]" />
);
export const LogoMark =({ className = 'size-8' }: { className?: string }) => (
  <span className={cx('shrink-0 rounded-lg bg-white border border-line grid place-items-center overflow-hidden', className)}>
    <img src="/logo-mark.png" alt="InvestMore" className="w-[88%] h-[88%] object-contain" />
  </span>
);

// ---------------- buttons & inputs ----------------
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-ink text-white hover:bg-zinc-800 shadow-[0_6px_16px_-8px_rgba(24,24,24,.6)]',
  secondary: 'bg-white text-ink border border-line hover:border-zinc-300 hover:bg-surface',
  ghost: 'text-muted hover:text-ink hover:bg-surface',
  danger: 'bg-white text-bad border border-line hover:bg-bad-soft',
};
export function Button({ variant = 'secondary', size = 'md', className, loading, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-all active:scale-[.97] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-7 px-3 text-[12.5px]' : 'h-10 px-4', BTN[variant], className)}
    >
      {loading && <span className="size-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />}
      {children}
    </button>
  );
}
const width = (c?: string) => (/(^|\s)w-/.test(c ?? '') ? '' : 'w-full'); // caller-supplied width wins
const inputCls = 'h-10 rounded-xl border border-line bg-white px-3 text-ink shadow-[inset_0_1px_1px_rgba(0,0,0,0.04)] outline-none hover:border-zinc-300 focus:border-accent focus:ring-3 focus:ring-accent/15 placeholder:text-zinc-400 disabled:bg-surface disabled:border-line disabled:text-zinc-500';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} {...p} className={cx(inputCls, width(className), className)} />);
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, 'w-full h-auto min-h-20 py-2', className)} />;
export function Select({ className, options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: (string | { value: string; label: string })[]; placeholder?: string }) {
  return (
    <select {...p} className={cx(inputCls, width(className), 'pr-8 appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 fill=%27none%27 stroke=%27%2371717a%27 stroke-width=%271.5%27%3E%3Cpath d=%27M3 4.5l3 3 3-3%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_10px_center]', className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
export function Field({ label, hint, error, children, className, required }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[12.5px] font-medium text-zinc-800">{label}{required && <span className="text-bad"> *</span>}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-bad">{error}</span> : hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
export const Checkbox = ({ label, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) => (
  <label className="inline-flex items-start gap-2 cursor-pointer select-none"><input type="checkbox" {...p} className="mt-0.5 size-4 accent-[var(--color-accent)]" /><span>{label}</span></label>
);

// ---------------- surfaces ----------------
export const Card = ({ children, className, ...p }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) => <div {...p} className={cx('rounded-3xl bg-white shadow-card', className)}>{children}</div>;
export function CardHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-2">
      <div><h3 className="font-semibold text-[15px] tracking-tight">{title}</h3>{sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}</div>
      {right}
    </div>
  );
}
export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div><h1 className="text-[26px] font-bold tracking-tight leading-tight">{title}</h1>{sub && <p className="text-muted mt-0.5">{sub}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
export function Kpi({ label, value, sub, tone, to }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad'; to?: string }) {
  const inner = (
    <Card className={cx('p-5 h-full transition-all', to && 'hover:-translate-y-0.5 hover:shadow-lg')}>
      <div className="text-xs text-muted font-medium">{label}</div>
      <div className={cx('mt-1.5 text-[24px] font-bold tracking-tight tabular', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-bad')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Card>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}
export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="py-12 px-6 text-center">
      <div className="mx-auto mb-3 size-12 rounded-2xl bg-surface grid place-items-center text-muted">∅</div>
      <div className="font-medium">{title}</div>
      {body && <p className="text-muted mt-1 max-w-sm mx-auto">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  green: 'bg-ok-soft text-ok', orange: 'bg-warn-soft text-warn', red: 'bg-bad-soft text-bad', blue: 'bg-info-soft text-info', gray: 'bg-zinc-100 text-zinc-600',
};
const STATUS_TONE: Record<string, string> = {
  Paid: 'green', 'Fully Paid': 'green', Active: 'blue', Completed: 'green', Approved: 'green', Issued: 'green', Converted: 'green', Connected: 'blue', Interested: 'green',
  'Partially Paid': 'orange', 'Due Soon': 'orange', Pending: 'gray', 'Under Review': 'orange', Warm: 'orange', 'Call Later': 'orange', Busy: 'orange',
  Overdue: 'red', Rejected: 'red', Refunded: 'red', Dropped: 'red', Revoked: 'red', Lost: 'red', Hot: 'red', 'Wrong Number': 'red', 'Not Interested': 'gray', Reversed: 'red',
  Waived: 'gray', Cancelled: 'gray', Inactive: 'gray', Draft: 'gray', New: 'blue', 'Not Contacted': 'gray', Cold: 'gray', 'Not Answered': 'gray', 'No Plan': 'gray', 'Promised to Pay': 'blue', 'Already Paid': 'green', 'Needs More Time': 'orange',
  upcoming: 'blue', running: 'green', completed: 'gray', cancelled: 'red', open: 'green', closed: 'gray',
};
// Plain-language display for stored status values (data and colours keep the stored value).
const SAY: Record<string, string> = { 'Partially Paid': 'Part paid', 'Due Soon': 'Due soon', 'No Plan': 'No fee plan', 'Not Contacted': 'Not called yet', Waived: 'Waived off', upcoming: 'Upcoming', running: 'Running', completed: 'Completed', cancelled: 'Cancelled', open: 'Open', closed: 'Closed' };
export const Badge = ({ children, tone }: { children: ReactNode; tone?: string }) => (
  <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap', TONES[tone ?? STATUS_TONE[String(children)] ?? 'gray'])}>{typeof children === 'string' ? SAY[children] ?? children : children}</span>
);
export const Money = ({ v, className }: { v: number; className?: string }) => <span className={cx('tabular', className)}>{fmtINR(v)}</span>;

// ---------------- table ----------------
export interface Col<T> { key: string; label: string; render: (r: T) => ReactNode; className?: string; sort?: (r: T) => string | number }
export function Table<T>({ rows, cols, rowKey, onRow, empty, selectable, selected, onSelect, pageSize = 50, className }: {
  rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; onRow?: (r: T) => void; empty?: ReactNode;
  selectable?: boolean; selected?: Set<string>; onSelect?: (s: Set<string>) => void; pageSize?: number; className?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows.length]);
  const col = cols.find((c) => c.key === sort?.key);
  const sorted = col?.sort ? [...rows].sort((a, b) => { const x = col.sort!(a), y = col.sort!(b); return (x < y ? -1 : x > y ? 1 : 0) * sort!.dir; }) : rows;
  const pages = Math.ceil(sorted.length / pageSize);
  const shown = sorted.slice(page * pageSize, page * pageSize + pageSize);
  if (!rows.length) return <>{empty ?? <Empty title="Nothing here yet" />}</>;
  const allSel = selectable && shown.every((r) => selected?.has(rowKey(r)));
  return (
    <div>
      <div className="overflow-x-auto">
        <table className={cx('w-full text-left', className)}>
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
              {selectable && <th className="w-8 pl-4"><input type="checkbox" checked={!!allSel} onChange={() => { const s = new Set(selected); shown.forEach((r) => (allSel ? s.delete(rowKey(r)) : s.add(rowKey(r)))); onSelect?.(s); }} className="accent-[var(--color-accent)]" /></th>}
              {cols.map((c) => (
                <th key={c.key} className={cx('px-4 py-3 font-semibold whitespace-nowrap', c.sort && 'cursor-pointer hover:text-ink', c.className)}
                  onClick={() => c.sort && setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}>
                  {c.label}{sort?.key === c.key && (sort.dir === 1 ? ' ↑' : ' ↓')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const k = rowKey(r);
              return (
                <tr key={k} onClick={() => onRow?.(r)} className={cx('border-b border-line last:border-0', onRow && 'cursor-pointer hover:bg-surface transition-colors')}>
                  {selectable && <td className="pl-4" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={!!selected?.has(k)} onChange={() => { const s = new Set(selected); s.has(k) ? s.delete(k) : s.add(k); onSelect?.(s); }} className="accent-[var(--color-accent)]" /></td>}
                  {cols.map((c) => <td key={c.key} className={cx('px-4 py-3 whitespace-nowrap', c.className)}>{c.render(r)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-line text-xs text-muted">
          <span>{page * pageSize + 1}–{Math.min(rows.length, (page + 1) * pageSize)} of {rows.length}</span>
          <div className="flex gap-1">
            <Button size="sm" disabled={!page} onClick={() => setPage(page - 1)}>Prev</Button>
            <Button size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex w-fit max-w-full gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] rounded-full bg-white p-1 shadow-card mb-5">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={cx('px-3.5 h-8 rounded-full whitespace-nowrap font-medium transition-colors', value === t.id ? 'bg-ink text-white' : 'text-muted hover:text-ink hover:bg-surface')}>
          {t.label}{t.count !== undefined && <span className={cx('ml-1.5 rounded-full px-1.5 text-[11px] tabular', value === t.id ? 'bg-lime text-ink' : 'bg-zinc-100 text-zinc-600')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------- modal ----------------
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-zinc-900/40 backdrop-blur-sm sm:p-4 kit-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className={cx('w-full bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col kit-zoom', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="font-semibold text-[16px] tracking-tight">{title}</h2>
          <button onClick={onClose} className="size-8 grid place-items-center rounded-full bg-surface text-muted hover:text-ink text-lg leading-none" aria-label="Close">×</button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
        {footer && <div className="px-6 py-3.5 border-t border-line flex justify-end gap-2 bg-surface/60 rounded-b-3xl">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------- toasts, confirm dialogs, action runner ----------------
type Toast = { id: number; msg: string; tone: 'ok' | 'bad' };
type Ask = { title: string; message?: string; input?: string; confirm?: string; danger?: boolean; resolve: (v: string | null) => void };
const Ctx = createContext<{ toast: (m: string, t?: 'ok' | 'bad') => void; ask: (a: Omit<Ask, 'resolve'>) => Promise<string | null> }>(null!);
export const useUI = () => useContext(Ctx);

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [val, setVal] = useState('');
  const n = useRef(0);
  const toast = (msg: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = ++n.current;
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 6000 : 3000);
  };
  const askFn = (a: Omit<Ask, 'resolve'>) => new Promise<string | null>((resolve) => { setVal(''); setAsk({ ...a, resolve }); });
  const close = (v: string | null) => { ask?.resolve(v); setAsk(null); };
  return (
    <Ctx.Provider value={{ toast, ask: askFn }}>
      {children}
      <div className="fixed z-[60] bottom-20 md:bottom-5 left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center w-[min(92vw,420px)] no-print">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={cx('w-full rounded-2xl px-4 py-3 shadow-lg text-[13px] font-medium kit-rise', t.tone === 'ok' ? 'bg-ink text-white' : 'bg-bad text-white')}>{t.msg}</div>
        ))}
      </div>
      <Modal open={!!ask} onClose={() => close(null)} title={ask?.title}
        footer={<>
          <Button onClick={() => close(null)}>Cancel</Button>
          <Button variant={ask?.danger ? 'danger' : 'primary'} disabled={!!ask?.input && !val.trim()} onClick={() => close(ask?.input ? val : 'ok')}>{ask?.confirm ?? 'Confirm'}</Button>
        </>}>
        {ask?.message && <p className="text-zinc-600 mb-3">{ask.message}</p>}
        {ask?.input && <Field label={ask.input}><Textarea autoFocus value={val} onChange={(e) => setVal(e.target.value)} /></Field>}
      </Modal>
    </Ctx.Provider>
  );
}

/** Runs a store action, shows success / understandable error. Returns result or undefined on failure. */
export function useRun() {
  const { toast } = useUI();
  return <T,>(fn: () => T, ok?: string): T | undefined => {
    try {
      const r = fn();
      if (ok) toast(ok);
      return r;
    } catch (e) {
      toast(e instanceof AppError ? e.message : `Something went wrong: ${(e as Error).message}`, 'bad');
      console.error(e);
      return undefined;
    }
  };
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="5" /><path d="m11 11 3.5 3.5" /></svg>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9 rounded-full" />
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={cx('font-semibold tabular mt-0.5', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-bad')}>{value}</div>
    </div>
  );
}

/** Restricted-access placeholder shown when the role lacks permission. */
export const NoAccess = () => <Card><Empty title="You don't have access to this page" body="Ask a Super Admin to grant your role permission in Employees → Roles & permissions." /></Card>;

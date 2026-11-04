import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Button, Card, CardHeader, Empty, Money, PageHeader, SearchInput, Select, Table, Tabs, cx, useRun, useUI } from '../ui/kit';
import { CallButton, useCall, useRange } from '../ui/shell';
import { PaymentModal } from '../ui/modals';
import { financeFor, periodFigures } from '../domain/finance';
import { addDays, daysBetween, fmtDate, fmtINR, fmtPhone, inRange, todayIST } from '../domain/util';
import { downloadCSV } from '../lib/export';
import type { DB, Student } from '../domain/types';
import Collections from './Collections';

/**
 * The fee desk: one place to collect a fee, see who owes what, chase them, and check what came in.
 *  Dues      – everyone who owes money, most urgent first, with Collect / Call / WhatsApp on each row
 *  Payments  – what was received (daily tally by cash / UPI / bank …), with invoices
 *  To confirm – payments not yet matched to the bank
 *  All plans – every student's fee plan and progress
 */
type Tab = 'dues' | 'payments' | 'verify' | 'plans';
type Dues = 'all' | 'overdue' | 'today' | 'week' | 'part';
type Fin = ReturnType<typeof financeFor>;

/** Old /collections links keep working: they open the matching view here. */
export function CollectionsRedirect() {
  const db = S.useDB();
  const [sp] = useSearchParams();
  if (!S.allowed('fees', 'view', db)) return <Collections />; // a role with Collections but not Fees keeps the old page
  const v = sp.get('view');
  const map: Record<string, string> = { overdue: 'tab=dues&due=overdue', due_today: 'tab=dues&due=today', due_tomorrow: 'tab=dues&due=week', due7: 'tab=dues&due=week', partial: 'tab=dues&due=part', paid: 'tab=plans', today: 'tab=payments&when=today', all: 'tab=payments&when=period' };
  return <Navigate to={`/fees?${map[v ?? ''] ?? 'tab=dues'}`} replace />;
}

function reminderLink(db: DB, s: Student, f: Fin) {
  const n = f.lines.find((l) => l.status === 'Overdue') ?? f.next;
  if (!n) return '';
  const late = n.dueDate < todayIST();
  const body = `Hello ${s.name}, this is a gentle reminder from ${db.settings.academyName}: ${fmtINR(n.remaining)} (${n.label}) ${late ? 'was' : 'is'} due on ${fmtDate(n.dueDate)}. Please ignore if already paid.`;
  return `https://wa.me/91${s.phone}?text=${encodeURIComponent(body)}`;
}
const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function Fees() {
  const db = S.useDB();
  const [sp, setSp] = useSearchParams();
  const { range } = useRange();
  const today = todayIST();
  const tab = (sp.get('tab') as Tab) || 'dues';
  const setParam = (k: string, v: string) => { sp.set(k, v); setSp(sp, { replace: true }); };
  const [pay, setPay] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const canCollect = S.allowed('fees', 'create', db);

  const rows = useMemo(() => db.students.filter((s) => s.status !== 'Refunded' && s.status !== 'Dropped').map((s) => ({ s, f: financeFor(db, s.id, today) })), [db, today]);
  const owing = rows.filter((r) => r.f.outstanding > 0);
  const overdueRows = owing.filter((r) => r.f.lines.some((l) => l.status === 'Overdue'));
  const weekRows = owing.filter((r) => r.f.lines.some((l) => l.remaining > 0 && l.dueDate >= today && l.dueDate <= addDays(today, 7)));
  const sumLines = (rs: typeof rows, pick: (l: Fin['lines'][number]) => boolean) => rs.reduce((a, r) => a + r.f.lines.filter(pick).reduce((x, l) => x + l.remaining, 0), 0);
  const overdueAmt = sumLines(overdueRows, (l) => l.status === 'Overdue');
  const weekAmt = sumLines(weekRows, (l) => l.remaining > 0 && l.dueDate >= today && l.dueDate <= addDays(today, 7));
  const pendingAmt = owing.reduce((a, r) => a + r.f.outstanding, 0);

  const reversed = useMemo(() => new Set(db.payments.filter((p) => p.kind === 'reversal').map((p) => p.reversesId)), [db.payments]);
  const todays = db.payments.filter((p) => p.kind === 'payment' && p.verified && !reversed.has(p.id) && p.date === today);
  const unverified = db.payments.filter((p) => p.kind === 'payment' && !p.verified && !reversed.has(p.id));
  const fig = periodFigures(db, range[0], range[1], today);

  const tiles: [string, string, string, string, () => void][] = [
    ['Collected today', fmtINR(todays.reduce((a, p) => a + p.amount, 0)), `${todays.length} payment${todays.length === 1 ? '' : 's'}`, 'bg-sidebar text-white', () => { sp.set('tab', 'payments'); sp.set('when', 'today'); setSp(sp, { replace: true }); }],
    ['Overdue', fmtINR(overdueAmt), `${overdueRows.length} student${overdueRows.length === 1 ? '' : 's'}`, 'bg-[#f9d9d6]', () => { sp.set('tab', 'dues'); sp.set('due', 'overdue'); setSp(sp, { replace: true }); }],
    ['Due in 7 days', fmtINR(weekAmt), `${weekRows.length} student${weekRows.length === 1 ? '' : 's'}`, 'bg-[#fbe3cf]', () => { sp.set('tab', 'dues'); sp.set('due', 'week'); setSp(sp, { replace: true }); }],
    ['Total pending', fmtINR(pendingAmt), `${owing.length} student${owing.length === 1 ? '' : 's'} owe fees`, 'bg-[#f3e9cc]', () => { sp.set('tab', 'dues'); sp.set('due', 'all'); setSp(sp, { replace: true }); }],
  ];

  return (
    <>
      <PageHeader title="Fee management" sub="Collect fees, chase dues and check payments — all in one place."
        actions={canCollect && <Button variant="primary" className="h-11 px-5 text-[14.5px]" onClick={() => setPayOpen(true)}>+ Collect fee</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
        {tiles.map(([k, v, sub, bg, go]) => (
          <button key={k} onClick={go} className={cx('rounded-3xl px-4 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-14px_rgba(24,24,24,.4)]', bg)}>
            <div className={cx('text-[12px] font-medium', bg.includes('text-white') ? 'text-zinc-400' : 'text-zinc-600')}>{k}</div>
            <div className="text-[24px] sm:text-[26px] font-bold tabular leading-tight">{v}</div>
            <div className={cx('text-[12px]', bg.includes('text-white') ? 'text-lime' : 'text-zinc-600')}>{sub}</div>
          </button>
        ))}
      </div>
      <p className="text-[12.5px] text-muted mb-4">
        {fmtDate(range[0])} – {fmtDate(range[1])}: <b className="text-ink tabular">{fmtINR(fig.collected)}</b> collected · <b className="tabular">{fmtINR(fig.refunds)}</b> refunded · <b className="tabular">{fmtINR(fig.billed)}</b> newly billed
        <span className="hidden sm:inline"> (follows the date filter at the top)</span>
      </p>
      <Tabs value={tab} onChange={(t) => setParam('tab', t)} tabs={[
        { id: 'dues', label: 'Dues to collect', count: owing.length },
        { id: 'payments', label: 'Payments received' },
        ...(unverified.length || tab === 'verify' ? [{ id: 'verify' as Tab, label: 'To confirm', count: unverified.length }] : []),
        { id: 'plans', label: 'All fee plans', count: db.feePlans.length },
      ]} />
      {tab === 'dues' && <DuesTab rows={owing} counts={{ all: owing.length, overdue: overdueRows.length, today: owing.filter((r) => r.f.lines.some((l) => l.remaining > 0 && l.dueDate === today)).length, week: weekRows.length, part: owing.filter((r) => r.f.paid > 0).length }}
        due={(sp.get('due') as Dues) || 'all'} setDue={(d) => setParam('due', d)} onCollect={(id) => setPay(id)} canCollect={canCollect} />}
      {tab === 'payments' && <PaymentsTab when={(sp.get('when') as 'today' | 'yesterday' | 'period') || 'today'} setWhen={(w) => setParam('when', w)} reversed={reversed} />}
      {tab === 'verify' && <VerifyTab unverified={unverified} />}
      {tab === 'plans' && <PlansTab rows={rows} />}
      <PaymentModal open={payOpen || !!pay} onClose={() => { setPay(null); setPayOpen(false); }} studentId={pay ?? undefined} />
    </>
  );
}

// ------------------------------------------------------------------ dues
function DuesTab({ rows, counts, due, setDue, onCollect, canCollect }: {
  rows: { s: Student; f: Fin }[]; counts: Record<Dues, number>; due: Dues; setDue: (d: Dues) => void; onCollect: (id: string) => void; canCollect: boolean;
}) {
  const db = S.useDB();
  const { log } = useCall();
  const today = todayIST();
  const [q, setQ] = useState('');
  const [batch, setBatch] = useState('');
  const [sort, setSort] = useState<'oldest' | 'amount' | 'name'>('oldest');
  const [age, setAge] = useState<'' | 'w1' | 'w4' | 'm1'>('');
  const [limit, setLimit] = useState(30);
  const t = q.toLowerCase();
  const earliest = (r: { f: Fin }) => r.f.lines.find((l) => l.remaining > 0)?.dueDate ?? '9';
  const maxLate = (r: { f: Fin }) => Math.max(0, ...r.f.lines.filter((l) => l.status === 'Overdue').map((l) => daysBetween(l.dueDate, today)));
  const test: Record<Dues, (r: { f: Fin }) => boolean> = {
    all: () => true,
    overdue: (r) => r.f.lines.some((l) => l.status === 'Overdue'),
    today: (r) => r.f.lines.some((l) => l.remaining > 0 && l.dueDate === today),
    week: (r) => r.f.lines.some((l) => l.remaining > 0 && l.dueDate >= today && l.dueDate <= addDays(today, 7)),
    part: (r) => r.f.paid > 0,
  };
  const list = rows
    .filter((r) => test[due](r) && (!t || r.s.name.toLowerCase().includes(t) || r.s.phone.includes(t) || r.s.code.toLowerCase().includes(t)) && (!batch || r.s.batchId === batch))
    .filter((r) => due !== 'overdue' || !age || (age === 'w1' ? maxLate(r) <= 7 : age === 'w4' ? maxLate(r) > 7 && maxLate(r) <= 30 : maxLate(r) > 30))
    .sort((a, b) => sort === 'name' ? a.s.name.localeCompare(b.s.name) : sort === 'amount' ? b.f.outstanding - a.f.outstanding : earliest(a).localeCompare(earliest(b)));
  const total = list.reduce((a, r) => a + r.f.outstanding, 0);
  const chips: [Dues, string][] = [['all', 'All dues'], ['overdue', 'Overdue'], ['today', 'Due today'], ['week', 'Next 7 days'], ['part', 'Part paid']];
  const batches = db.batches.filter((b) => rows.some((r) => r.s.batchId === b.id));
  const lastCall = (id: string) => db.calls.find((c) => c.entity === 'student' && c.entityId === id);

  return (
    <>
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] mb-3 -mx-1 px-1">
        {chips.map(([id, k]) => (
          <button key={id} onClick={() => { setDue(id); setLimit(30); }} aria-pressed={due === id}
            className={cx('h-9 shrink-0 rounded-full px-3.5 text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors', due === id ? 'bg-ink text-white' : 'bg-white text-zinc-600 shadow-card hover:text-ink')}>
            {k}<span className={cx('rounded-full px-1.5 text-[11px] tabular', due === id ? 'bg-lime text-ink' : id === 'overdue' && counts.overdue ? 'bg-bad-soft text-bad' : 'bg-surface')}>{counts[id]}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, mobile or ID" className="w-full sm:w-64" />
        <Select value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="All batches" aria-label="Batch" options={batches.map((b) => ({ value: b.id, label: b.name }))} className="w-44" />
        {due === 'overdue' && <Select value={age} onChange={(e) => setAge(e.target.value as typeof age)} placeholder="Any delay" aria-label="How late" options={[{ value: 'w1', label: 'Up to 7 days late' }, { value: 'w4', label: '8–30 days late' }, { value: 'm1', label: 'Over 30 days late' }]} className="w-44" />}
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort" options={[{ value: 'oldest', label: 'Oldest due first' }, { value: 'amount', label: 'Highest balance first' }, { value: 'name', label: 'Name A–Z' }]} className="w-44" />
        {S.allowed('fees', 'export', db) && <Button className="ml-auto" disabled={!list.length} onClick={() => downloadCSV(list.map((r) => ({ Student: r.s.name, ID: r.s.code, Mobile: r.s.phone, 'Total fee': r.f.total / 100, Paid: r.f.paid / 100, Balance: r.f.outstanding / 100, 'Next due': r.f.next?.dueDate ?? '', Status: r.f.status })), `fee-dues-${due}`)}>⤓ Export</Button>}
      </div>
      {list.length > 0 && <p className="text-[12.5px] text-muted mb-2"><b className="text-ink">{list.length}</b> student{list.length === 1 ? '' : 's'} · balance <b className="text-ink tabular">{fmtINR(total)}</b></p>}
      {!list.length ? <Card><Empty title={rows.length ? 'No one matches these filters' : 'No dues 🎉'} body={rows.length ? 'Try “All dues” or clear the search.' : 'Every fee that is due has been paid.'} /></Card> : (
        <Card className="overflow-hidden divide-y divide-line">
          {list.slice(0, limit).map(({ s, f }) => {
            const od = f.lines.filter((l) => l.status === 'Overdue');
            const odAmt = od.reduce((a, l) => a + l.remaining, 0);
            const head = od[0] ?? f.next!;
            const late = od.length ? daysBetween(od[0].dueDate, today) : 0;
            const c = lastCall(s.id);
            const missed = c?.nextFollowUp && c.nextFollowUp < today;
            const b = db.batches.find((x) => x.id === s.batchId);
            const target = { entity: 'student' as const, id: s.id, name: s.name, phone: s.phone };
            const pct = f.total ? Math.round((f.paid / f.total) * 100) : 0;
            return (
              <div key={s.id} className="flex flex-col lg:flex-row lg:items-center gap-3 px-4 py-3.5 hover:bg-surface/60">
                <Link to={`/students/${s.id}?tab=fees`} className="flex items-start gap-3 min-w-0 flex-1">
                  <span className={cx('size-11 shrink-0 rounded-full grid place-items-center font-semibold text-[14px]', od.length ? 'bg-bad-soft text-bad' : 'bg-accent-soft text-accent')}>{initials(s.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2"><span className="font-semibold text-[15px]">{s.name}</span><Badge>{od.length ? 'Overdue' : f.status}</Badge></span>
                    <span className="block text-[13px] text-zinc-600 tabular">{fmtPhone(s.phone)} <span className="text-zinc-400">· {s.code}{b ? ` · ${b.name}` : ''}</span></span>
                    <span className="mt-1 flex items-center gap-2 max-w-xs" title={`${fmtINR(f.paid)} paid of ${fmtINR(f.total)}`}>
                      <span className="h-1.5 flex-1 rounded-full bg-zinc-100 overflow-hidden"><span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></span>
                      <span className="text-[11.5px] text-muted tabular whitespace-nowrap">{fmtINR(f.paid)} of {fmtINR(f.total)}</span>
                    </span>
                    {c && <span className={cx('block mt-1 text-[12px]', missed ? 'text-bad font-medium' : 'text-zinc-500')}>Last call: {c.outcome}{c.nextFollowUp ? ` · ${c.outcome === 'Promised to Pay' ? 'promised' : 'follow up'} ${fmtDate(c.nextFollowUp)}${missed ? ' (missed)' : ''}` : ''}</span>}
                  </span>
                </Link>
                <div className="lg:text-right lg:w-52 pl-14 lg:pl-0">
                  <div className={cx('text-[20px] font-bold tabular leading-tight', od.length ? 'text-bad' : 'text-ink')}>{fmtINR(od.length ? odAmt : head.remaining)}</div>
                  <div className="text-[12.5px] text-zinc-600">{head.label}{od.length > 1 ? ` + ${od.length - 1} more` : ''}</div>
                  <div className={cx('text-[12.5px]', od.length ? 'text-bad font-semibold' : head.dueDate === today ? 'text-warn font-semibold' : 'text-muted')}>
                    {od.length ? `${late} day${late === 1 ? '' : 's'} late · was ${fmtDate(head.dueDate)}` : head.dueDate === today ? 'Due today' : `Due ${fmtDate(head.dueDate)}`}
                  </div>
                  {f.outstanding > (od.length ? odAmt : head.remaining) && <div className="text-[11.5px] text-muted">Total balance {fmtINR(f.outstanding)}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-14 lg:pl-0 lg:shrink-0">
                  {canCollect && <Button variant="primary" className="h-10" onClick={() => onCollect(s.id)}>Collect</Button>}
                  <CallButton size="md" target={target} label="Call" />
                  {s.remindersOptOut
                    ? <Button disabled className="h-10" title="Student opted out of reminders">Remind</Button>
                    : <a href={reminderLink(db, s, f)} target="_blank" rel="noreferrer" title="Send a WhatsApp reminder"
                        className="inline-flex items-center justify-center gap-1.5 h-10 px-3.5 rounded-full border border-[#25d366]/40 bg-[#e9fbef] text-[#128c4a] font-semibold hover:bg-[#d4f7e0] transition-colors">WhatsApp</a>}
                  <Button className="h-10" onClick={() => log(target)}>Log call</Button>
                </div>
              </div>
            );
          })}
          {list.length > limit && <button onClick={() => setLimit(limit + 30)} className="w-full py-3 text-[13.5px] font-semibold text-accent hover:bg-surface">Show {Math.min(30, list.length - limit)} more ({list.length - limit} left)</button>}
        </Card>
      )}
    </>
  );
}

// ------------------------------------------------------------------ payments received
function PaymentsTab({ when, setWhen, reversed }: { when: 'today' | 'yesterday' | 'period'; setWhen: (w: 'today' | 'yesterday' | 'period') => void; reversed: Set<string | undefined> }) {
  const db = S.useDB();
  const nav = useNavigate();
  const run = useRun();
  const { ask } = useUI();
  const { range } = useRange();
  const today = todayIST();
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const sOf = (id: string) => db.students.find((s) => s.id === id);
  const inWhen = (d: string) => (when === 'today' ? d === today : when === 'yesterday' ? d === addDays(today, -1) : inRange(d, range));
  const t = q.toLowerCase();
  const list = db.payments.filter((p) => inWhen(p.date) && (!method || p.method === method) && (!t || (sOf(p.studentId)?.name.toLowerCase().includes(t) ?? false) || p.reference.toLowerCase().includes(t)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const good = list.filter((p) => p.kind === 'payment' && p.verified && !reversed.has(p.id));
  const byMethod = new Map<string, number>();
  for (const p of good) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
  const total = good.reduce((a, p) => a + p.amount, 0);
  const label = when === 'today' ? 'Today' : when === 'yesterday' ? 'Yesterday' : 'Selected period';

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1 rounded-full bg-white p-1 shadow-card">
          {([['today', 'Today'], ['yesterday', 'Yesterday'], ['period', 'Date filter']] as const).map(([id, k]) => (
            <button key={id} onClick={() => setWhen(id)} className={cx('h-8 px-3.5 rounded-full text-[13px] font-semibold', when === id ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{k}</button>
          ))}
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Student or reference" className="w-full sm:w-56" />
        <Select value={method} onChange={(e) => setMethod(e.target.value)} placeholder="All methods" aria-label="Method" options={['Cash', 'UPI', 'Bank Transfer', 'Card', 'Online Gateway']} className="w-40" />
        {S.allowed('fees', 'export', db) && <Button className="ml-auto" disabled={!list.length} onClick={() => downloadCSV(list.map((p) => ({ Txn: p.id, Type: p.kind, Date: p.date, Student: sOf(p.studentId)?.name ?? '', Amount: (p.kind === 'payment' ? p.amount : -p.amount) / 100, Method: p.method, Reference: p.reference, Verified: p.verified ? 'yes' : 'no', Reverses: p.reversesId ?? '', 'Received by': S.empName(p.receivedBy, db), Invoice: p.receiptNo, Notes: p.notes })), `payments-${when}`)}>⤓ Export</Button>}
      </div>
      <div className="rounded-3xl bg-sidebar text-white p-5 mb-4">
        <div className="text-[12.5px] text-zinc-400">{label} · money received</div>
        <div className="text-[30px] font-bold tabular leading-tight">{fmtINR(total)}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[...byMethod].sort((a, b) => b[1] - a[1]).map(([m, v]) => (
            <span key={m} className="rounded-full bg-sidebar-2 px-3 py-1 text-[12.5px]"><span className="text-zinc-400">{m}</span> <b className="tabular text-lime">{fmtINR(v)}</b></span>
          ))}
          {!byMethod.size && <span className="text-[12.5px] text-zinc-500">Nothing received {when === 'period' ? 'in this period' : when}.</span>}
        </div>
      </div>
      <Card>
        <Table rows={list} rowKey={(p) => p.id} onRow={(p) => nav(`/students/${p.studentId}?tab=payments`)} empty={<Empty title="No payments here" body="Try another day or clear the filters." />} cols={[
          { key: 'd', label: 'Date', render: (p) => fmtDate(p.date), sort: (p) => p.date },
          { key: 's', label: 'Student', render: (p) => <span className="font-medium">{sOf(p.studentId)?.name ?? '—'}</span> },
          { key: 'a', label: 'Amount', className: 'text-right', sort: (p) => p.amount, render: (p) => <Money v={p.kind === 'payment' ? p.amount : -p.amount} className={reversed.has(p.id) ? 'line-through text-muted' : p.kind !== 'payment' ? 'text-bad' : ''} /> },
          { key: 'm', label: 'Method', render: (p) => p.method },
          { key: 'r', label: 'Reference', render: (p) => p.reference || p.reversesId || '—' },
          { key: 'v', label: 'Status', render: (p) => p.kind === 'refund' ? <Badge tone="red">Refund</Badge> : p.kind === 'reversal' ? <Badge tone="red">Cancelled entry</Badge> : reversed.has(p.id) ? <Badge tone="gray">Cancelled</Badge> : p.verified ? <Badge tone="green">Received</Badge> : <Badge tone="orange">Not confirmed</Badge> },
          { key: 'b', label: 'By', render: (p) => S.empName(p.receivedBy, db) },
          { key: 'i', label: '', render: (p) => p.kind === 'payment' && !reversed.has(p.id) && <span onClick={(e) => e.stopPropagation()} className="inline-flex gap-1">
            <Link to={`/receipt/${p.id}`} target="_blank" className="text-[12.5px] font-semibold text-accent hover:underline px-1">Invoice</Link>
            {S.allowed('fees', 'approve', db) && <button className="text-[12.5px] font-medium text-bad hover:underline px-1" onClick={async () => { const r = await ask({ title: 'Cancel this payment?', message: 'It stays in the records, marked as cancelled, and the student’s balance goes back up.', input: 'Reason', confirm: 'Cancel payment', danger: true }); if (r) run(() => S.reversePayment(p.id, r), 'Payment cancelled'); }}>Cancel</button>}
          </span> },
        ]} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ to confirm
function VerifyTab({ unverified }: { unverified: ReturnType<typeof S.getDB>['payments'] }) {
  const db = S.useDB();
  const run = useRun();
  const { ask } = useUI();
  const sName = (id: string) => db.students.find((s) => s.id === id)?.name ?? '—';
  return (
    <Card>
      <CardHeader title="Payments waiting to be confirmed" sub="These are not counted as collected until you check them against the bank / UPI / gateway statement." />
      <Table rows={unverified} rowKey={(p) => p.id} empty={<Empty title="Everything is confirmed 🎉" />} cols={[
        { key: 'd', label: 'Date', render: (p) => fmtDate(p.date) }, { key: 's', label: 'Student', render: (p) => <span className="font-medium">{sName(p.studentId)}</span> },
        { key: 'a', label: 'Amount', render: (p) => <Money v={p.amount} />, className: 'text-right' }, { key: 'm', label: 'Method', render: (p) => p.method }, { key: 'r', label: 'Reference', render: (p) => p.reference || '—' },
        { key: 'x', label: '', render: (p) => S.allowed('fees', 'approve', db) && <div className="flex gap-1">
          <Button size="sm" variant="primary" onClick={() => run(() => S.verifyPayment(p.id), 'Payment confirmed')}>Money received</Button>
          <Button size="sm" variant="ghost" onClick={async () => { const r = await ask({ title: 'Money not received?', message: 'The payment will be cancelled. It stays in the records, marked as cancelled.', input: 'Reason', confirm: 'Cancel payment', danger: true }); if (r) run(() => S.reversePayment(p.id, r), 'Payment cancelled'); }}>Not received</Button>
        </div> },
      ]} />
    </Card>
  );
}

// ------------------------------------------------------------------ all plans
function PlansTab({ rows }: { rows: { s: Student; f: Fin }[] }) {
  const db = S.useDB();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [batch, setBatch] = useState('');
  const [status, setStatus] = useState('');
  const t = q.toLowerCase();
  const list = rows.filter((r) => r.f.lines.length && (!t || r.s.name.toLowerCase().includes(t) || r.s.code.toLowerCase().includes(t) || r.s.phone.includes(t)) && (!batch || r.s.batchId === batch) && (!status || r.f.status === status));
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, mobile or ID" className="w-full sm:w-64" />
        <Select value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="All batches" aria-label="Batch" options={db.batches.map((b) => ({ value: b.id, label: b.name }))} className="w-44" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Any status" aria-label="Status" options={['Paid', 'Partially Paid', 'Pending', 'Due Soon', 'Overdue'].map((v) => ({ value: v, label: v === 'Paid' ? 'Fully paid' : v === 'Partially Paid' ? 'Part paid' : v }))} className="w-40" />
      </div>
      <Card>
        <Table rows={list} rowKey={(r) => r.s.id} onRow={(r) => nav(`/students/${r.s.id}?tab=fees`)} empty={<Empty title="No fee plans" body="Fee plans are created automatically on admission." />} cols={[
          { key: 'n', label: 'Student', render: (r) => <span className="font-medium">{r.s.name} <span className="text-muted font-normal">{r.s.code}</span></span>, sort: (r) => r.s.name },
          { key: 't', label: 'Course fee', render: (r) => <Money v={r.f.total} />, className: 'text-right', sort: (r) => r.f.total },
          { key: 'p', label: 'Paid', className: 'min-w-40', sort: (r) => r.f.paid, render: (r) => <div><Money v={r.f.paid} className="text-ok" /><div className="h-1.5 mt-1 rounded-full bg-zinc-100 overflow-hidden w-28"><div className="h-full rounded-full bg-accent" style={{ width: `${r.f.total ? Math.round((r.f.paid / r.f.total) * 100) : 0}%` }} /></div></div> },
          { key: 'o', label: 'Balance', render: (r) => <Money v={r.f.outstanding} />, className: 'text-right', sort: (r) => r.f.outstanding },
          { key: 'nx', label: 'Next due', render: (r) => (r.f.next ? `${fmtDate(r.f.next.dueDate)} · ${fmtINR(r.f.next.remaining)}` : '—'), sort: (r) => r.f.next?.dueDate ?? '9' },
          { key: 's', label: 'Status', render: (r) => <Badge>{r.f.status}</Badge>, sort: (r) => r.f.status },
        ]} />
      </Card>
    </>
  );
}

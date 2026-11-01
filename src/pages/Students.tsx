import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Button, Card, CardHeader, Checkbox, Empty, Field, Input, LogoMark, Modal, Money, SearchInput, Select, Stat, Table, Tabs, Textarea, cx, useRun, useUI } from '../ui/kit';
import { CallButton, useCall } from '../ui/shell';
import { PaymentModal } from '../ui/modals';
import { UploadBox } from './Admissions';
import { aadhaarUrl, removeAadhaar, storeAadhaar } from '../lib/aadhaarFiles';
import { cloudEnabled, setStudentLogin, studentLoginExists } from '../store/cloud';
import { financeFor } from '../domain/finance';
import { GENDERS, PAY_METHODS, STUDENT_STATUSES, type DB, type IdDocument, type PayMethod, type Student, type StudentStatus } from '../domain/types';
import { daysBetween, fmtDate, fmtDateTime, fmtINR, fmtPhone, parseRupees, todayIST } from '../domain/util';
import { downloadCSV } from '../lib/export';
import { resizeImage } from '../lib/ocr';
import { StatTile } from './Dashboard';
import { InvoiceTable } from './Invoices';

type Fin = ReturnType<typeof financeFor>;

// ---------------- small visual helpers (this page only) ----------------
const ICON = {
  eye: 'M1.5 8S4 3 8 3s6.5 5 6.5 5S12 13 8 13 1.5 8 1.5 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  edit: 'M11 2.5 13.5 5 6 12.5H3.5V10zM9.5 4l2.5 2.5',
  rupee: 'M4.5 2.5h7M4.5 5.5h7M7 2.5c2.5 0 3 1.5 3 3s-1.2 3-3.5 3H4.5l5 5',
  history: 'M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5',
  bell: 'M4 6.5a4 4 0 0 1 8 0c0 4 1.5 5.5 1.5 5.5h-11S4 10.5 4 6.5ZM6.5 14h3',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  phone: 'M3 2h3l1.5 3.5-2 1.2a8 8 0 0 0 3.8 3.8l1.2-2L14 10v3a1 1 0 0 1-1 1A11 11 0 0 1 2 3a1 1 0 0 1 1-1Z',
  mail: 'M2 3.5h12v9H2zM2 4l6 5 6-5',
  cal: 'M2 3h12v10H2zM2 6h12M5.5 1.5v3M10.5 1.5v3',
  layers: 'M8 2 1.5 5.5 8 9l6.5-3.5zM1.5 8.5 8 12l6.5-3.5M1.5 11.5 8 15l6.5-3.5',
  list: 'M2 3.5h12M2 8h12M2 12.5h12',
  idcards: 'M1.5 2.5h5.5v5H1.5zM9 2.5h5.5v5H9zM1.5 9h5.5v4.5H1.5zM9 9h5.5v4.5H9z',
  id: 'M1.5 3.5h13v9h-13zM4 10.5c.4-1.2 1.2-1.8 2-1.8s1.6.6 2 1.8M6 7.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4ZM10 6.5h2.5M10 9h2.5',
  users: 'M6 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.5 13.5a4.5 4.5 0 0 1 9 0M11 2.5a2.5 2.5 0 0 1 0 4.5M12.5 9.5a4.5 4.5 0 0 1 2 4',
  wallet: 'M2 4.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2zM2 4.5l8.5-2.5v2.5M11 9h.01',
  check: 'M2.5 8.5 6 12l7.5-8',
  alert: 'M8 2 1.5 13.5h13zM8 6.5v3M8 11.5h.01',
  camera: 'M2 5h2.5L6 3h4l1.5 2H14v8H2zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  book: 'M2 3h4.5A1.5 1.5 0 0 1 8 4.5V14a1.5 1.5 0 0 0-1.5-1.5H2zM14 3H9.5A1.5 1.5 0 0 0 8 4.5V14a1.5 1.5 0 0 1 1.5-1.5H14z',
};
const Ic = ({ d, className = 'size-4' }: { d: string; className?: string }) => (
  <svg viewBox="0 0 16 16" className={cx('shrink-0', className)} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const pct = (a: number, b: number) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
function Bar({ value, tone = 'bg-accent', className }: { value: number; tone?: string; className?: string }) {
  return <div className={cx('h-1.5 rounded-full bg-zinc-200/80 overflow-hidden', className)}><div className={cx('h-full rounded-full transition-[width]', tone)} style={{ width: `${value}%` }} /></div>;
}
/** "In 3 days" / "5 days overdue" chip for a due date. */
function DueChip({ date, today }: { date: string; today: string }) {
  const d = daysBetween(today, date);
  const [txt, cls] = d < 0 ? [`${-d}d overdue`, 'bg-bad-soft text-bad'] : d === 0 ? ['Due today', 'bg-warn-soft text-warn'] : d <= 7 ? [`In ${d}d`, 'bg-warn-soft text-warn'] : [`In ${d}d`, 'bg-zinc-100 text-zinc-600'];
  return <span className={cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap', cls)}>{txt}</span>;
}
// ponytail: WhatsApp hand-off (staff presses send), same as Notifications; a provider API arrives with the backend.
function reminderLink(db: DB, s: Student, f: Fin) {
  const n = f.next;
  if (!n) return '';
  const late = n.dueDate < todayIST();
  const body = `Hello ${s.name}, this is a gentle reminder from ${db.settings.academyName}: ${fmtINR(n.remaining)} (${n.label}) ${late ? 'was' : 'is'} due on ${fmtDate(n.dueDate)}. Please ignore if already paid.`;
  return `https://wa.me/91${s.phone}?text=${encodeURIComponent(body)}`;
}
function attendanceFor(db: DB, id: string) {
  const enrols = db.enrolments.filter((e) => e.studentId === id);
  const sessions = db.attendance.filter((a) => enrols.some((e) => e.batchId === a.batchId && a.date >= e.from && (!e.to || a.date <= e.to))).sort((a, b) => b.date.localeCompare(a.date));
  return { enrols, sessions, present: sessions.filter((a) => a.present.includes(id)).length };
}

// ---------------- list ----------------
export function StudentList() {
  const db = S.useDB();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [q, setQ] = useState('');
  const [batch, setBatch] = useState('');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [pay, setPay] = useState('');
  const [from, setFrom] = useState(sp.get('from') ?? '');
  const [to, setTo] = useState(sp.get('to') ?? '');
  const [owing, setOwing] = useState(false);
  const [payFor, setPayFor] = useState('');
  const [limit, setLimit] = useState(30);
  const [view, setViewState] = useState<'table' | 'cards'>(() => { try { return localStorage.getItem('studentsView') === 'cards' ? 'cards' : 'table'; } catch { return 'table'; } });
  const setView = (v: 'table' | 'cards') => { setViewState(v); try { localStorage.setItem('studentsView', v); } catch { /* */ } };
  const fees = S.allowed('fees', 'view', db);
  const today = todayIST();
  const rows = useMemo(() => db.students.map((s) => ({ s, f: financeFor(db, s.id, today) })), [db]);
  const t = q.trim().toLowerCase();
  const digits = t.replace(/\D/g, '');
  const shown = rows.filter(({ s, f }) =>
    (!t || s.name.toLowerCase().includes(t) || (digits.length > 2 && s.phone.includes(digits)) || s.code.toLowerCase().includes(t) || s.email.toLowerCase().includes(t)) &&
    (!batch || s.batchId === batch) && (!status || s.status === status) && (!pay || f.status === pay) &&
    (!from || s.admissionDate >= from) && (!to || s.admissionDate <= to) && (!owing || f.outstanding > 0));
  const bOf = (id: string) => db.batches.find((b) => b.id === id);
  const bName = (id: string) => bOf(id)?.name ?? '—';
  const activeFilters = [q, batch, status, pay, from, to, owing].filter(Boolean).length;
  const clear = () => { setQ(''); setBatch(''); setStatus(''); setPay(''); setFrom(''); setTo(''); setOwing(false); };
  const sumOf = (k: 'total' | 'paid' | 'outstanding') => shown.reduce((a, r) => a + r.f[k], 0);
  const onPlans = shown.filter((r) => r.f.lines.length).length;
  const refunds = shown.reduce((a, r) => a + r.f.refunded, 0);
  let owedOverdue = 0, owedUpcoming = 0; // same split as the Dashboard's pending / overdue fees
  for (const { f } of shown) for (const l of f.lines) if (l.remaining > 0) l.status === 'Overdue' ? (owedOverdue += l.remaining) : (owedUpcoming += l.remaining);
  const scope = activeFilters ? 'Matching your filters' : 'All students';
  const countBy = (st: string) => db.students.filter((s) => s.status === st).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-navy">Students</h1>
          <p className="text-muted mt-0.5">{activeFilters ? `${shown.length} of ${db.students.length} students match your filters` : `${db.students.length} students enrolled`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {S.allowed('students', 'export', db) && <Button onClick={() => downloadCSV(shown.map(({ s, f }) => ({ ID: s.code, Name: s.name, Mobile: s.phone, Email: s.email, Batch: bName(s.batchId), Admitted: s.admissionDate, Status: s.status, Source: s.source, ...(fees ? { 'Total fee': f.total / 100, Paid: f.paid / 100, Outstanding: f.outstanding / 100, 'Payment status': f.status } : {}) })), 'students')}>Export</Button>}
          {S.allowed('admissions', 'create', db) && <Button variant="primary" onClick={() => nav('/admissions')}>+ New admission</Button>}
        </div>
      </div>

      {/* summary — same tiles as the Dashboard; figures cover the students currently shown */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <StatTile color="#15803d" icon="students" label="Total students" scope={scope} value={shown.length}
          subs={[['Active', shown.filter((r) => r.s.status === 'Active').length], ['Completed', shown.filter((r) => r.s.status === 'Completed').length], ['Other', shown.filter((r) => r.s.status !== 'Active' && r.s.status !== 'Completed').length]]} />
        {fees ? <>
          <StatTile color="#1d4ed8" icon="wallet" label="Total fees" scope={scope} value={fmtINR(sumOf('total'))} to="/fees"
            subs={[['On fee plans', onPlans], ['Average fee', onPlans ? fmtINR(Math.round(sumOf('total') / onPlans)) : '—']]} />
          <StatTile color="#047857" icon="rupee" label="Fees collected" scope={scope} value={fmtINR(sumOf('paid'))} to="/collections?view=all"
            subs={[['Collected', `${pct(sumOf('paid'), sumOf('total'))}%`], ['Refunds', fmtINR(refunds)]]} />
          <StatTile color="#c2410c" icon="clock" label="Pending fees" scope={scope} value={fmtINR(sumOf('outstanding'))} to="/collections?view=overdue"
            subs={[['Overdue', fmtINR(owedOverdue)], ['Upcoming', fmtINR(owedUpcoming)]]} />
        </> : <>
          <StatTile color="#047857" icon="userPlus" label="Active" scope={scope} value={countBy('Active')} note="Currently studying" />
          <StatTile color="#1d4ed8" icon="target" label="Completed" scope={scope} value={countBy('Completed')} note="Finished the course" />
          <StatTile color="#6d28d9" icon="alert" label="Inactive / dropped" scope={scope} value={countBy('Inactive') + countBy('Dropped')} note="Not attending" />
        </>}
      </div>

      {/* status tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div role="tablist" className="flex gap-1 p-1 rounded-xl bg-zinc-100/80 border border-line overflow-x-auto [scrollbar-width:none] max-w-full">
          {[['', 'All', db.students.length] as const, ...STUDENT_STATUSES.map((st) => [st, st, countBy(st)] as const)].map(([v, l, n]) => (
            <button key={l} role="tab" aria-selected={status === v} onClick={() => setStatus(v)} className={cx('shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium transition-colors',
              status === v ? 'bg-navy text-white shadow-sm' : 'text-zinc-600 hover:text-navy hover:bg-white')}>
              {l}<span className={cx('tabular text-[11px] leading-none rounded-md px-1.5 py-1 min-w-5 text-center', status === v ? 'bg-white/15 text-white' : 'bg-white text-zinc-500 border border-line')}>{n}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[12.5px] text-muted">Showing <b className="text-navy tabular">{shown.length}</b> of {db.students.length}</span>
          <div role="group" aria-label="View" className="flex p-0.5 rounded-lg bg-zinc-100/80 border border-line">
            {([['table', 'Table', ICON.list], ['cards', 'ID cards', ICON.idcards]] as const).map(([v, l, icon]) => (
              <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={cx('inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12.5px] font-medium transition-colors', view === v ? 'bg-white text-navy shadow-sm' : 'text-zinc-500 hover:text-navy')}>
                <Ic d={icon} className="size-3.5" />{l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* filters — one row on wide screens */}
      <div className={cx('grid grid-cols-2 md:grid-cols-4 gap-3 items-end rounded-xl border border-line bg-surface p-3 sm:p-4 mb-4',
        fees ? 'xl:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]' : 'xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]')}>
        <div className="col-span-2 xl:col-span-1"><FilterLabel>Search</FilterLabel><SearchInput value={q} onChange={setQ} placeholder="Name, mobile, student ID or email" /></div>
        <div><FilterLabel>Batch</FilterLabel><Select value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="All batches" options={db.batches.map((b) => ({ value: b.id, label: b.name }))} /></div>
        {fees && <div><FilterLabel>Payment status</FilterLabel><Select value={pay} onChange={(e) => setPay(e.target.value)} placeholder="Any status" options={[{ value: 'Paid', label: 'Paid' }, { value: 'Partially Paid', label: 'Part paid' }, { value: 'Due Soon', label: 'Due soon' }, { value: 'Pending', label: 'Pending' }, { value: 'Overdue', label: 'Overdue' }, { value: 'Refunded', label: 'Refunded' }]} /></div>}
        <div><FilterLabel>Admission from</FilterLabel><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><FilterLabel>Admission to</FilterLabel><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className={cx('flex items-center justify-end gap-4 h-9', fees ? 'col-span-2 md:col-span-2 xl:col-span-1' : 'col-span-2 md:col-span-1 xl:col-span-1')}>
          {activeFilters > 0 && <button onClick={clear} className="text-[12.5px] font-medium text-navy hover:underline whitespace-nowrap">Clear all ({activeFilters})</button>}
          {fees && <Checkbox checked={owing} onChange={(e) => setOwing(e.target.checked)} label={<span className="whitespace-nowrap font-medium text-zinc-700">Has balance</span>} />}
        </div>
      </div>

      {view === 'cards' ? (
        <>
          {!shown.length && <Card><Empty title={db.students.length ? 'No students match these filters' : 'No students yet'} action={activeFilters > 0 && <Button onClick={clear}>Clear filters</Button>} /></Card>}
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 min-[1700px]:grid-cols-4 gap-4">
            {shown.slice(0, limit).map(({ s, f }) => <StudentIdCard key={s.id} s={s} f={f} onPay={setPayFor} />)}
          </div>
          {shown.length > limit && <div className="mt-4 text-center"><Button onClick={() => setLimit(limit + 30)}>Show more ({shown.length - limit} left)</Button></div>}
        </>
      ) : <>
      {/* desktop / tablet table — fixed column widths; optional columns appear as space allows; actions stay pinned */}
      <Card className="hidden md:block overflow-hidden shadow-[0_1px_3px_rgba(15,35,65,.05)]">
        <Table rows={shown} rowKey={(r) => r.s.id} onRow={(r) => nav(`/students/${r.s.id}`)}
          className="table-fixed min-w-[700px] [&_th]:whitespace-normal [&_th]:leading-tight [&_th]:px-3 [&_th]:py-3 [&_td]:px-3 [&_td]:py-3 [&_thead_tr]:bg-surface [&_th:last-child]:bg-surface [&_th]:text-[11px] [&_th]:font-semibold [&_th]:text-zinc-500"
          empty={<Empty title={db.students.length ? 'No students match these filters' : 'No students yet'} body={db.students.length ? undefined : 'Admit a student or convert a lead.'} action={activeFilters > 0 && <Button onClick={clear}>Clear filters</Button>} />}
          cols={[
            { key: 'name', label: 'Student', sort: (r) => r.s.name, render: (r) => (
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar name={r.s.name} photo={r.s.photo} size="size-9" />
                <div className="min-w-0 leading-tight"><div className="font-semibold text-navy truncate">{r.s.name}</div><div className="text-[11.5px] text-muted mt-1 tabular truncate">{r.s.code} · {fmtPhone(r.s.phone)}</div><div className="xl:hidden text-[11.5px] text-zinc-500 mt-0.5 truncate">{bName(r.s.batchId)}</div></div>
              </div>
            ) },
            { key: 'batch', label: 'Batch', className: 'hidden xl:table-cell w-[148px]', sort: (r) => bName(r.s.batchId), render: (r) => <div className="leading-tight min-w-0"><div className="font-medium text-zinc-800 truncate">{bName(r.s.batchId)}</div><div className="text-[11.5px] text-muted mt-1 truncate">{bOf(r.s.batchId)?.timing ?? ''}</div></div> },
            { key: 'adm', label: 'Admission date', className: 'hidden min-[1400px]:table-cell w-[104px]', sort: (r) => r.s.admissionDate, render: (r) => <span className="tabular text-zinc-700">{fmtDate(r.s.admissionDate)}</span> },
            { key: 'st', label: 'Status', className: 'w-[100px]', sort: (r) => r.s.status, render: (r) => <div className="flex flex-col items-start gap-1"><Badge>{r.s.status}</Badge>{fees && <Badge>{r.f.status}</Badge>}</div> },
            ...(fees ? [
              { key: 'fees', label: 'Fee progress', className: 'w-[144px]', sort: (r: SRow) => pct(r.f.paid, r.f.total), render: (r: SRow) => (
                <div>
                  <div className="flex items-baseline justify-between gap-2 text-[12px] tabular"><span><b className="text-navy">{fmtINR(r.f.paid)}</b><span className="text-muted"> / {fmtINR(r.f.total)}</span></span></div>
                  <div className="mt-1.5 flex items-center gap-2"><Bar value={pct(r.f.paid, r.f.total)} className="flex-1 h-1" /><span className="text-[11px] text-muted tabular w-8 text-right">{pct(r.f.paid, r.f.total)}%</span></div>
                  {/* Pending balance column is hidden below xl — show it here instead */}
                  <div className="xl:hidden mt-1 text-[11.5px]">{r.f.outstanding > 0 ? <span className="font-semibold text-warn tabular">{fmtINR(r.f.outstanding)} pending</span> : <span className="font-medium text-accent">Fully paid</span>}</div>
                </div>
              ) },
              { key: 'out', label: 'Pending balance', className: 'hidden xl:table-cell w-[100px] text-right', sort: (r: SRow) => r.f.outstanding, render: (r: SRow) => r.f.outstanding > 0
                ? <span className="font-semibold text-warn tabular">{fmtINR(r.f.outstanding)}</span>
                : <span className="text-[12px] font-medium text-accent">Fully paid</span> },
              { key: 'next', label: 'Next due date', className: 'w-[104px]', sort: (r: SRow) => r.f.next?.dueDate ?? '9', render: (r: SRow) => r.f.next
                ? <div className="leading-tight"><div className="tabular text-zinc-700">{fmtDate(r.f.next.dueDate)}</div><div className="mt-1"><DueChip date={r.f.next.dueDate} today={today} /></div></div>
                : <span className="text-muted">—</span> },
            ] : []),
            // pinned right so actions stay reachable if the table scrolls sideways
            { key: 'act', label: 'Actions', className: 'w-[146px] text-right sticky right-0 bg-white shadow-[-8px_0_12px_-10px_rgba(15,35,65,.25)]', render: (r) => <RowActions s={r.s} f={r.f} onPay={setPayFor} /> },
          ]} />
      </Card>

      {/* phone cards */}
      <div className="md:hidden space-y-3">
        {!shown.length && <Card><Empty title={db.students.length ? 'No students match these filters' : 'No students yet'} action={activeFilters > 0 && <Button onClick={clear}>Clear filters</Button>} /></Card>}
        {/* ponytail: "show more" paging; virtualise if an academy passes a few thousand students */}
        {shown.slice(0, limit).map(({ s, f }) => (
          <Card key={s.id} className="p-4 shadow-[0_1px_3px_rgba(15,35,65,.06)]">
            <div className="flex items-start gap-3" onClick={() => nav(`/students/${s.id}`)}>
              <Avatar name={s.name} photo={s.photo} size="size-11" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{s.name}</div>
                <div className="text-[12px] text-muted">{s.code} · {fmtPhone(s.phone)}</div>
                <div className="flex flex-wrap gap-1 mt-1.5"><Badge>{s.status}</Badge>{fees && <Badge>{f.status}</Badge>}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3 text-[12px]">
              <div><div className="text-muted">Batch</div><div className="font-medium truncate">{bName(s.batchId)}</div></div>
              <div><div className="text-muted">Enrolled</div><div className="font-medium">{fmtDate(s.admissionDate)}</div></div>
            </div>
            {fees && f.lines.length > 0 && (
              <div className="mt-3 rounded-xl bg-surface border border-line p-3">
                <div className="flex justify-between text-[12px] tabular"><span><b className="text-accent">{fmtINR(f.paid)}</b> <span className="text-muted">of {fmtINR(f.total)}</span></span>{f.next && <DueChip date={f.next.dueDate} today={today} />}</div>
                <Bar value={pct(f.paid, f.total)} tone={f.status === 'Overdue' ? 'bg-bad' : 'bg-accent'} className="mt-2" />
                {f.outstanding > 0 && <div className={cx('text-[12px] mt-1.5', f.status === 'Overdue' ? 'text-bad font-semibold' : 'text-zinc-600')}>{fmtINR(f.outstanding)} pending{f.next && ` · next ${fmtDate(f.next.dueDate)}`}</div>}
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-line flex justify-end"><RowActions s={s} f={f} onPay={setPayFor} /></div>
          </Card>
        ))}
        {shown.length > limit && <Button className="w-full" onClick={() => setLimit(limit + 30)}>Show more ({shown.length - limit} left)</Button>}
      </div>

      </>}

      <PaymentModal key={payFor} open={!!payFor} onClose={() => setPayFor('')} studentId={payFor || undefined} />
    </>
  );
}
type SRow = { s: Student; f: Fin };

const FilterLabel = ({ children }: { children: ReactNode }) => <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">{children}</div>;
/** Student identity card — the "ID cards" view of the Students list. Click opens the profile; actions stop the click. */
function StudentIdCard({ s, f, onPay }: { s: Student; f: Fin; onPay: (id: string) => void }) {
  const db = S.useDB();
  const nav = useNavigate();
  const fees = S.allowed('fees', 'view', db);
  const batch = db.batches.find((b) => b.id === s.batchId);
  const course = db.courses.find((c) => c.id === s.courseId);
  const today = todayIST();
  const paidPct = pct(f.paid, f.total);
  return (
    <div role="link" tabIndex={0} onClick={() => nav(`/students/${s.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/students/${s.id}`)}
      className="group flex flex-col rounded-2xl bg-white border border-line overflow-hidden cursor-pointer shadow-[0_2px_10px_-4px_rgba(15,35,65,.18)] hover:shadow-[0_14px_30px_-12px_rgba(15,35,65,.35)] hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-accent transition-all">
      {/* card header band */}
      <div className="relative h-20 bg-gradient-to-r from-navy via-[#173563] to-[#0b4d2c] px-4 flex items-start justify-between pt-3">
        <div className="absolute inset-0 opacity-[.08] bg-[radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:14px_14px]" />
        <div className="relative flex items-center gap-2">
          <span className="size-7 rounded-md bg-white grid place-items-center"><LogoMark className="size-5" /></span>
          <div className="leading-tight text-white">
            <div className="text-[11px] font-bold tracking-[0.18em]">INVEST<span className="text-[#5be35b]">MORE</span></div>
            <div className="text-[9px] uppercase tracking-[0.14em] text-white/65">Student identity card</div>
          </div>
        </div>
        <span className={cx('relative text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5',
          s.status === 'Active' ? 'bg-[#5be35b]/20 text-[#9ff59f]' : s.status === 'Completed' ? 'bg-white/20 text-white' : 'bg-white/10 text-white/70')}>{s.status}</span>
      </div>

      <div className="px-4 pb-4 flex-1 flex flex-col">
        {/* photo + name */}
        {/* photo overlaps the band; the name starts just below it (container is pulled up 32px, name pushed down 36px) */}
        <div className="flex items-start gap-3 -mt-8">
          <div className="relative z-10 shrink-0"><Avatar name={s.name} photo={s.photo} size="size-[68px] text-xl ring-4!" /></div>
          <div className="min-w-0 pt-9">
            <div className="font-bold text-navy text-[15.5px] leading-tight truncate" title={s.name}>{s.name}</div>
            <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-navy-soft px-1.5 py-0.5 text-[11px] font-semibold text-navy tabular tracking-wide">{s.code}</div>
          </div>
        </div>

        {/* identity details */}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 mt-4 text-[12.5px]">
          <IdRow label="Mobile" value={fmtPhone(s.phone)} />
          <IdRow label="Admitted" value={fmtDate(s.admissionDate)} />
          <IdRow label="Batch" value={batch?.name ?? 'Not assigned'} sub={batch?.timing} />
          <IdRow label="Course" value={course?.name ?? '—'} />
          {(s.dob || s.gender) && <IdRow label="Born · gender" value={[s.dob && fmtDate(s.dob), s.gender].filter(Boolean).join(' · ')} />}
          {s.city && <IdRow label="City" value={s.city} />}
        </dl>

        {/* fee strip */}
        {fees && f.lines.length > 0 && (
          <div className="mt-4 rounded-xl bg-surface border border-line px-3 py-2.5">
            <div className="flex items-baseline justify-between text-[12px] tabular">
              <span><b className="text-navy">{fmtINR(f.paid)}</b><span className="text-muted"> / {fmtINR(f.total)}</span></span>
              <span className="text-[11px] font-semibold text-accent">{paidPct}%</span>
            </div>
            <Bar value={paidPct} className="mt-1.5 h-1" />
            <div className="mt-2 flex items-center justify-between gap-2 text-[11.5px]">
              {f.outstanding > 0 ? <span className="font-semibold text-warn tabular">{fmtINR(f.outstanding)} pending</span> : <span className="font-medium text-accent">Fully paid</span>}
              {f.next && <span className="flex items-center gap-1.5 text-muted">{fmtDate(f.next.dueDate)} <DueChip date={f.next.dueDate} today={today} /></span>}
            </div>
          </div>
        )}

        {/* footer */}
        <div className="mt-auto pt-3 flex items-center justify-between gap-2">
          {fees ? <Badge>{f.status}</Badge> : <span />}
          <div className="-mr-1"><RowActions s={s} f={f} onPay={onPay} /></div>
        </div>
      </div>
    </div>
  );
}
const IdRow = ({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) => (
  <div className="min-w-0">
    <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</dt>
    <dd className="font-medium text-zinc-800 truncate" title={typeof value === 'string' ? value : undefined}>{value}</dd>
    {sub && <dd className="text-[11px] text-muted truncate">{sub}</dd>}
  </div>
);

/** View · Collect · Remind visible; Edit, Payment history and the rest under More. Every control stops the row click. */
function RowActions({ s, f, onPay }: { s: Student; f: Fin; onPay: (id: string) => void }) {
  const db = S.useDB();
  const nav = useNavigate();
  const { start } = useCall();
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const go = (tab?: string) => nav(`/students/${s.id}${tab ? `?tab=${tab}` : ''}`);
  const fees = S.allowed('fees', 'view', db);
  const canCollect = fees && S.allowed('fees', 'create', db) && f.outstanding > 0 && s.status !== 'Refunded';
  const canRemind = fees && f.outstanding > 0 && !!f.next && s.status !== 'Refunded';
  const btn = 'size-7 grid place-items-center rounded-lg text-zinc-500 hover:text-navy hover:bg-navy-soft transition-colors';
  const slot = <span className="size-7" aria-hidden />; // keeps icons in the same place on every row
  return (
    <div className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <button className={btn} title="View profile" aria-label="View profile" onClick={() => go()}><Ic d={ICON.eye} /></button>
      {canCollect ? <button className="size-7 grid place-items-center rounded-lg text-accent hover:bg-accent-soft transition-colors" title="Collect fees" aria-label="Collect fees" onClick={() => onPay(s.id)}><Ic d={ICON.rupee} /></button> : fees && slot}
      {canRemind && (s.remindersOptOut
        ? <span className={cx(btn, 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-zinc-500')} title="Opted out of reminders"><Ic d={ICON.bell} /></span>
        : <a className={cx(btn, 'hover:text-warn hover:bg-warn-soft')} title="Send WhatsApp reminder" aria-label="Send reminder" href={reminderLink(db, s, f)} target="_blank" rel="noreferrer"><Ic d={ICON.bell} /></a>)}
      {!canRemind && fees && slot}
      <button className={btn} title="More actions" aria-label="More actions" aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ top: r.bottom + 4, right: window.innerWidth - r.right }); }}><Ic d={ICON.more} className="size-4 [stroke-width:3]" /></button>
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div role="menu" className="fixed z-50 w-52 rounded-xl border border-line bg-white shadow-xl py-1.5 text-left" style={{ top: Math.min(menu.top, window.innerHeight - 330), right: menu.right }}>
            {S.allowed('students', 'edit', db) && <MenuItem icon={ICON.edit} onClick={() => go('personal')}>Edit details</MenuItem>}
            {fees && <MenuItem icon={ICON.history} onClick={() => go('payments')}>Payment history</MenuItem>}
            <MenuItem icon={ICON.phone} href={`tel:+91${s.phone}`} onClick={() => { start({ entity: 'student', id: s.id, name: s.name, phone: s.phone }); setMenu(null); }}>Call {fmtPhone(s.phone)}</MenuItem>
            {s.email && <MenuItem icon={ICON.mail} href={`mailto:${s.email}`} onClick={() => setMenu(null)}>Email student</MenuItem>}
            {fees && <MenuItem icon={ICON.wallet} onClick={() => go('fees')}>Fee details</MenuItem>}
            <MenuItem icon={ICON.cal} onClick={() => go('attendance')}>Attendance</MenuItem>
            <MenuItem icon={ICON.layers} onClick={() => go('timeline')}>Activity log</MenuItem>
          </div>
        </>
      )}
    </div>
  );
}
function MenuItem({ icon, children, onClick, href }: { icon: string; children: ReactNode; onClick?: () => void; href?: string }) {
  const cls = 'flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-zinc-700 hover:bg-surface hover:text-ink';
  return href ? <a role="menuitem" href={href} onClick={onClick} className={cls}><Ic d={icon} className="size-4 text-zinc-400" />{children}</a>
    : <button role="menuitem" onClick={onClick} className={cls}><Ic d={icon} className="size-4 text-zinc-400" />{children}</button>;
}

const AV_TONES = ['from-navy to-[#2b5491]', 'from-[#065f46] to-[#10b981]', 'from-[#5b21b6] to-[#8b5cf6]', 'from-[#9a3412] to-[#f97316]', 'from-[#0f766e] to-[#2dd4bf]', 'from-[#1e3a8a] to-[#3b82f6]'];
export const Avatar = ({ name, photo, size = 'size-7' }: { name: string; photo?: string; size?: string }) => {
  if (photo) return <img src={photo} alt="" className={`${size} rounded-full object-cover shrink-0 ring-2 ring-white shadow-sm`} />;
  const initials = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const tone = AV_TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_TONES.length];
  return <div className={cx(size, 'rounded-full bg-gradient-to-br text-white grid place-items-center font-semibold shrink-0', !size.includes('text-') && 'text-[0.8em]', ' ring-2 ring-white shadow-sm', tone)}>{initials}</div>;
};

type Tab = 'overview' | 'personal' | 'fees' | 'payments' | 'invoices' | 'calls' | 'attendance' | 'certificates' | 'documents' | 'timeline';

export function StudentProfile() {
  const { id } = useParams();
  const db = S.useDB();
  const run = useRun();
  const { ask } = useUI();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'overview';
  const [payOpen, setPayOpen] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const s = db.students.find((x) => x.id === id);
  if (!s) return <Card><Empty title="Student not found" action={<Link to="/students" className="text-accent">Back to students</Link>} /></Card>;
  const fees = S.allowed('fees', 'view', db);
  const f = financeFor(db, s.id, todayIST());
  const course = db.courses.find((c) => c.id === s.courseId);
  const batch = db.batches.find((b) => b.id === s.batchId);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' }, { id: 'personal', label: 'Personal info' },
    ...(fees ? [{ id: 'fees' as Tab, label: 'Fee details' }, { id: 'payments' as Tab, label: 'Payment history' }, { id: 'invoices' as Tab, label: 'Invoices', count: db.payments.filter((p) => p.studentId === s.id && p.kind === 'payment').length }] : []),
    { id: 'calls', label: 'Call history' }, { id: 'attendance', label: 'Attendance' },
    ...(S.allowed('certificates', 'view', db) ? [{ id: 'certificates' as Tab, label: 'Certificates' }] : []),
    ...(S.allowed('sensitive', 'view', db) ? [{ id: 'documents' as Tab, label: 'Documents' }] : []),
    { id: 'timeline', label: 'Activity' },
  ];
  const changeStatus = async (st: StudentStatus) => {
    const reason = await ask({ title: `Mark ${s.name} as ${st}?`, message: st === 'Dropped' || st === 'Refunded' ? 'Unpaid instalments will be cancelled.' : undefined, input: 'Reason', confirm: `Mark ${st}`, danger: st === 'Dropped' });
    if (reason) run(() => S.setStudentStatus(s.id, st, reason), `Status changed to ${st}`);
  };

  const today = todayIST();
  const canEdit = S.allowed('students', 'edit', db);
  const canCollect = fees && S.allowed('fees', 'create', db) && f.outstanding > 0 && s.status !== 'Refunded';
  const recent = db.payments.filter((p) => p.studentId === s.id && p.kind === 'payment').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  const overdueAmt = f.lines.filter((l) => l.status === 'Overdue').reduce((t, l) => t + l.remaining, 0);
  const missing = [!s.email && 'email', !s.altPhone && 'alternate mobile', !s.dob && 'date of birth', !(s.address || s.city) && 'address'].filter(Boolean) as string[];
  const goTab = (t: Tab) => { sp.set('tab', t); setSp(sp, { replace: true }); };

  return (
    <>
      <Link to="/students" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-navy mb-3">← All students</Link>
      {/* profile header: identity first, actions grouped on the right, fee figures in one band underneath */}
      <Card className="overflow-hidden mb-4 rounded-2xl shadow-[0_2px_10px_-4px_rgba(15,35,65,.15)]">
        <div className="h-1.5 bg-gradient-to-r from-navy via-[#173563] to-accent" />
        <div className="p-4 sm:p-6 flex flex-col xl:flex-row xl:items-start gap-5">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <div className="relative shrink-0">
              <Avatar name={s.name} photo={s.photo} size="size-16 sm:size-20 text-xl" />
              {canEdit && (
                <label className="absolute -bottom-0.5 -right-0.5 size-7 rounded-full bg-white border border-line shadow grid place-items-center cursor-pointer text-zinc-600 hover:text-navy" title={s.photo ? 'Change photo' : 'Add photo'}>
                  <Ic d={ICON.camera} className="size-3.5" />
                  <input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const photo = await resizeImage(file); run(() => S.updateStudent(s.id, { photo }), 'Photo updated'); e.target.value = ''; }} />
                </label>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap"><h1 className="text-[22px] sm:text-[24px] font-bold tracking-tight text-navy leading-tight">{s.name}</h1><Badge>{s.status}</Badge>{fees && <Badge>{f.status}</Badge>}</div>
              <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-x-6 gap-y-2.5">
                <Fact icon={ICON.id} label="Student ID" value={s.code} />
                <Fact icon={ICON.phone} label="Mobile" value={fmtPhone(s.phone)} />
                <Fact icon={ICON.cal} label="Enrolled" value={fmtDate(s.admissionDate)} />
                <Fact icon={ICON.book} label="Course" value={course?.name ?? '—'} />
                <Fact icon={ICON.layers} label="Batch" value={batch ? `${batch.name} · ${batch.timing}` : 'Not assigned'} />
                {s.email && <Fact icon={ICON.mail} label="Email" value={s.email} />}
              </dl>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:pl-24 xl:pl-0 xl:w-56 xl:shrink-0 xl:flex-col xl:items-stretch">
            {canCollect && <Button variant="primary" className="h-9 xl:h-10 xl:w-full" onClick={() => setPayOpen(true)}><Ic d={ICON.rupee} /> Collect fees</Button>}
            <div className="flex flex-wrap gap-2 xl:grid xl:grid-cols-2 [&>*]:justify-center">
              <div className="contents xl:block [&>a]:xl:w-full [&>a]:justify-center"><CallButton size="md" target={{ entity: 'student', id: s.id, name: s.name, phone: s.phone }} /></div>
              {fees && f.outstanding > 0 && f.next && s.status !== 'Refunded' && (s.remindersOptOut
                ? <Button disabled title="Student opted out of reminders"><Ic d={ICON.bell} /> Remind</Button>
                : <a href={reminderLink(db, s, f)} target="_blank" rel="noreferrer" title="Send WhatsApp reminder" className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg border border-line bg-white font-medium hover:bg-warn-soft hover:text-warn hover:border-warn/30"><Ic d={ICON.bell} /> Remind</a>)}
            </div>
            {S.allowed('batches', 'edit', db) && <Button className="xl:w-full" onClick={() => setTransfer(true)}>Transfer batch</Button>}
            {canEdit && <Select value="" onChange={(e) => e.target.value && changeStatus(e.target.value as StudentStatus)} placeholder="Change status…" options={STUDENT_STATUSES.filter((x) => x !== s.status)} className="w-44 xl:w-full" />}
          </div>
        </div>
        {fees && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border-t border-line">
            <Band label="Total fee" value={fmtINR(f.total)} foot={`${f.lines.filter((l) => l.state === 'active').length} instalments`} />
            <Band label="Paid" value={<span className="text-accent">{fmtINR(f.paid)}</span>}
              foot={<span className="flex items-center gap-2"><Bar value={pct(f.paid, f.total)} className="flex-1 max-w-28" /><b className="text-accent tabular">{pct(f.paid, f.total)}%</b></span>} />
            <Band label="Pending balance" value={<span className={f.outstanding ? (overdueAmt ? 'text-bad' : 'text-warn') : 'text-accent'}>{fmtINR(f.outstanding)}</span>}
              foot={overdueAmt ? <span className="text-bad font-medium">{fmtINR(overdueAmt)} overdue</span> : f.refunded > 0 ? `Refunded ${fmtINR(f.refunded)}` : f.outstanding ? 'Nothing overdue' : 'Fully paid'} />
            <Band label="Next due" value={f.next ? fmtINR(f.next.remaining) : '—'}
              foot={f.next ? <span className="flex flex-wrap items-center gap-1.5"><span className="whitespace-nowrap">{fmtDate(f.next.dueDate)}</span><DueChip date={f.next.dueDate} today={today} /></span> : 'Nothing due'} />
          </div>
        )}
      </Card>

      <Tabs tabs={tabs} value={tab} onChange={goTab} />

      {tab === 'overview' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {fees && (
              <Card className="rounded-2xl">
                <CardHeader title="Fee schedule" sub={`${f.lines.filter((l) => l.status === 'Paid').length} of ${f.lines.filter((l) => l.state === 'active').length} instalments paid`} right={<button onClick={() => goTab('fees')} className="text-[12.5px] font-medium text-navy hover:underline">Manage →</button>} />
                {!f.lines.length ? <Empty title="No fee plan" /> : (
                  <ol className="px-4 pb-4 pt-1">
                    {f.lines.map((l, i) => {
                      const dot = l.status === 'Paid' ? 'bg-accent' : l.status === 'Overdue' ? 'bg-bad' : l.status === 'Due Soon' || l.status === 'Partially Paid' ? 'bg-warn' : 'bg-zinc-300';
                      return (
                        <li key={l.id} className="relative flex gap-3 pb-4 last:pb-0">
                          {i < f.lines.length - 1 && <span className="absolute left-[7px] top-5 bottom-0 w-px bg-line" />}
                          <span className={cx('mt-1 size-[15px] rounded-full ring-4 ring-white shrink-0 grid place-items-center', dot)}>{l.status === 'Paid' && <Ic d={ICON.check} className="size-2.5 text-white [stroke-width:3]" />}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                              <div><span className="font-semibold">{l.label}</span><span className="text-muted text-[12px] ml-2">due {fmtDate(l.dueDate)}</span></div>
                              <div className="flex items-center gap-2"><Money v={l.amount} className="font-semibold" /><Badge>{l.status}</Badge></div>
                            </div>
                            {l.state === 'active' && l.amount > 0 && <div className="mt-1.5 flex items-center gap-2"><Bar value={pct(l.paid, l.amount)} tone={l.status === 'Overdue' ? 'bg-bad' : 'bg-accent'} className="flex-1 max-w-56" /><span className="text-[11.5px] text-muted tabular">{fmtINR(l.paid)} paid{l.remaining > 0 && ` · ${fmtINR(l.remaining)} left`}</span></div>}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Card>
            )}
            {fees && (
              <Card className="rounded-2xl">
                <CardHeader title="Recent payments" right={<button onClick={() => goTab('payments')} className="text-[12.5px] font-medium text-navy hover:underline">Full history →</button>} />
                {!recent.length ? <Empty title="No payments yet" /> : (
                  <div className="divide-y divide-line">
                    {recent.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="size-9 rounded-xl bg-accent-soft text-accent grid place-items-center"><Ic d={ICON.rupee} /></span>
                        <div className="flex-1 min-w-0 leading-tight"><div className="font-medium">{p.method}{p.reference && <span className="text-muted font-normal"> · {p.reference}</span>}</div><div className="text-[11.5px] text-muted mt-0.5">{fmtDate(p.date)} · {S.empName(p.receivedBy, db)}</div></div>
                        <div className="text-right"><Money v={p.amount} className="font-semibold text-accent" /><div className="mt-0.5 flex items-center justify-end gap-2"><Link to={`/receipt/${p.id}`} target="_blank" className="text-[12px] font-medium text-navy hover:underline">Invoice</Link>{p.verified ? <Badge tone="green">Received</Badge> : <Badge tone="orange">Not confirmed</Badge>}</div></div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </div>
          <div className="space-y-4">
            <Card className="rounded-2xl p-4">
              <h3 className="font-semibold text-[14px] mb-3">Contact & personal</h3>
              <div className="space-y-2.5">
                <Row k="Mobile" v={fmtPhone(s.phone)} />
                {s.altPhone && <Row k="Alternate" v={fmtPhone(s.altPhone)} />}
                {s.email && <Row k="Email" v={<span className="break-all">{s.email}</span>} />}
                {(s.dob || s.gender) && <Row k="Born · gender" v={[s.dob && fmtDate(s.dob), s.gender].filter(Boolean).join(' · ')} />}
                {(s.address || s.city) && <Row k="Address" v={[s.address, s.city, s.state, s.pin].filter(Boolean).join(', ')} />}
                <Row k="Source" v={`${s.source}${s.campaign ? ` · ${s.campaign}` : ''}`} />
                <Row k="Counsellor" v={S.empName(s.counsellorId, db)} />
                {s.leadId && <Row k="Converted from" v={<Link className="text-accent" to={`/leads?lead=${s.leadId}`}>{s.leadId}</Link>} />}
              </div>
              {missing.length > 0 && <p className="mt-3 pt-3 border-t border-line text-[12px] text-muted">Not added yet: {missing.join(', ')}{canEdit && <> · <button onClick={() => goTab('personal')} className="font-medium text-navy hover:underline">Add →</button></>}</p>}
              {canEdit && !missing.length && <button onClick={() => goTab('personal')} className="mt-3 text-[12.5px] font-medium text-navy hover:underline">Edit details →</button>}
            </Card>
            <Card className="rounded-2xl p-4">
              <h3 className="font-semibold text-[14px] mb-3">Course & batch</h3>
              <div className="space-y-2.5">
                <Row k="Course" v={course?.name ?? '—'} />
                {course && <Row k="Duration" v={`${course.durationWeeks} weeks`} />}
                <Row k="Batch" v={batch ? <span className="inline-flex items-center gap-1.5">{batch.name}<Badge>{batch.status}</Badge></span> : '—'} />
                {batch && <><Row k="Schedule" v={`${batch.schedule} · ${batch.timing}`} /><Row k="Dates" v={`${fmtDate(batch.startDate)} – ${fmtDate(batch.endDate)}`} /><Row k="Teacher" v={S.empName(batch.teacherId, db)} /></>}
              </div>
            </Card>
          </div>
        </div>
      )}
      {tab === 'personal' && <Personal id={s.id} />}
      {tab === 'fees' && <FeeDetails id={s.id} />}
      {tab === 'payments' && <PaymentHistory id={s.id} />}
      {tab === 'invoices' && (
        <Card className="overflow-hidden">
          <CardHeader title="Invoices" sub={`One invoice per payment · send any of them to ${fmtPhone(s.phone)} on WhatsApp`} />
          <InvoiceTable rows={db.payments.filter((p) => p.studentId === s.id && p.kind === 'payment').sort((a, b) => b.createdAt.localeCompare(a.createdAt))} empty="No invoices yet — one is created with every fee payment" />
        </Card>
      )}
      {tab === 'calls' && <CallHistory id={s.id} />}
      {tab === 'attendance' && <AttendanceTab id={s.id} />}
      {tab === 'certificates' && <Card>
        <Table rows={db.certificates.filter((c) => c.studentId === s.id)} rowKey={(c) => c.id} empty={<Empty title="No certificates" body={s.status === 'Completed' ? 'Issue one from Certificates.' : 'Available once the student is marked Completed.'} action={s.status === 'Completed' && <Link className="text-accent" to={`/certificates?student=${s.id}`}>Go to certificates →</Link>} />}
          cols={[{ key: 'id', label: 'Certificate ID', render: (c) => c.id }, { key: 'd', label: 'Issued', render: (c) => fmtDateTime(c.issuedAt) }, { key: 's', label: 'Status', render: (c) => <Badge>{c.status}</Badge> }, { key: 'b', label: 'By', render: (c) => S.empName(c.issuedBy, db) }]} />
      </Card>}
      {tab === 'documents' && <Documents id={s.id} />}
      {tab === 'timeline' && <Timeline id={s.id} />}

      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} studentId={s.id} />
      <TransferModal open={transfer} onClose={() => setTransfer(false)} id={s.id} />
    </>
  );
}
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex justify-between gap-3"><span className="text-muted shrink-0">{k}</span><span className="text-right font-medium text-zinc-800 min-w-0">{v}</span></div>;
const Fact = ({ icon, label, value }: { icon: string; label: string; value: ReactNode }) => (
  <div className="flex items-start gap-2.5 min-w-0">
    <span className="mt-0.5 size-7 rounded-lg bg-navy-soft text-navy grid place-items-center shrink-0"><Ic d={icon} className="size-3.5" /></span>
    <div className="min-w-0 leading-tight"><dt className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">{label}</dt><dd className="text-[13px] font-medium text-zinc-800 truncate" title={typeof value === 'string' ? value : undefined}>{value}</dd></div>
  </div>
);
function Band({ label, value, foot }: { label: string; value: ReactNode; foot?: ReactNode }) {
  return (
    <div className="bg-surface px-4 sm:px-5 py-3.5 min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-[20px] font-bold tabular text-navy leading-tight truncate">{value}</div>
      {foot && <div className="mt-1 text-[11.5px] text-muted">{foot}</div>}
    </div>
  );
}

function Personal({ id }: { id: string }) {
  const db = S.useDB();
  const run = useRun();
  const s = db.students.find((x) => x.id === id)!;
  const [f, setF] = useState(s);
  useEffect(() => setF(s), [s]);
  const can = S.allowed('students', 'edit', db);
  const set = (k: keyof typeof s) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const dirty = (['name', 'phone', 'altPhone', 'email', 'address', 'city', 'state', 'pin', 'dob', 'gender'] as const).some((k) => (f[k] ?? '') !== (s[k] ?? ''));
  return (
    <div className="space-y-4 max-w-3xl">
    <Card className="p-5">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Full name"><Input value={f.name} onChange={set('name')} disabled={!can} /></Field>
        <Field label="Mobile"><Input value={f.phone} onChange={set('phone')} disabled={!can} /></Field>
        <Field label="Date of birth"><Input type="date" value={f.dob ?? ''} onChange={set('dob')} disabled={!can} /></Field>
        <Field label="Gender"><Select value={f.gender ?? ''} onChange={set('gender')} placeholder="Not set" options={GENDERS} disabled={!can} /></Field>
        <Field label="Alternate mobile"><Input value={f.altPhone} onChange={set('altPhone')} disabled={!can} /></Field>
        <Field label="Email"><Input value={f.email} onChange={set('email')} disabled={!can} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={set('address')} disabled={!can} /></Field>
        <Field label="City"><Input value={f.city} onChange={set('city')} disabled={!can} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="State"><Input value={f.state} onChange={set('state')} disabled={!can} /></Field><Field label="PIN"><Input value={f.pin} onChange={set('pin')} disabled={!can} /></Field></div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
        <Checkbox checked={s.remindersOptOut} disabled={!can} onChange={(e) => run(() => S.setReminderOptOut(id, e.target.checked), 'Preference saved')} label="Opted out of WhatsApp / SMS payment reminders" />
        {can && <Button variant="primary" disabled={!dirty} onClick={() => run(() => S.updateStudent(id, { name: f.name, phone: f.phone, altPhone: f.altPhone, email: f.email, address: f.address, city: f.city, state: f.state, pin: f.pin, dob: f.dob || undefined, gender: f.gender || undefined }), 'Saved')}>Save changes</Button>}
      </div>
    </Card>
    {cloudEnabled && <StudentLogin id={id} />}
    </div>
  );
}

/** Student portal login: login ID = student ID; staff set or reset the password. */
function StudentLogin({ id }: { id: string }) {
  const db = S.useDB();
  const { toast } = useUI();
  const s = db.students.find((x) => x.id === id)!;
  const [has, setHas] = useState<boolean | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const can = S.allowed('students', 'edit', db);
  useEffect(() => { studentLoginExists(id).then(setHas).catch(() => setHas(null)); }, [id]);
  const save = async () => {
    setBusy(true);
    try { await setStudentLogin(id, pw); setHas(true); setPw(''); toast(has ? 'Password reset' : `Login created — Login ID ${s.code}`, 'ok'); }
    catch (e) { toast((e as Error).message, 'bad'); }
    setBusy(false);
  };
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Student login</h3>
          <p className="text-[13px] text-muted mt-0.5">The student signs in on the same login page to see their fees and payments.</p>
        </div>
        {has !== null && <Badge tone={has ? 'green' : 'gray'}>{has ? 'Login active' : 'No login yet'}</Badge>}
      </div>
      <dl className="mt-4 grid sm:grid-cols-2 gap-3">
        <div><dt className="text-xs text-muted">Login ID</dt><dd className="font-semibold tabular text-[15px]">{s.code}</dd></div>
      </dl>
      {can && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Field label={has ? 'New password' : 'Password'} className="w-full sm:w-64" error={pw && pw.length < 8 ? 'At least 8 characters' : undefined}>
            <Input type="text" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Button variant="primary" loading={busy} disabled={pw.length < 8} onClick={save}>{has ? 'Reset password' : 'Create login'}</Button>
        </div>
      )}
    </Card>
  );
}

function FeeDetails({ id }: { id: string }) {
  const db = S.useDB();
  const run = useRun();
  const { ask } = useUI();
  const f = financeFor(db, id, todayIST());
  const [edit, setEdit] = useState<string | null>(null);
  const [refund, setRefund] = useState(false);
  const plan = db.feePlans.find((p) => p.studentId === id);
  const canEdit = S.allowed('fees', 'edit', db);
  const s = db.students.find((x) => x.id === id)!;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Instalment schedule" sub={plan && `Booking amount ${plan.policy === 'additional' ? 'paid on top of the course fee' : 'counted inside the course fee'} · first instalment counted from ${fmtDate(plan.startDate)}`}
          right={S.allowed('fees', 'approve', db) && f.paid - f.refunded > 0 && s.status !== 'Refunded' && <Button size="sm" variant="danger" onClick={() => setRefund(true)}>Record refund</Button>} />
        <Table rows={f.lines} rowKey={(l) => l.id} empty={<Empty title="No fee plan" />} cols={[
          { key: 'l', label: 'Instalment', render: (l) => <span className="font-medium">{l.label}</span> },
          { key: 'd', label: 'Due date', render: (l) => fmtDate(l.dueDate) },
          { key: 'a', label: 'Amount', render: (l) => <Money v={l.amount} />, className: 'text-right' },
          { key: 'p', label: 'Paid', render: (l) => <Money v={l.paid} className="text-ok" />, className: 'text-right' },
          { key: 'r', label: 'Remaining', render: (l) => <Money v={l.remaining} />, className: 'text-right' },
          { key: 's', label: 'Status', render: (l) => <Badge>{l.status}</Badge> },
          { key: 'x', label: '', render: (l) => canEdit && l.state === 'active' && l.remaining > 0 && <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEdit(l.id)}>Override</Button>
            <Button size="sm" variant="ghost" onClick={async () => { const r = await ask({ title: `Waive ${l.label}?`, message: `${fmtINR(l.remaining)} will no longer be owed.`, input: 'Reason', confirm: 'Waive', danger: true }); if (r) run(() => S.overrideInstalment(l.id, l.paid > 0 ? { amount: l.paid } : { state: 'waived' }, `Waived balance: ${r}`), 'Instalment waived'); }}>Waive</Button></div> },
        ]} />
        <div className="flex justify-end gap-6 px-4 py-3 border-t border-line text-[13px]"><span>Total <Money v={f.total} className="font-semibold" /></span><span>Paid <Money v={f.paid} className="font-semibold text-ok" /></span>{f.refunded > 0 && <span>Refunded <Money v={f.refunded} className="font-semibold text-bad" /></span>}<span>Balance due <Money v={f.outstanding} className="font-semibold" /></span></div>
      </Card>
      <OverrideModal id={edit} onClose={() => setEdit(null)} />
      <RefundModal open={refund} onClose={() => setRefund(false)} studentId={id} max={f.paid - f.refunded} />
    </div>
  );
}

function OverrideModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const db = S.useDB();
  const run = useRun();
  const i = db.instalments.find((x) => x.id === id);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { if (i) { setAmount(String(i.amount / 100)); setDate(i.dueDate); setReason(''); } }, [id]);
  const p = parseRupees(amount);
  return (
    <Modal open={!!i} onClose={onClose} title={`Override ${i?.label}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={p === null || !reason.trim()} onClick={() => { let ok = false; run(() => { S.overrideInstalment(id!, { amount: p!, dueDate: date }, reason); ok = true; }, 'Instalment updated'); if (ok) onClose(); }}>Save override</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₹)"><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Due date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Reason (saved to audit trail)" required className="col-span-2"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function RefundModal({ open, onClose, studentId, max }: { open: boolean; onClose: () => void; studentId: string; max: number }) {
  const run = useRun();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('Bank Transfer');
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const p = parseRupees(amount);
  return (
    <Modal open={open} onClose={onClose} title="Record refund" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" disabled={p === null || !reason.trim()} onClick={() => { let ok = false; run(() => { S.recordRefund(studentId, p!, method, ref, reason); ok = true; }, 'Refund recorded — mark the student Refunded if fully settled'); if (ok) onClose(); }}>Record refund</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₹)" hint={`Up to ${fmtINR(max)}`}><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)} options={PAY_METHODS} /></Field>
        <Field label="Reference" className="col-span-2"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        <Field label="Reason" required className="col-span-2"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function PaymentHistory({ id }: { id: string }) {
  const db = S.useDB();
  const run = useRun();
  const { ask } = useUI();
  const pays = db.payments.filter((p) => p.studentId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const reversed = new Set(pays.filter((p) => p.kind === 'reversal').map((p) => p.reversesId));
  const approve = S.allowed('fees', 'approve', db);
  return (
    <Card>
      <Table rows={pays} rowKey={(p) => p.id} empty={<Empty title="No payments yet" />} cols={[
        { key: 'id', label: 'Transaction', render: (p) => <span className="text-muted">{p.id}</span> },
        { key: 'd', label: 'Date', render: (p) => fmtDate(p.date) },
        { key: 'k', label: 'Type', render: (p) => (p.kind === 'payment' ? (reversed.has(p.id) ? <Badge tone="gray">Cancelled</Badge> : p.verified ? <Badge tone="green">Received</Badge> : <Badge tone="orange">Not confirmed</Badge>) : <Badge tone="red">{p.kind === 'reversal' ? `Reversal of ${p.reversesId}` : 'Refund'}</Badge>) },
        { key: 'a', label: 'Amount', render: (p) => <Money v={p.kind === 'payment' ? p.amount : -p.amount} className={reversed.has(p.id) ? 'line-through text-muted' : ''} />, className: 'text-right' },
        { key: 'm', label: 'Method', render: (p) => p.method },
        { key: 'r', label: 'Reference', render: (p) => p.reference || '—' },
        { key: 'b', label: 'Received by', render: (p) => S.empName(p.receivedBy, db) },
        { key: 'n', label: 'Notes', render: (p) => <span className="text-muted">{p.notes}</span> },
        { key: 'x', label: '', render: (p) => p.kind === 'payment' && (
          <div className="flex gap-1">
            {!reversed.has(p.id) && <Link to={`/receipt/${p.id}`} target="_blank" className="text-accent text-[12.5px] font-medium px-2">Invoice</Link>}
            {approve && !p.verified && !reversed.has(p.id) && <Button size="sm" onClick={() => run(() => S.verifyPayment(p.id), 'Payment confirmed')}>Confirm</Button>}
            {approve && !reversed.has(p.id) && <Button size="sm" variant="ghost" onClick={async () => { const r = await ask({ title: `Cancel payment ${p.id}?`, message: 'Use this if the money did not arrive or was entered by mistake. The payment stays in the records, marked as cancelled, and the balance due goes back up.', input: 'Reason', confirm: 'Cancel payment', danger: true }); if (r) run(() => S.reversePayment(p.id, r), 'Payment cancelled'); }}>Cancel payment</Button>}
          </div>
        ) },
      ]} />
    </Card>
  );
}

function CallHistory({ id }: { id: string }) {
  const db = S.useDB();
  const s = db.students.find((x) => x.id === id)!;
  const calls = db.calls.filter((c) => (c.entity === 'student' && c.entityId === id) || (s.leadId && c.entity === 'lead' && c.entityId === s.leadId));
  return (
    <Card>
      <Table rows={calls} rowKey={(c) => c.id} empty={<Empty title="No calls logged" />} cols={[
        { key: 'a', label: 'When', render: (c) => fmtDateTime(c.at) }, { key: 'w', label: 'Stage', render: (c) => (c.entity === 'lead' ? 'As lead' : 'Fee follow-up') },
        { key: 'o', label: 'Outcome', render: (c) => <Badge>{c.outcome}</Badge> }, { key: 'b', label: 'By', render: (c) => S.empName(c.by, db) },
        { key: 'n', label: 'Notes', render: (c) => <span className="whitespace-normal">{c.notes}</span> }, { key: 'f', label: 'Follow-up', render: (c) => fmtDate(c.nextFollowUp) },
      ]} />
    </Card>
  );
}

function AttendanceTab({ id }: { id: string }) {
  const db = S.useDB();
  const { enrols, sessions, present } = attendanceFor(db, id);
  return (
    <div className="space-y-4">
      <Card className="p-4 grid grid-cols-3 gap-4"><Stat label="Sessions" value={sessions.length} /><Stat label="Present" value={present} tone="ok" /><Stat label="Attendance" value={sessions.length ? `${((present / sessions.length) * 100).toFixed(0)}%` : '—'} /></Card>
      <Card>
        <CardHeader title="Batch history" />
        <Table rows={enrols} rowKey={(e) => e.id} cols={[{ key: 'b', label: 'Batch', render: (e) => db.batches.find((b) => b.id === e.batchId)?.name }, { key: 'f', label: 'From', render: (e) => fmtDate(e.from) }, { key: 't', label: 'To', render: (e) => (e.to ? fmtDate(e.to) : 'Current') }, { key: 'r', label: 'Reason', render: (e) => e.reason }]} />
      </Card>
      <Card>
        <Table rows={sessions} rowKey={(a) => a.id} empty={<Empty title="No sessions marked yet" body="Teachers mark attendance from the Batches page." />} cols={[
          { key: 'd', label: 'Date', render: (a) => fmtDate(a.date) }, { key: 'b', label: 'Batch', render: (a) => db.batches.find((b) => b.id === a.batchId)?.name },
          { key: 'p', label: '', render: (a) => (a.present.includes(id) ? <Badge tone="green">Present</Badge> : <Badge tone="red">Absent</Badge>) },
        ]} />
      </Card>
    </div>
  );
}

function Documents({ id }: { id: string }) {
  const db = S.useDB();
  const run = useRun();
  const { ask, toast } = useUI();
  const s = db.students.find((x) => x.id === id)!;
  const doc = s.idDoc;
  const [shown, setShown] = useState(false);
  const [urls, setUrls] = useState<{ front?: string; back?: string }>({});
  const [files, setFiles] = useState<{ front?: File; back?: File }>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const logs = db.audit.filter((a) => a.entityId === id && a.action.startsWith('iddoc'));
  const canAdd = S.allowed('sensitive', 'edit', db);

  const reveal = async () => {
    let ok = false;
    run(() => { S.logSensitiveView(id); ok = true; });
    if (!ok) return;
    setShown(true);
    try {
      const out: { front?: string; back?: string } = {};
      for (const side of ['front', 'back'] as const) { const ref = doc?.files?.[side]; if (ref) out[side] = await aadhaarUrl(ref); }
      setUrls(out);
    } catch (e) { toast(`Could not open the card: ${(e as Error).message}`, 'bad'); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const saved = await storeAadhaar(id, files);
      run(() => S.updateStudent(id, { idDoc: { type: 'Aadhaar', maskedNumber: '', nameOnDoc: s.name, consentAt: new Date().toISOString(), capturedBy: S.currentUser()?.id ?? 'system', imageRetained: true, files: saved } }), 'Aadhaar card saved');
      setFiles({}); setConsent(false);
    } catch (e) { toast((e as Error).message, 'bad'); }
    setBusy(false);
  };
  const remove = async () => {
    const r = await ask({ title: 'Delete Aadhaar card?', message: 'The card images and details will be removed from this student.', input: 'Reason', confirm: 'Delete', danger: true });
    if (!r) return;
    let ok = false;
    run(() => { S.deleteIdDocument(id, r); ok = true; }, 'Aadhaar card deleted');
    if (ok) { void removeAadhaar([doc?.files?.front, doc?.files?.back]); setShown(false); setUrls({}); }
  };
  const pic = (side: 'front' | 'back') => {
    const ref = doc?.files?.[side], url = urls[side];
    if (!ref) return <div className="aspect-[1.6] rounded-xl border border-dashed border-line grid place-items-center text-[12.5px] text-muted">No {side} side</div>;
    if (!url) return <div className="aspect-[1.6] rounded-xl bg-surface border border-line grid place-items-center text-[12.5px] text-muted">Loading…</div>;
    const pdf = ref.endsWith('.pdf') || url.startsWith('data:application/pdf');
    return pdf
      ? <a href={url} target="_blank" rel="noreferrer" className="aspect-[1.6] rounded-xl bg-surface border border-line grid place-items-center font-medium text-navy hover:underline">Open PDF ({side})</a>
      : <a href={url} target="_blank" rel="noreferrer" title="Open full size"><img src={url} alt={`Aadhaar ${side}`} className="w-full aspect-[1.6] object-cover rounded-xl border border-line" /></a>;
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div><h3 className="font-semibold">Aadhaar card</h3><p className="text-muted text-xs mt-0.5">Restricted · every view is logged</p></div>
          {doc && <div className="flex gap-2">
            {!shown && <Button onClick={reveal}>Show card</Button>}
            {S.allowed('sensitive', 'delete', db) && <Button variant="danger" onClick={remove}>Delete</Button>}
          </div>}
        </div>
        {doc ? (
          <>
            <dl className="grid sm:grid-cols-3 gap-3 text-[13px]">
              <div><dt className="text-muted text-xs">Aadhaar no.</dt><dd className="font-medium tabular">{doc.maskedNumber || '—'}</dd></div>
              <div><dt className="text-muted text-xs">Consent given</dt><dd className="font-medium">{fmtDate(doc.consentAt.slice(0, 10))}</dd></div>
              <div><dt className="text-muted text-xs">Saved by</dt><dd className="font-medium">{S.empName(doc.capturedBy, db)}</dd></div>
            </dl>
            {doc.type !== 'Aadhaar' && <p className="mt-3 text-xs text-muted">Older record: {doc.type}.</p>}
            {shown && (doc.files?.front || doc.files?.back
              ? <div className="grid sm:grid-cols-2 gap-3 mt-4">{pic('front')}{pic('back')}</div>
              : <p className="mt-4 text-[13px] text-muted">No card images were saved for this student.</p>)}
          </>
        ) : canAdd ? (
          <div className="space-y-3">
            <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} label="Student has given consent to save their Aadhaar card" />
            <div className={cx('grid sm:grid-cols-2 gap-3', !consent && 'opacity-50')}>
              {(['front', 'back'] as const).map((side) => (
                <UploadBox key={side} side={side} file={files[side]} disabled={!consent || busy} onPassword={() => undefined}
                  onFile={(f) => setFiles((x) => { const n = { ...x }; if (f) n[side] = f; else delete n[side]; return n; })} />
              ))}
            </div>
            <Button variant="primary" loading={busy} disabled={!consent || !(files.front || files.back)} onClick={save}>Save Aadhaar card</Button>
          </div>
        ) : <p className="text-muted">No Aadhaar card on file.</p>}
      </Card>
      <Card>
        <CardHeader title="Access log" />
        <Table rows={logs} rowKey={(a) => a.id} empty={<Empty title="No access yet" />} cols={[{ key: 'a', label: 'When', render: (a) => fmtDateTime(a.at) }, { key: 'b', label: 'Who', render: (a) => S.empName(a.by, db) }, { key: 'c', label: 'Action', render: (a) => a.action.replace('iddoc.', '') }, { key: 'd', label: 'Detail', render: (a) => a.detail }]} />
      </Card>
    </div>
  );
}

function Timeline({ id }: { id: string }) {
  const db = S.useDB();
  const s = db.students.find((x) => x.id === id)!;
  const items = db.audit.filter((a) => a.entityId === id || (s.leadId && a.entityId === s.leadId)).filter((a) => S.allowed('fees') || !a.action.startsWith('payment'));
  return (
    <Card className="p-5">
      {!items.length ? <Empty title="No activity" /> : (
        <ol className="relative border-l border-line ml-2 space-y-4">
          {items.map((a) => (
            <li key={a.id} className="ml-4">
              <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-white border-2 border-accent" />
              <div className="text-xs text-muted">{fmtDateTime(a.at)} · {S.empName(a.by, db)}</div>
              <div><span className="font-medium">{a.action.replace('.', ' · ')}</span>{a.detail && <span className="text-zinc-600"> — {a.detail}</span>}</div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function TransferModal({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) {
  const db = S.useDB();
  const run = useRun();
  const s = db.students.find((x) => x.id === id)!;
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const options = db.batches.filter((b) => b.id !== s.batchId && b.status !== 'completed' && b.status !== 'cancelled');
  return (
    <Modal open={open} onClose={onClose} title="Transfer to another batch" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!to || !reason.trim()} onClick={() => { let ok = false; run(() => { S.transferStudent(id, to, reason); ok = true; }, 'Student transferred'); if (ok) onClose(); }}>Transfer</Button></>}>
      <div className="space-y-3">
        <Field label="New batch"><Select value={to} onChange={(e) => setTo(e.target.value)} placeholder="Select batch" options={options.map((b) => ({ value: b.id, label: `${b.name} · ${b.timing}` }))} /></Field>
        <Field label="Reason" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

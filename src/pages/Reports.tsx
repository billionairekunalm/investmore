import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as S from '../store/store';
import { Button, Card, CardHeader, Empty, PageHeader, Table, Tabs, cx } from '../ui/kit';
import { useRange } from '../ui/shell';
import { effectivePayments } from '../domain/fees';
import { expenseAmount, financeFor, periodFigures } from '../domain/finance';
import type { DB, Module } from '../domain/types';
import { addDays, daysBetween, fmtDate, fmtMonth, inRange, monthRange, monthsBetween, RANGE_LABELS, todayIST } from '../domain/util';
import { downloadCSV, downloadXLSX, printTable } from '../lib/export';
import { VisualAnalytics } from './Analytics';

type Row = Record<string, string | number>;
const r = (p: number) => +(p / 100).toFixed(2); // rupees for export
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');

const REPORTS: { id: string; label: string; group: string; mod: Module; build: (db: DB, rg: [string, string], t: string) => Row[] }[] = [
  { id: 'admissions', label: 'Student admissions', group: 'Students', mod: 'students', build: (db, rg) => db.students.filter((s) => inRange(s.admissionDate, rg)).map((s) => ({ 'Student ID': s.code, Name: s.name, Course: course(db, s.courseId), Batch: batch(db, s.batchId), Admitted: s.admissionDate, Source: s.source, Campaign: s.campaign, Counsellor: S.empName(s.counsellorId, db), Status: s.status })) },
  { id: 'active', label: 'Active students', group: 'Students', mod: 'students', build: (db) => db.students.filter((s) => s.status === 'Active').map((s) => ({ 'Student ID': s.code, Name: s.name, Batch: batch(db, s.batchId), Admitted: s.admissionDate })) },
  { id: 'growth', label: 'Student growth', group: 'Students', mod: 'students', build: (db, rg) => months(db, rg).map((m) => { const [, b] = monthRange(m); return { Month: fmtMonth(m), Admissions: db.students.filter((s) => s.admissionDate.startsWith(m)).length, 'Enrolled to date': db.students.filter((s) => s.admissionDate <= b && !['Dropped', 'Refunded'].includes(s.status)).length, Completed: db.students.filter((s) => s.status === 'Completed' && s.admissionDate <= b).length }; }) },
  { id: 'collections', label: 'Total collections', group: 'Fees', mod: 'fees', build: (db, rg) => effectivePayments(db.payments).filter((p) => inRange(p.date, rg)).map((p) => ({ Txn: p.id, Receipt: p.receiptNo, Date: p.date, Student: sname(db, p.studentId), 'Amount ₹': r(p.amount), Method: p.method, Reference: p.reference, 'Received by': S.empName(p.receivedBy, db) })) },
  { id: 'pending', label: 'Pending instalments', group: 'Fees', mod: 'fees', build: (db, _rg, t) => instRows(db, t).filter((x) => x.status !== 'Overdue').map(({ status, ...x }) => ({ ...x, Status: status })) },
  { id: 'overdue', label: 'Overdue payments', group: 'Fees', mod: 'fees', build: (db, _rg, t) => instRows(db, t).filter((x) => x.status === 'Overdue').map(({ status, ...x }) => ({ ...x, 'Days overdue': daysBetween(String(x['Due date']), t) })) },
  { id: 'daily', label: 'Daily collection', group: 'Fees', mod: 'fees', build: (db, rg) => {
    const pays = effectivePayments(db.payments).filter((p) => inRange(p.date, rg));
    const days: Row[] = [];
    for (let d = rg[1]; d >= rg[0] && days.length < 400; d = addDays(d, -1)) { const ps = pays.filter((p) => p.date === d); if (ps.length) days.push({ Date: d, Payments: ps.length, 'Cash ₹': r(ps.filter((p) => p.method === 'Cash').reduce((a, p) => a + p.amount, 0)), 'Digital ₹': r(ps.filter((p) => p.method !== 'Cash').reduce((a, p) => a + p.amount, 0)), 'Total ₹': r(ps.reduce((a, p) => a + p.amount, 0)) }); }
    return days;
  } },
  { id: 'revenue', label: 'Monthly revenue', group: 'Finance', mod: 'profit', build: (db, rg, t) => months(db, rg).map((m) => { const f = periodFigures(db, ...monthRange(m), t); return { Month: fmtMonth(m), 'Billed ₹': r(f.billed), 'Collected ₹': r(f.collected), 'Refunds ₹': r(f.refunds), 'GST ₹': r(f.gst), 'Earned revenue ₹': r(f.earned) }; }) },
  { id: 'expenses', label: 'Monthly expenses', group: 'Finance', mod: 'expenses', build: (db, rg) => months(db, rg).map((m) => { const es = db.expenses.filter((e) => e.status === 'Approved' && e.date.startsWith(m)); const fx = es.filter((e) => e.kind === 'fixed').reduce((a, e) => a + expenseAmount(e), 0); const vx = es.filter((e) => e.kind === 'variable').reduce((a, e) => a + expenseAmount(e), 0); return { Month: fmtMonth(m), 'Fixed ₹': r(fx), 'Variable ₹': r(vx), 'Total ₹': r(fx + vx), Entries: es.length, Pending: db.expenses.filter((e) => e.status === 'Pending' && e.date.startsWith(m)).length }; }) },
  { id: 'profit', label: 'Net profit', group: 'Finance', mod: 'profit', build: (db, rg, t) => months(db, rg).map((m) => { const p = db.periods.find((x) => x.id === m); const f = p?.status === 'closed' && p.snapshot ? p.snapshot : periodFigures(db, ...monthRange(m), t); return { Month: fmtMonth(m), 'Revenue ₹': r(f.earned), 'Expenses ₹': r(f.totalExpenses), 'Net profit ₹': r(f.netProfit), Margin: pct(f.netProfit, f.earned), Period: p?.status ?? 'open' }; }) },
  { id: 'distribution', label: 'Profit distribution', group: 'Finance', mod: 'profit', build: (db) => db.distributions.map((d) => ({ ID: d.id, Period: fmtMonth(d.periodId), 'Net profit ₹': r(d.figures.netProfit), 'Adjustments ₹': r(d.adjustments.reduce((a, x) => a + x.amount, 0)), 'Distributable ₹': r(d.distributable), ...Object.fromEntries(d.shares.map((s) => [`${s.name} ₹`, r(s.amount)])), Status: d.status, 'Approved by': S.empName(d.approvedBy, db) })) },
  { id: 'conversion', label: 'Lead conversion', group: 'CRM', mod: 'leads', build: (db, rg) => { const ls = db.leads.filter((l) => inRange(l.createdAt, rg)); return db.settings.leadStatuses.map((st) => ({ Status: st, Leads: ls.filter((l) => l.status === st).length, Share: pct(ls.filter((l) => l.status === st).length, ls.length) })); } },
  { id: 'callers', label: 'Caller performance', group: 'CRM', mod: 'leads', build: (db, rg) => db.employees.filter((e) => e.role === 'caller' || e.role === 'calling_manager').map((e) => { const as = db.leads.filter((l) => l.assignedTo === e.id); const cs = db.calls.filter((c) => c.by === e.id && c.entity === 'lead' && inRange(c.at, rg)); const conn = cs.filter((c) => ['Connected', 'Interested', 'Not Interested', 'Call Later'].includes(c.outcome)).length; const conv = as.filter((l) => l.status === 'Converted').length; return { Caller: e.name, Assigned: as.length, Calls: cs.length, Connected: conn, 'Connect rate': pct(conn, cs.length), Hot: as.filter((l) => l.status === 'Hot').length, Converted: conv, Conversion: pct(conv, as.length) }; }) },
  { id: 'sources', label: 'Lead source performance', group: 'CRM', mod: 'leads', build: (db, rg) => { const ls = db.leads.filter((l) => inRange(l.createdAt, rg)); return [...new Set(ls.map((l) => l.source))].map((s) => { const x = ls.filter((l) => l.source === s); const c = x.filter((l) => l.status === 'Converted').length; const rev = db.students.filter((st) => st.leadId && x.some((l) => l.id === st.leadId)).reduce((a, st) => a + financeFor(db, st.id, todayIST()).paid, 0); return { Source: s, Leads: x.length, Converted: c, Conversion: pct(c, x.length), 'Collected from converts ₹': r(rev) }; }); } },
  { id: 'batches', label: 'Batch-wise performance', group: 'Academics', mod: 'batches', build: (db, _rg, t) => db.batches.map((b) => { const ss = db.students.filter((s) => s.batchId === b.id); const fs = ss.map((s) => financeFor(db, s.id, t)); const sess = db.attendance.filter((a) => a.batchId === b.id); return { Batch: b.name, Status: b.status, Students: ss.length, Capacity: b.capacity, Admissions: db.enrolments.filter((e) => e.batchId === b.id).length, 'Collected ₹': r(fs.reduce((a, f) => a + f.paid, 0)), 'Outstanding ₹': r(fs.reduce((a, f) => a + f.outstanding, 0)), Sessions: sess.length, Attendance: pct(sess.reduce((a, s) => a + s.present.length, 0), sess.length * ss.length) }; }) },
  { id: 'certificates', label: 'Certificate issuance', group: 'Academics', mod: 'certificates', build: (db, rg) => db.certificates.filter((c) => inRange(c.issuedAt, rg)).map((c) => ({ 'Certificate ID': c.id, Student: c.data.name, Course: c.data.course, Issued: c.issuedAt.slice(0, 10), 'Issued by': S.empName(c.issuedBy, db), Status: c.status })) },
];
const course = (db: DB, id: string) => db.courses.find((c) => c.id === id)?.name ?? '';
const batch = (db: DB, id: string) => db.batches.find((b) => b.id === id)?.name ?? '';
const sname = (db: DB, id: string) => db.students.find((s) => s.id === id)?.name ?? '';
const months = (db: DB, rg: [string, string]) => monthsBetween(rg[0] < '2000-02-01' ? ([...db.payments.map((p) => p.date), ...db.students.map((s) => s.admissionDate)].sort()[0] ?? rg[1]) : rg[0], rg[1]).reverse();
function instRows(db: DB, t: string) {
  return db.students.filter((s) => s.status === 'Active' || s.status === 'Inactive').flatMap((s) => financeFor(db, s.id, t).lines.filter((l) => l.remaining > 0).map((l) => ({ Student: s.name, 'Student ID': s.code, Mobile: s.phone, Instalment: l.label, 'Due date': l.dueDate, 'Amount ₹': r(l.amount), 'Paid ₹': r(l.paid), 'Remaining ₹': r(l.remaining), status: l.status })));
}

export default function Reports() {
  const db = S.useDB();
  const { key, range } = useRange();
  const [sp, setSp] = useSearchParams();
  const visible = REPORTS.filter((x) => S.allowed(x.mod, 'view', db));
  const cur = visible.find((x) => x.id === sp.get('r')) ?? visible[0];
  const rows = useMemo(() => (cur ? cur.build(db, range, todayIST()) : []), [db, cur?.id, range[0], range[1]]);
  const canExport = S.allowed('reports', 'export', db);
  const name = `${cur?.id}-${range[0]}_${range[1]}`;
  const groups = [...new Set(visible.map((x) => x.group))];
  const view = sp.get('r') ? 'reports' : sp.get('view') === 'reports' ? 'reports' : 'analytics';
  if (!cur) return <Card><Empty title="No reports available for your role" /></Card>;
  const cols = Object.keys(rows[0] ?? {}).map((k) => ({ key: k, label: k, render: (row: Row) => (typeof row[k] === 'number' && k.includes('₹') ? row[k].toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : row[k]), className: typeof rows[0][k] === 'number' ? 'text-right tabular' : '', sort: (row: Row) => row[k] }));
  return (
    <>
      <PageHeader title="Reports & analytics" sub={`${RANGE_LABELS[key]}${key === 'all' ? '' : ` · ${fmtDate(range[0])} – ${fmtDate(range[1])}`} — change with the date selector at the top.`} />
      <Tabs tabs={[{ id: 'analytics', label: 'Analytics' }, { id: 'reports', label: 'Reports' }]} value={view} onChange={(v) => setSp(v === 'reports' ? { view: 'reports' } : {})} />
      {view === 'analytics' ? <VisualAnalytics range={range} /> : (
      <div className="grid lg:grid-cols-[220px_1fr] gap-4 items-start">
        <Card className="p-2">
          {groups.map((g) => (
            <div key={g} className="mb-2">
              <div className="px-2 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted">{g}</div>
              {visible.filter((x) => x.group === g).map((x) => (
                <button key={x.id} onClick={() => setSp({ r: x.id })} className={cx('w-full text-left px-2 py-1.5 rounded-md', x.id === cur.id ? 'bg-accent-soft text-accent font-medium' : 'hover:bg-surface')}>{x.label}</button>
              ))}
            </div>
          ))}
        </Card>
        <Card>
          <CardHeader title={cur.label} sub={`${rows.length} rows`} right={canExport && rows.length > 0 && (
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => downloadXLSX(rows, name)}>Excel</Button>
              <Button size="sm" onClick={() => downloadCSV(rows, name)}>CSV</Button>
              <Button size="sm" onClick={() => printTable(cur.label, `${db.settings.academyName} · ${range[0]} to ${range[1]}`, rows)}>PDF</Button>
            </div>
          )} />
          <Table rows={rows} rowKey={(row) => JSON.stringify(row)} cols={cols} empty={<Empty title="No data for this period" body="Try a wider date range." />} />
        </Card>
      </div>
      )}
    </>
  );
}

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import * as S from '../store/store';
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Kpi, Modal, Money, PageHeader, Select, Table, Tabs, Textarea, useRun, useUI } from '../ui/kit';
import { ExpenseModal } from '../ui/modals';
import { useRange } from '../ui/shell';
import { Chart, C } from './Dashboard';
import { expenseAmount } from '../domain/finance';
import { FIXED_CATEGORIES, VARIABLE_CATEGORIES } from '../domain/types';
import { fmtDate, fmtDateTime, fmtINR, fmtINRShort, fmtMonth, inRange, monthOf, monthsBetween, parseRupees, addDays } from '../domain/util';
import { downloadCSV } from '../lib/export';

export default function Expenses() {
  const db = S.useDB();
  const run = useRun();
  const { ask } = useUI();
  const { range } = useRange();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState<'all' | 'pending' | 'recurring'>(sp.get('status') === 'Pending' ? 'pending' : 'all');
  const [adding, setAdding] = useState(false);
  const [adjust, setAdjust] = useState<string | null>(null);
  const [cat, setCat] = useState('');
  const inR = db.expenses.filter((e) => inRange(e.date, range) && (!cat || e.category === cat));
  const approved = inR.filter((e) => e.status === 'Approved');
  const fixed = approved.filter((e) => e.kind === 'fixed').reduce((a, e) => a + expenseAmount(e), 0);
  const variable = approved.filter((e) => e.kind === 'variable').reduce((a, e) => a + expenseAmount(e), 0);
  const pending = db.expenses.filter((e) => e.status === 'Pending');
  const months = monthsBetween(range[0] < addDays(range[1], -150) ? range[0] : addDays(range[1], -150), range[1]).slice(-12);
  const trend = months.map((m) => {
    const es = db.expenses.filter((e) => e.status === 'Approved' && monthOf(e.date) === m);
    return { label: fmtMonth(m), fixed: es.filter((e) => e.kind === 'fixed').reduce((a, e) => a + expenseAmount(e), 0), variable: es.filter((e) => e.kind === 'variable').reduce((a, e) => a + expenseAmount(e), 0) };
  });
  const byCat = Object.entries(approved.reduce<Record<string, number>>((m, e) => ((m[e.category] = (m[e.category] ?? 0) + expenseAmount(e)), m), {})).sort((a, b) => b[1] - a[1]);
  const canApprove = S.allowed('expenses', 'approve', db);
  const rows = tab === 'pending' ? pending : inR;

  return (
    <>
      <PageHeader title="Expenses" actions={<>
        {S.allowed('expenses', 'export', db) && <Button onClick={() => downloadCSV(inR.map((e) => ({ ID: e.id, Date: e.date, Category: e.category, Type: e.kind, Description: e.description, Amount: expenseAmount(e) / 100, Method: e.method, Status: e.status, 'Added by': S.empName(e.addedBy, db), Notes: e.notes })), 'expenses')}>Export</Button>}
        {S.allowed('expenses', 'create', db) && <Button variant="primary" onClick={() => setAdding(true)}>+ Add expense</Button>}
      </>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="Total (approved)" value={fmtINR(fixed + variable)} sub="in selected period" />
        <Kpi label="Fixed" value={fmtINR(fixed)} /><Kpi label="Variable" value={fmtINR(variable)} />
        <Kpi label="Pending approval" value={pending.length} sub={fmtINR(pending.reduce((a, e) => a + expenseAmount(e), 0))} tone={pending.length ? 'warn' : undefined} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Monthly expenses" sub="Approved, fixed vs variable" />
          <Chart h={220}>
            <BarChart data={trend}><CartesianGrid vertical={false} stroke={C.grid} /><XAxis dataKey="label" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} interval={0} /><YAxis tickFormatter={fmtINRShort} tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} width={56} />
              <Tooltip formatter={(v: number) => fmtINR(v)} contentStyle={{ borderRadius: 8, fontSize: 12 }} cursor={{ fill: '#f4f4f5' }} />
              <Bar dataKey="fixed" name="Fixed" stackId="a" fill={C.ink} maxBarSize={32} /><Bar dataKey="variable" name="Variable" stackId="a" fill={C.gray} radius={[4, 4, 0, 0]} maxBarSize={32} /></BarChart>
          </Chart>
        </Card>
        <Card>
          <CardHeader title="By category" />
          <div className="px-4 pb-4 space-y-2">
            {!byCat.length && <p className="text-muted">No approved expenses in this period.</p>}
            {byCat.map(([k, v]) => (
              <button key={k} onClick={() => setCat(cat === k ? '' : k)} className="w-full text-left">
                <div className="flex justify-between text-[12.5px]"><span className={cat === k ? 'text-accent font-medium' : ''}>{k}</span><span className="tabular">{fmtINR(v)}</span></div>
                <div className="h-1.5 rounded bg-zinc-100 mt-1"><div className="h-full rounded bg-accent" style={{ width: `${(v / byCat[0][1]) * 100}%` }} /></div>
              </button>
            ))}
          </div>
        </Card>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: cat ? `${cat}` : 'All expenses', count: inR.length }, { id: 'pending', label: 'Pending approval', count: pending.length }, { id: 'recurring', label: 'Recurring', count: db.recurring.length }]} />
      {tab === 'recurring' ? <Recurring /> : (
        <Card>
          <Table rows={[...rows].sort((a, b) => b.date.localeCompare(a.date))} rowKey={(e) => e.id} empty={<Empty title="No expenses" body="Add rent, salaries, ads and other costs to see real profit." />} cols={[
            { key: 'id', label: 'ID', render: (e) => <span className="text-muted">{e.id}</span> },
            { key: 'd', label: 'Date', render: (e) => fmtDate(e.date), sort: (e) => e.date },
            { key: 'c', label: 'Category', render: (e) => <>{e.category} <span className="text-muted text-xs">{e.kind}</span></>, sort: (e) => e.category },
            { key: 'ds', label: 'Description', render: (e) => <span className="whitespace-normal">{e.description}{e.receipt && <a href={e.receipt.data} download={e.receipt.name} className="ml-2 text-accent text-xs">receipt</a>}</span> },
            { key: 'a', label: 'Amount', render: (e) => <span title={e.adjustments.map((x) => `${fmtDateTime(x.at)}: ${x.delta > 0 ? '+' : ''}${x.delta / 100} — ${x.reason}`).join('\n')}><Money v={expenseAmount(e)} />{e.adjustments.length > 0 && <span className="text-xs text-warn ml-1">adj.</span>}</span>, className: 'text-right', sort: (e) => expenseAmount(e) },
            { key: 'm', label: 'Paid via', render: (e) => e.method },
            { key: 'b', label: 'Added by', render: (e) => S.empName(e.addedBy, db) },
            { key: 's', label: 'Status', render: (e) => <Badge>{e.status}</Badge> },
            { key: 'x', label: '', render: (e) => (
              <div className="flex gap-1">
                {canApprove && e.status === 'Pending' && <><Button size="sm" onClick={() => run(() => S.decideExpense(e.id, true), 'Approved')}>Approve</Button><Button size="sm" variant="ghost" onClick={async () => { const r = await ask({ title: 'Reject expense?', input: 'Reason', confirm: 'Reject', danger: true }); if (r) run(() => S.decideExpense(e.id, false, r), 'Rejected'); }}>Reject</Button></>}
                {S.allowed('expenses', 'edit', db) && e.status !== 'Rejected' && <Button size="sm" variant="ghost" onClick={() => setAdjust(e.id)}>Adjust</Button>}
              </div>
            ) },
          ]} />
        </Card>
      )}
      <ExpenseModal open={adding} onClose={() => setAdding(false)} />
      <AdjustModal id={adjust} onClose={() => setAdjust(null)} />
    </>
  );
}

function AdjustModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const db = S.useDB();
  const run = useRun();
  const e = db.expenses.find((x) => x.id === id);
  const [amt, setAmt] = useState('');
  const [reason, setReason] = useState('');
  const p = parseRupees(amt);
  return (
    <Modal open={!!e} onClose={onClose} title={`Adjust ${e?.id}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={p === null || !reason.trim()} onClick={() => { let ok = false; run(() => { S.adjustExpense(id!, p!, reason); ok = true; }, 'Adjustment logged'); if (ok) { setAmt(''); setReason(''); onClose(); } }}>Log adjustment</Button></>}>
      {e && <div className="space-y-3">
        <p className="text-muted">Current amount {fmtINR(expenseAmount(e))}. The original entry is kept; a logged adjustment is added.</p>
        <Field label="Corrected amount (₹)"><Input value={amt} onChange={(x) => setAmt(x.target.value)} autoFocus /></Field>
        <Field label="Reason" required><Textarea value={reason} onChange={(x) => setReason(x.target.value)} /></Field>
        {e.adjustments.length > 0 && <div className="text-xs text-muted space-y-1">{e.adjustments.map((a, i) => <div key={i}>{fmtDateTime(a.at)} · {S.empName(a.by, db)}: {a.delta > 0 ? '+' : ''}{fmtINR(a.delta)} — {a.reason}</div>)}</div>}
      </div>}
    </Modal>
  );
}

function Recurring() {
  const db = S.useDB();
  const run = useRun();
  const [f, setF] = useState({ category: '', description: '', amount: '', day: '1' });
  const p = parseRupees(f.amount);
  return (
    <Card>
      {S.allowed('expenses', 'create', db) && (
        <div className="grid sm:grid-cols-5 gap-2 p-4 border-b border-line items-end">
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Select" options={[...FIXED_CATEGORIES, ...VARIABLE_CATEGORIES]} /></Field>
          <Field label="Description" className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Monthly ₹"><Input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <div className="flex gap-2 items-end"><Field label="Day"><Input type="number" min={1} max={28} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></Field>
            <Button variant="primary" disabled={!f.category || !f.description || p === null} onClick={() => { run(() => S.saveRecurring({ category: f.category, description: f.description, amount: p!, dayOfMonth: +f.day, active: true, startMonth: monthOf(new Date().toISOString().slice(0, 10)) }), 'Recurring expense saved'); setF({ category: '', description: '', amount: '', day: '1' }); }}>Add</Button></div>
        </div>
      )}
      <Table rows={db.recurring} rowKey={(r) => r.id} empty={<Empty title="No recurring expenses" body="Rent, internet and subscriptions can be generated automatically each month (as pending, for approval)." />} cols={[
        { key: 'c', label: 'Category', render: (r) => r.category }, { key: 'd', label: 'Description', render: (r) => r.description },
        { key: 'a', label: 'Amount', render: (r) => <Money v={r.amount} /> }, { key: 'day', label: 'Day of month', render: (r) => r.dayOfMonth },
        { key: 's', label: 'Status', render: (r) => <Badge tone={r.active ? 'green' : 'gray'}>{r.active ? 'Active' : 'Paused'}</Badge> },
        { key: 'x', label: '', render: (r) => S.allowed('expenses', 'edit', db) && <Button size="sm" variant="ghost" onClick={() => run(() => S.saveRecurring({ ...r, active: !r.active }))}>{r.active ? 'Pause' : 'Resume'}</Button> },
      ]} />
    </Card>
  );
}

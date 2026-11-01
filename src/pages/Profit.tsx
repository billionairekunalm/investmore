import { useState } from 'react';
import { Link } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Table, cx, useRun, useUI } from '../ui/kit';
import { useRange } from '../ui/shell';
import { expenseAmount, periodFigures, splitProfit } from '../domain/finance';
import { PAY_METHODS, type PayMethod } from '../domain/types';
import { addDays, fmtDate, fmtINR, fmtMonth, inRange, monthOf, parseRupees, RANGE_LABELS, todayIST } from '../domain/util';

const SALARY = ['Fixed Salaries', 'Commissions'];
const TONES = ['#1d4ed8', '#047857', '#6d28d9', '#c2410c', '#0f766e'];

/**
 * Salary & profit, kept simple: net profit for the selected period, what each founder receives from it,
 * and the salaries paid to others (recorded as expenses, so they reduce the profit).
 */
export default function Profit() {
  const db = S.useDB();
  const { key, range } = useRange();
  const [adding, setAdding] = useState(false);
  const [withdraw, setWithdraw] = useState<string | null>(null); // founder name, or '' for any
  const f = periodFigures(db, range[0], range[1], todayIST());
  const salaries = db.expenses.filter((e) => SALARY.includes(e.category) && inRange(e.date, range)).sort((a, b) => b.date.localeCompare(a.date));
  const salaryTotal = salaries.filter((e) => e.status === 'Approved').reduce((t, e) => t + expenseAmount(e), 0);
  const otherExpenses = f.totalExpenses - salaryTotal;
  const profit = f.netProfit;
  const founders = splitProfit(Math.max(0, profit), db.settings.shares);
  const canAdd = S.allowed('expenses', 'create', db);
  // withdrawals count against the month whose profit they come from
  const [m0, m1] = [range[0].slice(0, 7), range[1].slice(0, 7)];
  const wds = db.withdrawals.filter((w) => w.forMonth >= m0 && w.forMonth <= m1).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const taken = (name: string) => wds.filter((w) => w.founder === name).reduce((t, w) => t + w.amount, 0);
  const canWithdraw = S.allowed('profit', 'create', db);

  return (
    <>
      <PageHeader title="Salary & Profit" sub={key === 'all' ? 'All time' : `${RANGE_LABELS[key]} · ${fmtDate(range[0])} – ${fmtDate(range[1])}`} />

      {/* net profit */}
      <Card className="rounded-2xl overflow-hidden mb-5">
        <div className="h-1.5 bg-gradient-to-r from-navy via-[#173563] to-accent" />
        <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center gap-5">
          <div className="lg:w-64 shrink-0">
            <div className="text-[12px] font-bold uppercase tracking-wider text-zinc-500">Net profit</div>
            <div className={cx('text-[34px] font-bold tabular leading-tight', profit >= 0 ? 'text-accent' : 'text-bad')}>{fmtINR(profit)}</div>
            {profit < 0 && <div className="text-[12.5px] text-bad">Loss this period — nothing to share</div>}
          </div>
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-px bg-line rounded-xl overflow-hidden border border-line">
            <Part label="Fees received" sub="after refunds & GST" value={fmtINR(f.earned)} />
            <Part label="Salaries" sub={`${salaries.length} payment${salaries.length === 1 ? '' : 's'}`} value={`− ${fmtINR(salaryTotal)}`} />
            <Part label="Other expenses" sub="rent, ads, etc." value={`− ${fmtINR(otherExpenses)}`} />
          </div>
        </div>
      </Card>

      {/* founders */}
      <h2 className="text-[12px] font-bold uppercase tracking-wider text-zinc-500 mb-2.5">Founders' share</h2>
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        {founders.map((s, i) => {
          const color = TONES[i % TONES.length];
          return (
            <div key={s.name} className="rounded-2xl border p-5" style={{ background: `color-mix(in srgb, ${color} 10%, white)`, borderColor: `color-mix(in srgb, ${color} 28%, white)` }}>
              <div className="flex items-center gap-3">
                <span className="size-11 rounded-full grid place-items-center text-white font-bold text-[16px]" style={{ background: color }}>{s.name[0]?.toUpperCase()}</span>
                <div className="min-w-0"><div className="font-bold text-[16px] text-ink truncate">{s.name}</div><div className="text-[12.5px] font-semibold" style={{ color }}>{(s.pctBp / 100).toFixed(s.pctBp % 100 ? 2 : 0)}% share</div></div>
              </div>
              <div className="mt-4 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Balance to take</div>
              <div className={cx("text-[28px] font-bold tabular leading-tight", s.amount - taken(s.name) < 0 ? "text-bad" : "text-ink")}>{fmtINR(s.amount - taken(s.name))}</div>
              {s.amount - taken(s.name) < 0 && <div className="text-[12px] text-bad">Withdrawn more than the share</div>}
              <dl className="mt-3 pt-3 border-t space-y-1 text-[13px]" style={{ borderColor: `color-mix(in srgb, ${color} 25%, white)` }}>
                <div className="flex justify-between"><dt className="text-zinc-600">Share of profit</dt><dd className="font-semibold tabular">{fmtINR(s.amount)}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-600">Withdrawn</dt><dd className="font-semibold tabular">− {fmtINR(taken(s.name))}</dd></div>
              </dl>
              {canWithdraw && <Button className="mt-4 w-full" onClick={() => setWithdraw(s.name)}>Record withdrawal</Button>}
            </div>
          );
        })}
      </div>

      {/* salaries */}
      <Card className="rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3">
          <div><h2 className="font-semibold text-[15px] text-navy">Salaries paid</h2><p className="text-[12.5px] text-muted">Salaries reduce the net profit.</p></div>
          {canAdd && <Button variant="primary" onClick={() => setAdding(true)}>+ Add salary</Button>}
        </div>
        <Table rows={salaries} rowKey={(e) => e.id} empty={<Empty title="No salaries in this period" />} className="[&_td]:py-3" cols={[
          { key: 'd', label: 'Date', sort: (e) => e.date, render: (e) => <span className="tabular">{fmtDate(e.date)}</span> },
          { key: 'n', label: 'Paid to', sort: (e) => e.description, render: (e) => <span className="font-medium">{e.description}</span> },
          { key: 'm', label: 'Method', render: (e) => <span className="text-zinc-600">{e.method}</span> },
          { key: 's', label: 'Status', render: (e) => <Badge>{e.status}</Badge> },
          { key: 'a', label: 'Amount', className: 'text-right', sort: (e) => expenseAmount(e), render: (e) => <span className="font-semibold tabular">{fmtINR(expenseAmount(e))}</span> },
        ]} />
      </Card>

      {/* withdrawals */}
      <Card className="rounded-2xl overflow-hidden mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3">
          <div><h2 className="font-semibold text-[15px] text-navy">Founder withdrawals</h2><p className="text-[12.5px] text-muted">Money taken out of the profit, by the month it belongs to.</p></div>
          {canWithdraw && <Button onClick={() => setWithdraw('')}>+ Record withdrawal</Button>}
        </div>
        <Table rows={wds} rowKey={(w) => w.id} empty={<Empty title="No withdrawals for this period" />} className="[&_td]:py-3" cols={[
          { key: 'd', label: 'Date', sort: (w) => w.date, render: (w) => <span className="tabular">{fmtDate(w.date)}</span> },
          { key: 'f', label: 'Founder', sort: (w) => w.founder, render: (w) => <span className="font-medium">{w.founder}</span> },
          { key: 'm', label: 'Profit of', sort: (w) => w.forMonth, render: (w) => fmtMonth(w.forMonth) },
          { key: 'p', label: 'Paid by', render: (w) => <span className="text-zinc-600">{w.method}{w.reference && ` · ${w.reference}`}</span> },
          { key: 'a', label: 'Amount', className: 'text-right', sort: (w) => w.amount, render: (w) => <span className="font-semibold tabular">{fmtINR(w.amount)}</span> },
          { key: 'x', label: '', className: 'text-right', render: (w) => <WithdrawalActions id={w.id} /> },
        ]} />
      </Card>

      <AddSalary open={adding} onClose={() => setAdding(false)} />
      <RecordWithdrawal founder={withdraw} onClose={() => setWithdraw(null)} />
    </>
  );
}

const Part = ({ label, sub, value }: { label: string; sub: string; value: string }) => (
  <div className="bg-surface px-4 py-3">
    <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
    <div className="text-[19px] font-bold tabular text-ink">{value}</div>
    <div className="text-[11.5px] text-muted">{sub}</div>
  </div>
);

function AddSalary({ open, onClose }: { open: boolean; onClose: () => void }) {
  const run = useRun();
  const today = todayIST();
  const [f, setF] = useState({ name: '', amount: '', date: today, method: 'Bank Transfer' as PayMethod });
  const amount = parseRupees(f.amount);
  const ok = !!f.name.trim() && amount !== null && amount > 0 && !!f.date;
  const save = () => {
    let done = false;
    run(() => { S.addExpense({ category: 'Fixed Salaries', kind: 'fixed', description: f.name.trim(), amount: amount!, date: f.date, method: f.method, notes: '' }); done = true; }, 'Salary added');
    if (done) { setF({ name: '', amount: '', date: today, method: 'Bank Transfer' }); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add salary"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={save}>Add salary</Button></>}>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3.5">
        <Field label="Paid to" required className="sm:col-span-2"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name of the person" /></Field>
        <Field label="Amount (₹)" required error={f.amount && (amount === null || amount <= 0) ? 'Enter an amount' : undefined}><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Date paid" required><Input type="date" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Paid by" className="sm:col-span-2"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PayMethod })} options={PAY_METHODS.filter((m) => m !== 'Online Gateway')} /></Field>
      </div>
    </Modal>
  );
}

function WithdrawalActions({ id }: { id: string }) {
  const db = S.useDB();
  const run = useRun();
  const { ask } = useUI();
  return (
    <div className="inline-flex items-center gap-1.5">
      <Link to={`/withdrawal/${id}`} target="_blank" className="inline-flex items-center h-8 px-3 rounded-lg border border-zinc-300 bg-white text-[12.5px] font-medium hover:bg-surface">Receipt</Link>
      {S.allowed('profit', 'delete', db) && <Button size="sm" variant="ghost" onClick={async () => {
        const r = await ask({ title: 'Delete this withdrawal?', message: 'Use this only if it was entered by mistake. The deletion is logged.', input: 'Reason', confirm: 'Delete', danger: true });
        if (r) run(() => S.deleteWithdrawal(id, r), 'Withdrawal deleted');
      }}>Delete</Button>}
    </div>
  );
}

function RecordWithdrawal({ founder, onClose }: { founder: string | null; onClose: () => void }) {
  const db = S.useDB();
  const run = useRun();
  const today = todayIST();
  const lastMonth = monthOf(addDays(`${monthOf(today)}-01`, -1)); // usually last month's profit is taken at the start of a month
  const [f, setF] = useState({ founder: '', amount: '', date: today, forMonth: lastMonth, method: 'Bank Transfer' as PayMethod, reference: '', notes: '' });
  const [open, setOpen] = useState<string | null>(null);
  if (founder !== open) { setOpen(founder); if (founder !== null) setF({ founder: founder || db.settings.shares[0]?.name || '', amount: '', date: today, forMonth: lastMonth, method: 'Bank Transfer', reference: '', notes: '' }); }
  const amount = parseRupees(f.amount);
  const ok = !!f.founder && amount !== null && amount > 0 && !!f.date && /^\d{4}-\d{2}$/.test(f.forMonth) && (f.method === 'Cash' || !!f.reference.trim());
  const save = () => {
    let id: string | undefined;
    run(() => { id = S.addWithdrawal({ founder: f.founder, amount: amount!, date: f.date, forMonth: f.forMonth, method: f.method, reference: f.reference, notes: f.notes }); }, 'Withdrawal recorded');
    if (id) { onClose(); window.open(`/withdrawal/${id}`, '_blank'); }
  };
  return (
    <Modal open={founder !== null} onClose={onClose} title="Record founder withdrawal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={save}>Save & open receipt</Button></>}>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3.5">
        <Field label="Founder" required><Select value={f.founder} onChange={(e) => setF({ ...f, founder: e.target.value })} options={db.settings.shares.map((s) => s.name)} /></Field>
        <Field label="Amount (₹)" required error={f.amount && (amount === null || amount <= 0) ? 'Enter an amount' : undefined}><Input autoFocus inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Profit of month" required hint="Which month's profit this is"><Input type="month" max={monthOf(today)} value={f.forMonth} onChange={(e) => setF({ ...f, forMonth: e.target.value })} /></Field>
        <Field label="Date paid" required><Input type="date" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Paid by"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PayMethod })} options={PAY_METHODS.filter((m) => m !== 'Online Gateway')} /></Field>
        <Field label="Reference / UTR" required={f.method !== 'Cash'}><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Note" className="sm:col-span-2"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

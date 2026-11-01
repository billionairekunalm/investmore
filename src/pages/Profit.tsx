import { useState } from 'react';
import { Link } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Table, cx, useRun, useUI } from '../ui/kit';
import { useRange } from '../ui/shell';
import { expenseAmount, periodFigures, splitProfit } from '../domain/finance';
import { PAY_METHODS, type PayMethod } from '../domain/types';
import { addDays, fmtDate, fmtINR, fmtMonth, inRange, monthOf, monthRange, parseRupees, RANGE_LABELS, todayIST } from '../domain/util';

const SALARY = ['Fixed Salaries', 'Commissions'];
const TONES = ['#1d4ed8', '#047857', '#6d28d9', '#c2410c', '#0f766e'];

/**
 * Salary & profit, kept simple: net profit for the selected period, what each founder receives from it,
 * and the salaries paid to others (recorded as expenses, so they reduce the profit).
 */
export default function Profit() {
  const db = S.useDB();
  const { key, range } = useRange();
  const [tab, setTab] = useState<'founders' | 'employees'>('founders');
  const [withdraw, setWithdraw] = useState<string | null>(null); // founder being paid
  const f = periodFigures(db, range[0], range[1], todayIST());
  const salaries = db.expenses.filter((e) => SALARY.includes(e.category) && inRange(e.date, range)).sort((a, b) => b.date.localeCompare(a.date));
  const salaryTotal = salaries.filter((e) => e.status === 'Approved').reduce((t, e) => t + expenseAmount(e), 0);
  const otherExpenses = f.totalExpenses - salaryTotal;
  const profit = f.netProfit;
  const founders = splitProfit(Math.max(0, profit), db.settings.shares);
  const canAdd = S.allowed('expenses', 'create', db);
  const history = [...db.withdrawals].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const canWithdraw = S.allowed('profit', 'create', db);
  // withdrawn from the profit of the months shown, so the card drops to ₹0 once the share is taken
  const [m0, m1] = [range[0].slice(0, 7), range[1].slice(0, 7)];
  const taken = (name: string) => db.withdrawals.filter((w) => w.founder === name && w.forMonth >= m0 && w.forMonth <= m1).reduce((t, w) => t + w.amount, 0);

  return (
    <>
      <PageHeader title="Salary & Profit" sub={key === 'all' ? 'All time' : `${RANGE_LABELS[key]} · ${fmtDate(range[0])} – ${fmtDate(range[1])}`} />

      <div role="tablist" className="inline-flex gap-1 p-1 mb-5 rounded-xl bg-zinc-100/80 border border-line">
        {([['founders', 'Founders'], ['employees', 'Employees']] as const).map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={cx('h-9 px-5 rounded-lg text-[14px] font-semibold transition-colors', tab === v ? 'bg-navy text-white shadow-sm' : 'text-zinc-600 hover:text-navy hover:bg-white')}>{l}</button>
        ))}
      </div>

      {tab === 'founders' ? <>
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
      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        {founders.map((s, i) => {
          const color = TONES[i % TONES.length];
          return (
            <div key={s.name} className="rounded-2xl border p-5" style={{ background: `color-mix(in srgb, ${color} 10%, white)`, borderColor: `color-mix(in srgb, ${color} 28%, white)` }}>
              <div className="flex items-center gap-3">
                <span className="size-11 rounded-full grid place-items-center text-white font-bold text-[16px]" style={{ background: color }}>{s.name[0]?.toUpperCase()}</span>
                <div className="min-w-0"><div className="font-bold text-[16px] text-ink truncate">{s.name}</div><div className="text-[12.5px] font-semibold" style={{ color }}>{(s.pctBp / 100).toFixed(s.pctBp % 100 ? 2 : 0)}% share</div></div>
              </div>
              <div className="mt-4 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Receives</div>
              <div className="text-[28px] font-bold tabular text-ink leading-tight">{fmtINR(Math.max(0, s.amount - taken(s.name)))}</div>
              {taken(s.name) > 0 && <div className="text-[12px] text-muted tabular">Share {fmtINR(s.amount)} · withdrawn {fmtINR(taken(s.name))}</div>}
            </div>
          );
        })}
      </div>

      {/* withdrawals */}
      <Card className="rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 pt-4 pb-3">
          <h2 className="font-semibold text-[15px] text-navy">Founder withdrawals</h2>
          {canWithdraw && (
            <div className="mt-3 grid sm:grid-cols-3 gap-2">
              {db.settings.shares.map((s, i) => (
                <button key={s.name} type="button" onClick={() => setWithdraw(s.name)}
                  className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left font-semibold hover:shadow-sm transition-shadow"
                  style={{ borderColor: `color-mix(in srgb, ${TONES[i % TONES.length]} 35%, white)`, background: `color-mix(in srgb, ${TONES[i % TONES.length]} 7%, white)` }}>
                  <span className="size-8 rounded-full grid place-items-center text-white text-[13px] shrink-0" style={{ background: TONES[i % TONES.length] }}>{s.name[0]?.toUpperCase()}</span>
                  <span className="min-w-0"><span className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Withdraw</span><span className="block truncate">{s.name}</span></span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="px-4 sm:px-5 pb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">History</div>
        <Table rows={history} rowKey={(w) => w.id} empty={<Empty title="No withdrawals yet" />} className="[&_td]:py-3" cols={[
          { key: 'd', label: 'Date', sort: (w) => w.date, render: (w) => <span className="tabular">{fmtDate(w.date)}</span> },
          { key: 'f', label: 'Founder', sort: (w) => w.founder, render: (w) => <span className="font-medium">{w.founder}</span> },
          { key: 'm', label: 'Profit of', sort: (w) => w.forMonth, render: (w) => fmtMonth(w.forMonth) },
          { key: 'p', label: 'Paid by', render: (w) => <div className="leading-tight"><div className="text-zinc-700">{w.method}</div>{w.reference && <div className="text-[11.5px] text-muted truncate max-w-36">{w.reference}</div>}</div> },
          { key: 'a', label: 'Amount', className: 'text-right', sort: (w) => w.amount, render: (w) => <span className="font-semibold tabular">{fmtINR(w.amount)}</span> },
          { key: 'x', label: '', className: 'text-right', render: (w) => <WithdrawalActions id={w.id} /> },
        ]} />
      </Card>

      </> : <>
      {canAdd && <SalaryBar />}
      {/* salaries */}
      <Card className="rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3">
          <div><h2 className="font-semibold text-[15px] text-navy">Salaries paid</h2><p className="text-[12.5px] text-muted">Salaries reduce the net profit.</p></div>
          <div className="text-right"><div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Total</div><div className="font-bold tabular text-[17px]">{fmtINR(salaryTotal)}</div></div>
        </div>
        <Table rows={salaries} rowKey={(e) => e.id} empty={<Empty title="No salaries in this period" />} className="[&_td]:py-3" cols={[
          { key: 'd', label: 'Date', sort: (e) => e.date, render: (e) => <span className="tabular">{fmtDate(e.date)}</span> },
          { key: 'n', label: 'Paid to', sort: (e) => e.description, render: (e) => <span className="font-medium">{e.description}</span> },
          { key: 'm', label: 'Method', render: (e) => <span className="text-zinc-600">{e.method}</span> },
          { key: 's', label: 'Status', render: (e) => <Badge>{e.status}</Badge> },
          { key: 'a', label: 'Amount', className: 'text-right', sort: (e) => expenseAmount(e), render: (e) => <span className="font-semibold tabular">{fmtINR(expenseAmount(e))}</span> },
        ]} />
      </Card>

      </>}

      <RecordWithdrawal founder={withdraw} month={range[1].slice(0, 7)} onClose={() => setWithdraw(null)} />
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

/** One-line bar to record a salary paid to an employee (saved as a salary expense, so it lowers the profit). */
function SalaryBar() {
  const db = S.useDB();
  const run = useRun();
  const today = todayIST();
  const blank = { name: '', amount: '', date: today, method: 'Bank Transfer' as PayMethod };
  const [f, setF] = useState(blank);
  const amount = parseRupees(f.amount);
  const ok = !!f.name.trim() && amount !== null && amount > 0 && !!f.date;
  // last salary paid to this person (newest first), used to fill in the amount
  const lastSalary = (name: string) => db.expenses.filter((e) => SALARY.includes(e.category) && e.description.trim().toLowerCase() === name.trim().toLowerCase())
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const pickName = (name: string) => { const last = lastSalary(name); setF((x) => ({ ...x, name, amount: last ? String(expenseAmount(last) / 100) : x.amount, method: last?.method ?? x.method })); };
  const save = () => {
    let done = false;
    run(() => { S.addExpense({ category: 'Fixed Salaries', kind: 'fixed', description: f.name.trim(), amount: amount!, date: f.date, method: f.method, notes: '' }); done = true; }, `Salary added for ${f.name.trim()}`);
    if (done) setF(blank);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ok) save(); }}
      className="mb-4 rounded-xl border border-line bg-white shadow-[0_1px_3px_rgba(15,35,65,.05)] p-3 grid grid-cols-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-2 items-end">
      <label className="col-span-2 md:col-span-1"><span className="mb-1 block text-[11.5px] font-semibold text-zinc-600">Employee</span>
        <Input list="employee-names" value={f.name} onChange={(e) => pickName(e.target.value)} placeholder="Name" />
        <datalist id="employee-names">{[...new Set([...db.employees.filter((e) => e.active).map((e) => e.name), ...db.expenses.filter((e) => SALARY.includes(e.category)).map((e) => e.description.trim())])].map((n) => <option key={n} value={n} />)}</datalist>
      </label>
      <label><span className="mb-1 block text-[11.5px] font-semibold text-zinc-600">Amount (₹)</span><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
      <label><span className="mb-1 block text-[11.5px] font-semibold text-zinc-600">Date paid</span><Input type="date" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      <label><span className="mb-1 block text-[11.5px] font-semibold text-zinc-600">Paid by</span><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PayMethod })} options={PAY_METHODS.filter((m) => m !== 'Online Gateway')} /></label>
      <Button type="submit" variant="primary" disabled={!ok} className="col-span-2 md:col-span-1">+ Add salary</Button>
    </form>
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

function RecordWithdrawal({ founder, month, onClose }: { founder: string | null; month: string; onClose: () => void }) {
  const db = S.useDB();
  const run = useRun();
  const today = todayIST();
  // default month = the month shown on the page (top date filter), so the amount matches the founder card
  const viewMonth = month > monthOf(today) ? monthOf(today) : month;
  // founder's share of a month's profit, less what they already took for that month
  const suggest = (name: string, ym: string) => {
    const [a, b] = monthRange(ym);
    const net = periodFigures(db, a, b, today).netProfit;
    const share = splitProfit(Math.max(0, net), db.settings.shares).find((x) => x.name === name)?.amount ?? 0;
    const already = db.withdrawals.filter((w) => w.founder === name && w.forMonth === ym).reduce((t, w) => t + w.amount, 0);
    return { share, already, left: Math.max(0, share - already) };
  };
  const blank = (name: string) => ({ founder: name, amount: '', date: today, forMonth: viewMonth, method: 'Bank Transfer' as PayMethod, reference: '', notes: '' });
  const [f, setF] = useState(blank(''));
  const [open, setOpen] = useState<string | null>(null);
  if (founder !== open) {
    setOpen(founder);
    if (founder) { const g = suggest(founder, viewMonth); setF({ ...blank(founder), amount: String(g.left / 100) }); } // always filled in; editable
  }
  const g = f.founder ? suggest(f.founder, f.forMonth) : null;
  const amount = parseRupees(f.amount);
  const ok = !!f.founder && amount !== null && amount > 0 && !!f.date && /^\d{4}-\d{2}$/.test(f.forMonth) && (f.method === 'Cash' || !!f.reference.trim());
  const save = () => {
    let id: string | undefined;
    run(() => { id = S.addWithdrawal({ founder: f.founder, amount: amount!, date: f.date, forMonth: f.forMonth, method: f.method, reference: f.reference, notes: f.notes }); }, `Withdrawal recorded for ${f.founder}`);
    if (id) onClose();
  };
  return (
    <Modal open={!!founder} onClose={onClose} title={`Withdraw — ${f.founder}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={save}>Save withdrawal</Button></>}>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3.5">
        <Field label="Profit of month" required><Input type="month" max={monthOf(today)} value={f.forMonth} onChange={(e) => { const ym = e.target.value; const s2 = /^\d{4}-\d{2}$/.test(ym) ? suggest(f.founder, ym) : null; setF({ ...f, forMonth: ym, amount: s2 ? String(s2.left / 100) : f.amount }); }} /></Field>
        <Field label="Amount (₹)" required error={f.amount && (amount === null || amount <= 0) ? 'Enter an amount' : undefined}><Input autoFocus inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        {g && /^\d{4}-\d{2}$/.test(f.forMonth) && (
          <p className="sm:col-span-2 -mt-1 text-[12.5px] text-muted">
            {f.founder}'s share of {fmtMonth(f.forMonth)}: <b className="text-ink tabular">{fmtINR(g.share)}</b>{g.already > 0 && <> · already taken <b className="text-ink tabular">{fmtINR(g.already)}</b></>}
          </p>
        )}
        <Field label="Date paid" required><Input type="date" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Paid by"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PayMethod })} options={PAY_METHODS.filter((m) => m !== 'Online Gateway')} /></Field>
        <Field label="Reference / UTR" required={f.method !== 'Cash'} className="sm:col-span-2"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

import { useState } from 'react';
import * as S from '../store/store';
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Modal, Money, PageHeader, Table, Tabs, useRun, useUI, cx } from '../ui/kit';
import { expenseAmount, periodFigures } from '../domain/finance';
import type { Distribution, PeriodFigures } from '../domain/types';
import { fmtDate, fmtDateTime, fmtINR, fmtMonth, monthOf, monthRange, monthsBetween, parseRupees, todayIST } from '../domain/util';
import { printTable } from '../lib/export';

export default function Profit() {
  const db = S.useDB();
  const [tab, setTab] = useState<'periods' | 'distributions' | 'salaries'>('periods');
  return (
    <>
      <PageHeader title="Salary & profit distribution" sub={`Shares: ${db.settings.shares.map((s) => `${s.name} ${s.pctBp / 100}%`).join(' · ')} — salaries are expenses; profit shares and owner distributions are paid only from approved, closed periods.`} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'periods', label: 'Financial periods' }, { id: 'distributions', label: 'Profit distributions', count: db.distributions.length }, { id: 'salaries', label: 'Salary payments' }]} />
      {tab === 'periods' && <Periods />}
      {tab === 'distributions' && <Distributions />}
      {tab === 'salaries' && <Salaries />}
    </>
  );
}

function Periods() {
  const db = S.useDB();
  const run = useRun();
  const { ask } = useUI();
  const today = todayIST();
  const first = [...db.payments.map((p) => p.date), ...db.expenses.map((e) => e.date), ...db.students.map((s) => s.admissionDate)].sort()[0] ?? today;
  const months = monthsBetween(first, today).reverse();
  const rows = months.map((ym) => {
    const p = db.periods.find((x) => x.id === ym);
    const [a, b] = monthRange(ym);
    return { ym, p, f: p?.status === 'closed' && p.snapshot ? p.snapshot : periodFigures(db, a, b, today), live: p?.status !== 'closed', ended: b < today };
  });
  return (
    <Card>
      <CardHeader title="Monthly periods" sub="Cash basis: collections − refunds − GST − approved expenses. Closing a month locks its figures and drafts the profit distribution." />
      <Table rows={rows} rowKey={(r) => r.ym} empty={<Empty title="No financial activity yet" />} cols={[
        { key: 'm', label: 'Period', render: (r) => <span className="font-medium">{fmtMonth(r.ym)}</span> },
        { key: 'c', label: 'Collected', render: (r) => <Money v={r.f.collected} />, className: 'text-right' },
        { key: 'r', label: 'Refunds', render: (r) => <Money v={r.f.refunds} />, className: 'text-right' },
        { key: 'g', label: 'GST', render: (r) => <Money v={r.f.gst} />, className: 'text-right' },
        { key: 'fx', label: 'Fixed exp.', render: (r) => <Money v={r.f.fixedExpenses} />, className: 'text-right' },
        { key: 'vx', label: 'Variable exp.', render: (r) => <Money v={r.f.variableExpenses} />, className: 'text-right' },
        { key: 'n', label: 'Net profit', render: (r) => <Money v={r.f.netProfit} className={cx('font-semibold', r.f.netProfit < 0 ? 'text-bad' : 'text-ok')} />, className: 'text-right' },
        { key: 's', label: 'Status', render: (r) => <Badge>{r.p?.status === 'closed' ? 'closed' : 'open'}</Badge> },
        { key: 'x', label: '', render: (r) => r.p?.status === 'closed' ? (
          S.currentUser()?.role === 'super_admin' && <Button size="sm" variant="ghost" onClick={async () => { const reason = await ask({ title: `Reopen ${fmtMonth(r.ym)}?`, message: 'Reopening allows changes to a locked period. The reason is permanently recorded.', input: 'Documented reason (min. 10 characters)', confirm: 'Reopen', danger: true }); if (reason) run(() => S.reopenPeriod(r.ym, reason), 'Period reopened'); }}>Reopen</Button>
        ) : r.ended && S.allowed('profit', 'create', db) && (
          <Button size="sm" onClick={async () => { if (await ask({ title: `Close ${fmtMonth(r.ym)}?`, message: `Net profit ${fmtINR(r.f.netProfit)}. Payments, expenses and approvals dated in this month will be locked.`, confirm: 'Close period' })) run(() => S.closePeriod(r.ym), 'Period closed — distribution draft created'); }}>Close month</Button>
        ) },
      ]} />
      {db.periods.some((p) => p.history.length) && (
        <div className="px-4 py-3 border-t border-line text-xs text-muted space-y-1">
          {db.periods.flatMap((p) => p.history.map((h) => ({ ...h, id: p.id }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8).map((h, i) => (
            <div key={i}>{fmtDateTime(h.at)} · {S.empName(h.by, db)} {h.action} {fmtMonth(h.id)}{h.reason && ` — ${h.reason}`}</div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Distributions() {
  const db = S.useDB();
  const [open, setOpen] = useState<string | null>(null);
  const list = [...db.distributions].sort((a, b) => b.periodId.localeCompare(a.periodId));
  const d = db.distributions.find((x) => x.id === open);
  if (d) return <DistributionView d={d} onBack={() => setOpen(null)} />;
  return (
    <Card>
      <Table rows={list} rowKey={(x) => x.id} onRow={(x) => setOpen(x.id)} empty={<Empty title="No distributions yet" body="Close a month in Financial periods to generate its draft distribution." />} cols={[
        { key: 'id', label: 'ID', render: (x) => <span className="text-muted">{x.id}</span> }, { key: 'p', label: 'Period', render: (x) => <span className="font-medium">{fmtMonth(x.periodId)}</span> },
        { key: 'n', label: 'Net profit', render: (x) => <Money v={x.figures.netProfit} />, className: 'text-right' },
        { key: 'd', label: 'Distributable', render: (x) => <Money v={x.distributable} className="font-semibold" />, className: 'text-right' },
        ...db.settings.shares.map((s) => ({ key: s.name, label: s.name, render: (x: Distribution) => <Money v={x.shares.find((y) => y.name === s.name)?.amount ?? 0} />, className: 'text-right' })),
        { key: 's', label: 'Status', render: (x) => <Badge>{x.status}</Badge> },
      ]} />
    </Card>
  );
}

function DistributionView({ d, onBack }: { d: Distribution; onBack: () => void }) {
  const db = S.useDB();
  const run = useRun();
  const { ask } = useUI();
  const [adj, setAdj] = useState({ label: '', amount: '' });
  const [pay, setPay] = useState<string | null>(null);
  const editable = d.status === 'Draft' || d.status === 'Under Review';
  const paidFor = (n: string) => d.payments.filter((p) => p.shareName === n).reduce((a, p) => a + p.amount, 0);
  const f: PeriodFigures = d.figures;
  const adjTotal = d.adjustments.reduce((a, x) => a + x.amount, 0);
  const p = parseRupees(adj.amount.replace(/^-/, ''));
  const exportReport = () => printTable(`Profit distribution ${fmtMonth(d.periodId)}`, `${d.id} · ${d.status}${d.approvedBy ? ` · approved by ${S.empName(d.approvedBy, db)}` : ''}`, [
    { Item: 'Collections', Amount: fmtINR(f.collected) }, { Item: 'Refunds', Amount: fmtINR(-f.refunds) }, { Item: 'GST', Amount: fmtINR(-f.gst) },
    { Item: 'Total revenue (earned)', Amount: fmtINR(f.earned) }, { Item: 'Fixed expenses', Amount: fmtINR(-f.fixedExpenses) }, { Item: 'Variable expenses', Amount: fmtINR(-f.variableExpenses) },
    { Item: 'Net profit', Amount: fmtINR(f.netProfit) }, ...d.adjustments.map((a) => ({ Item: `Adjustment: ${a.label}`, Amount: fmtINR(a.amount) })),
    { Item: 'Distributable profit', Amount: fmtINR(d.distributable) },
    ...d.shares.map((s) => ({ Item: `${s.name} (${s.pctBp / 100}%)`, Amount: `${fmtINR(s.amount)} · paid ${fmtINR(paidFor(s.name))}` })),
  ]);
  return (
    <>
      <button onClick={onBack} className="text-muted hover:text-ink mb-2">← All distributions</button>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h2 className="text-[18px] font-semibold">{fmtMonth(d.periodId)} distribution</h2><Badge>{d.status}</Badge>
        <div className="flex-1" />
        <Button onClick={exportReport}>Print / PDF</Button>
        {d.status === 'Draft' && <Button variant="primary" onClick={() => run(() => S.setDistributionStatus(d.id, 'Under Review'), 'Sent for review')}>Submit for review</Button>}
        {d.status === 'Under Review' && S.allowed('profit', 'approve', db) && <><Button onClick={() => run(() => S.setDistributionStatus(d.id, 'Draft'))}>Back to draft</Button><Button variant="primary" onClick={() => run(() => S.setDistributionStatus(d.id, 'Approved'), 'Approved')}>Approve</Button></>}
        {['Approved', 'Paid', 'Partially Paid'].includes(d.status) && S.allowed('profit', 'approve', db) && <Button variant="danger" onClick={async () => { const r = await ask({ title: 'Reverse distribution?', input: 'Reason', confirm: 'Reverse', danger: true }); if (r) run(() => S.setDistributionStatus(d.id, 'Reversed', r), 'Reversed'); }}>Reverse</Button>}
      </div>
      {d.distributable <= 0 && <div className="mb-4 rounded-lg border border-bad/20 bg-bad-soft p-3 text-bad">No distributable profit for this period. Payouts are blocked.</div>}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Calculation</h3>
          {[['Collections', f.collected], ['Refunds', -f.refunds], ['GST liability', -f.gst], ['Total revenue (earned)', f.earned, true], ['Fixed expenses', -f.fixedExpenses], ['Variable expenses', -f.variableExpenses], ['Net profit', f.netProfit, true]].map(([k, v, b]) => (
            <div key={k as string} className={cx('flex justify-between py-1.5', !!b && 'border-t border-line font-semibold')}><span>{k}</span><Money v={v as number} /></div>
          ))}
          {d.adjustments.map((a, i) => <div key={i} className="flex justify-between py-1.5 text-zinc-600"><span>Adjustment: {a.label}{editable && <button className="ml-2 text-xs text-bad" onClick={() => run(() => S.setDistributionAdjustments(d.id, d.adjustments.filter((_, j) => j !== i)))}>remove</button>}</span><Money v={a.amount} /></div>)}
          <div className="flex justify-between py-2 border-t-2 border-ink font-semibold text-[15px]"><span>Distributable profit</span><Money v={d.distributable} /></div>
          {editable && S.allowed('profit', 'edit', db) && (
            <div className="flex gap-2 items-end mt-3">
              <Field label="Approved adjustment" className="flex-1"><Input value={adj.label} onChange={(e) => setAdj({ ...adj, label: e.target.value })} placeholder="e.g. Reserve for taxes" /></Field>
              <Field label="₹ (use − to deduct)" className="w-36"><Input value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} /></Field>
              <Button disabled={!adj.label || p === null} onClick={() => { run(() => S.setDistributionAdjustments(d.id, [...d.adjustments, { label: adj.label, amount: adj.amount.trim().startsWith('-') ? -p! : p! }]), 'Adjustment added'); setAdj({ label: '', amount: '' }); }}>Add</Button>
            </div>
          )}
          <p className="text-xs text-muted mt-3">Net {fmtINR(f.netProfit)} {adjTotal ? `${adjTotal > 0 ? '+' : '−'} ${fmtINR(Math.abs(adjTotal))} adjustments ` : ''}= {fmtINR(d.distributable)} (never below zero)</p>
        </Card>
        <Card>
          <CardHeader title="Shares" sub={d.approvedBy ? `Approved by ${S.empName(d.approvedBy, db)}` : 'Not yet approved'} />
          <Table rows={d.shares} rowKey={(s) => s.name} cols={[
            { key: 'n', label: 'Person', render: (s) => <span className="font-medium">{s.name}</span> }, { key: 'p', label: '%', render: (s) => `${s.pctBp / 100}%` },
            { key: 'a', label: 'Amount', render: (s) => <Money v={s.amount} />, className: 'text-right' }, { key: 'pd', label: 'Paid', render: (s) => <Money v={paidFor(s.name)} className="text-ok" />, className: 'text-right' },
            { key: 'st', label: 'Status', render: (s) => <Badge>{paidFor(s.name) >= s.amount && s.amount > 0 ? 'Paid' : paidFor(s.name) > 0 ? 'Partially Paid' : 'Pending'}</Badge> },
            { key: 'x', label: '', render: (s) => (d.status === 'Approved' || d.status === 'Partially Paid') && paidFor(s.name) < s.amount && S.allowed('profit', 'edit', db) && <Button size="sm" onClick={() => setPay(s.name)}>Record payout</Button> },
          ]} />
          {d.payments.length > 0 && <div className="px-4 py-3 border-t border-line text-xs text-muted space-y-1">{d.payments.map((p) => <div key={p.id}>{p.id} · {fmtDate(p.at)} · {p.shareName} {fmtINR(p.amount)} · {S.empName(p.by, db)}</div>)}</div>}
        </Card>
      </div>
      <PayoutModal d={d} share={pay} onClose={() => setPay(null)} remaining={pay ? (d.shares.find((s) => s.name === pay)!.amount - paidFor(pay)) : 0} />
    </>
  );
}

function PayoutModal({ d, share, onClose, remaining }: { d: Distribution; share: string | null; onClose: () => void; remaining: number }) {
  const run = useRun();
  const [amt, setAmt] = useState('');
  const [date, setDate] = useState(todayIST());
  const p = parseRupees(amt || String(remaining / 100));
  return (
    <Modal open={!!share} onClose={onClose} title={`Payout to ${share}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={p === null} onClick={() => { let ok = false; run(() => { S.payDistribution(d.id, share!, p!, date); ok = true; }, 'Payout recorded'); if (ok) { setAmt(''); onClose(); } }}>Record payout</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₹)" hint={`Remaining ${fmtINR(remaining)}`}><Input value={amt} placeholder={String(remaining / 100)} onChange={(e) => setAmt(e.target.value)} /></Field>
        <Field label="Paid on"><Input type="date" max={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function Salaries() {
  const db = S.useDB();
  const rows = db.expenses.filter((e) => e.category === 'Fixed Salaries' || e.category === 'Commissions').sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Card>
      <CardHeader title="Salary & commission payments" sub="Recorded as expenses (they reduce profit). Profit shares are tracked separately under distributions." />
      <Table rows={rows} rowKey={(e) => e.id} empty={<Empty title="No salary payments" body="Add them in Expenses with the 'Fixed Salaries' or 'Commissions' category." />} cols={[
        { key: 'd', label: 'Date', render: (e) => fmtDate(e.date) }, { key: 'm', label: 'Month', render: (e) => fmtMonth(monthOf(e.date)) }, { key: 'c', label: 'Type', render: (e) => e.category },
        { key: 'ds', label: 'Description', render: (e) => e.description }, { key: 'a', label: 'Amount', render: (e) => <Money v={expenseAmount(e)} />, className: 'text-right' }, { key: 's', label: 'Status', render: (e) => <Badge>{e.status}</Badge> },
      ]} />
    </Card>
  );
}

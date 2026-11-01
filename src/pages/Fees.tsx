import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Kpi, Money, PageHeader, SearchInput, Table, Tabs, useRun, useUI } from '../ui/kit';
import { PaymentModal } from '../ui/modals';
import { useRange } from '../ui/shell';
import { financeFor, periodFigures } from '../domain/finance';
import { fmtDate, fmtINR, inRange, parseRupees, todayIST } from '../domain/util';
import { downloadCSV } from '../lib/export';

export default function Fees() {
  const db = S.useDB();
  const nav = useNavigate();
  const run = useRun();
  const { ask } = useUI();
  const { range } = useRange();
  const [tab, setTab] = useState<'plans' | 'verify' | 'ledger' | 'structure'>('plans');
  const [q, setQ] = useState('');
  const [pay, setPay] = useState(false);
  const today = todayIST();
  const plans = useMemo(() => db.feePlans.map((p) => ({ p, s: db.students.find((x) => x.id === p.studentId)!, f: financeFor(db, p.studentId, today) })), [db]);
  const reversed = new Set(db.payments.filter((p) => p.kind === 'reversal').map((p) => p.reversesId));
  const unverified = db.payments.filter((p) => p.kind === 'payment' && !p.verified && !reversed.has(p.id));
  const fig = periodFigures(db, range[0], range[1], today);
  const ledger = db.payments.filter((p) => inRange(p.date, range)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sName = (id: string) => db.students.find((s) => s.id === id)?.name ?? '—';
  const t = q.toLowerCase();

  return (
    <>
      <PageHeader title="Fee management" actions={S.allowed('fees', 'create', db) && <Button variant="primary" onClick={() => setPay(true)}>Record payment</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="Fees billed" value={fmtINR(fig.billed)} sub="new fee plans in period" />
        <Kpi label="Collected" value={fmtINR(fig.collected)} sub="verified, net of reversals" tone="ok" />
        <Kpi label="Refunds" value={fmtINR(fig.refunds)} tone={fig.refunds ? 'bad' : undefined} />
        <Kpi label="Outstanding (today)" value={fmtINR(fig.outstanding)} tone="warn" to="/collections?view=due7" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'plans', label: 'Fee plans', count: plans.length }, { id: 'verify', label: 'Awaiting verification', count: unverified.length }, { id: 'ledger', label: 'Transaction ledger' }, { id: 'structure', label: 'Course fee structure' }]} />
      {tab === 'plans' && <>
        <SearchInput value={q} onChange={setQ} placeholder="Search student" className="w-full sm:w-64 mb-3" />
        <Card>
          <Table rows={plans.filter((r) => !t || r.s.name.toLowerCase().includes(t) || r.s.code.toLowerCase().includes(t))} rowKey={(r) => r.p.id} onRow={(r) => nav(`/students/${r.s.id}?tab=fees`)} empty={<Empty title="No fee plans" body="Fee plans are created automatically on admission." />} cols={[
            { key: 'n', label: 'Student', render: (r) => <span className="font-medium">{r.s.name} <span className="text-muted font-normal">{r.s.code}</span></span>, sort: (r) => r.s.name },
            { key: 'pol', label: 'Booking policy', render: (r) => (r.p.policy === 'additional' ? 'Additional' : 'Credited') },
            { key: 'bk', label: 'Booking', render: (r) => <Money v={r.p.bookingAmount} />, className: 'text-right' },
            { key: 't', label: 'Total', render: (r) => <Money v={r.f.total} />, className: 'text-right', sort: (r) => r.f.total },
            { key: 'p', label: 'Paid', render: (r) => <Money v={r.f.paid} className="text-ok" />, className: 'text-right', sort: (r) => r.f.paid },
            { key: 'o', label: 'Outstanding', render: (r) => <Money v={r.f.outstanding} />, className: 'text-right', sort: (r) => r.f.outstanding },
            { key: 'nx', label: 'Next due', render: (r) => (r.f.next ? `${fmtDate(r.f.next.dueDate)} · ${fmtINR(r.f.next.remaining)}` : '—'), sort: (r) => r.f.next?.dueDate ?? '9' },
            { key: 's', label: 'Status', render: (r) => <Badge>{r.f.status}</Badge>, sort: (r) => r.f.status },
          ]} />
        </Card>
      </>}
      {tab === 'verify' && (
        <Card>
          <CardHeader title="Payments awaiting verification" sub="Not counted as collected until verified against the bank / gateway statement." />
          <Table rows={unverified} rowKey={(p) => p.id} empty={<Empty title="All payments verified" />} cols={[
            { key: 'id', label: 'Txn', render: (p) => p.id }, { key: 's', label: 'Student', render: (p) => sName(p.studentId) }, { key: 'd', label: 'Date', render: (p) => fmtDate(p.date) },
            { key: 'a', label: 'Amount', render: (p) => <Money v={p.amount} /> }, { key: 'm', label: 'Method', render: (p) => p.method }, { key: 'r', label: 'Reference', render: (p) => p.reference || '—' },
            { key: 'x', label: '', render: (p) => S.allowed('fees', 'approve', db) && <div className="flex gap-1">
              <Button size="sm" variant="primary" onClick={() => run(() => S.verifyPayment(p.id), 'Verified')}>Verify</Button>
              <Button size="sm" variant="ghost" onClick={async () => { const r = await ask({ title: 'Reject this payment?', message: 'It will be reversed (kept on record).', input: 'Reason', confirm: 'Reverse', danger: true }); if (r) run(() => S.reversePayment(p.id, r), 'Reversed'); }}>Not received</Button>
            </div> },
          ]} />
        </Card>
      )}
      {tab === 'ledger' && (
        <Card>
          <CardHeader title="Transaction ledger" sub="Every payment, reversal and refund in the selected period. Entries are never edited or deleted." right={S.allowed('fees', 'export', db) && <Button size="sm" onClick={() => downloadCSV(ledger.map((p) => ({ Txn: p.id, Type: p.kind, Date: p.date, Student: sName(p.studentId), Amount: (p.kind === 'payment' ? p.amount : -p.amount) / 100, Method: p.method, Reference: p.reference, Verified: p.verified ? 'yes' : 'no', 'Reverses': p.reversesId ?? '', 'Received by': S.empName(p.receivedBy, db), Receipt: p.receiptNo, Notes: p.notes })), 'ledger')}>Export</Button>} />
          <Table rows={ledger} rowKey={(p) => p.id} empty={<Empty title="No transactions in this period" />} cols={[
            { key: 'id', label: 'Txn', render: (p) => <span className="text-muted">{p.id}</span> }, { key: 'k', label: 'Type', render: (p) => <Badge tone={p.kind === 'payment' ? (reversed.has(p.id) ? 'gray' : 'green') : 'red'}>{p.kind}</Badge> },
            { key: 'd', label: 'Date', render: (p) => fmtDate(p.date) }, { key: 's', label: 'Student', render: (p) => sName(p.studentId) },
            { key: 'a', label: 'Amount', render: (p) => <Money v={p.kind === 'payment' ? p.amount : -p.amount} />, className: 'text-right' },
            { key: 'm', label: 'Method', render: (p) => p.method }, { key: 'r', label: 'Ref', render: (p) => p.reference || p.reversesId || '—' }, { key: 'b', label: 'By', render: (p) => S.empName(p.receivedBy, db) },
          ]} />
        </Card>
      )}
      {tab === 'structure' && <Structure />}
      <PaymentModal open={pay} onClose={() => setPay(false)} />
    </>
  );
}

function Structure() {
  const db = S.useDB();
  const run = useRun();
  const can = S.allowed('settings', 'edit', db);
  return (
    <div className="space-y-4">
      {db.courses.map((c) => <CourseEditor key={c.id} id={c.id} disabled={!can} />)}
      {can && <Button onClick={() => run(() => S.saveCourse({ name: 'New course', bookingDefault: 100000, instalments: [300000, 300000, 150000], durationWeeks: 8 }), 'Course added')}>+ Add course</Button>}
      <p className="text-xs text-muted">Changes apply to new admissions only. Existing fee plans keep their schedule; adjust them individually from the student's Fee details tab (logged).</p>
    </div>
  );
}

function CourseEditor({ id, disabled }: { id: string; disabled: boolean }) {
  const db = S.useDB();
  const run = useRun();
  const c = db.courses.find((x) => x.id === id)!;
  const [name, setName] = useState(c.name);
  const [booking, setBooking] = useState(String(c.bookingDefault / 100));
  const [inst, setInst] = useState(c.instalments.map((x) => String(x / 100)));
  const [weeks, setWeeks] = useState(String(c.durationWeeks));
  const parsed = inst.map(parseRupees);
  const bk = parseRupees(booking);
  const ok = bk !== null && parsed.every((x) => x !== null && x > 0) && !!name.trim();
  return (
    <Card className="p-4">
      <div className="grid sm:grid-cols-4 gap-3">
        <Field label="Course name" className="sm:col-span-2"><Input value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} /></Field>
        <Field label="Default booking (₹)" hint="₹500–₹1,000 typical"><Input value={booking} onChange={(e) => setBooking(e.target.value)} disabled={disabled} /></Field>
        <Field label="Duration (weeks)"><Input type="number" value={weeks} onChange={(e) => setWeeks(e.target.value)} disabled={disabled} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        {inst.map((v, i) => (
          <Field key={i} label={`Instalment ${i + 1} (₹)`} className="w-32"><Input value={v} onChange={(e) => setInst(inst.map((x, j) => (j === i ? e.target.value : x)))} disabled={disabled} /></Field>
        ))}
        {!disabled && <>
          <Button size="sm" variant="ghost" onClick={() => setInst([...inst, '1000'])}>+ Instalment</Button>
          {inst.length > 1 && <Button size="sm" variant="ghost" onClick={() => setInst(inst.slice(0, -1))}>− Remove last</Button>}
        </>}
        <div className="flex-1" />
        <span className="text-muted pb-2">Instalments total {ok ? fmtINR(parsed.reduce((a, b) => a! + b!, 0)!) : '—'}</span>
        {!disabled && <Button variant="primary" disabled={!ok} onClick={() => run(() => S.saveCourse({ id, name, bookingDefault: bk!, instalments: parsed as number[], durationWeeks: +weeks || 1 }), 'Course saved')}>Save</Button>}
      </div>
    </Card>
  );
}

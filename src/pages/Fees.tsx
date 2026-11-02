import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Kpi, Money, PageHeader, SearchInput, Table, Tabs, cx, useRun, useUI } from '../ui/kit';
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
  const [tab, setTab] = useState<'plans' | 'verify' | 'ledger'>('plans');
  const [q, setQ] = useState('');
  const [nearest, setNearest] = useState(false); // fee plans: only fees to collect, nearest due date first
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
      <PageHeader title="Fee management" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="Fees billed" value={fmtINR(fig.billed)} sub="new fee plans in period" />
        <Kpi label="Collected" value={fmtINR(fig.collected)} sub="verified, net of reversals" tone="ok" />
        <Kpi label="Refunds" value={fmtINR(fig.refunds)} tone={fig.refunds ? 'bad' : undefined} />
        <Kpi label="Balance due (today)" value={fmtINR(fig.outstanding)} tone="warn" to="/collections?view=due7" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'plans', label: 'Fee plans', count: plans.length }, { id: 'verify', label: 'Awaiting verification', count: unverified.length }, { id: 'ledger', label: 'Transaction ledger' }]} />
      {tab === 'plans' && <>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <SearchInput value={q} onChange={setQ} placeholder="Search student" className="w-full sm:w-64" />
          <button type="button" aria-pressed={nearest} onClick={() => setNearest(!nearest)}
            className={cx('inline-flex items-center gap-2 h-10 px-3.5 rounded-xl border text-[13.5px] font-semibold transition-all shadow-sm',
              nearest ? 'bg-accent border-accent text-white shadow-[0_4px_14px_-4px_rgba(21,128,61,.5)]' : 'bg-accent/10 border-accent/30 text-accent hover:bg-accent/15')}>
            <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            Nearest due first          </button>
        </div>
        <Card>
          <Table key={String(nearest)} rows={(nearest
            ? plans.filter((r) => r.f.next && r.f.outstanding > 0).sort((a, b) => a.f.next!.dueDate.localeCompare(b.f.next!.dueDate)) // only fees still to collect, soonest (or most overdue) on top
            : plans).filter((r) => !t || r.s.name.toLowerCase().includes(t) || r.s.code.toLowerCase().includes(t))}rowKey={(r) => r.p.id} onRow={(r) => nav(`/students/${r.s.id}?tab=fees`)} empty={<Empty title="No fee plans" body="Fee plans are created automatically on admission." />} cols={[
            { key: 'n', label: 'Student', render: (r) => <span className="font-medium">{r.s.name} <span className="text-muted font-normal">{r.s.code}</span></span>, sort: (r) => r.s.name },
            { key: 'bk', label: 'Booking (in fee)', render: (r) => <Money v={r.p.bookingAmount} />, className: 'text-right' },
            { key: 't', label: 'Course fee', render: (r) => <Money v={r.f.total} />, className: 'text-right', sort: (r) => r.f.total },
            { key: 'p', label: 'Paid', render: (r) => <Money v={r.f.paid} className="text-ok" />, className: 'text-right', sort: (r) => r.f.paid },
            { key: 'o', label: 'Balance due', render: (r) => <Money v={r.f.outstanding} />, className: 'text-right', sort: (r) => r.f.outstanding },
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
              <Button size="sm" variant="primary" onClick={() => run(() => S.verifyPayment(p.id), 'Payment confirmed')}>Confirm</Button>
              <Button size="sm" variant="ghost" onClick={async () => { const r = await ask({ title: 'Reject this payment?', message: 'It will be cancelled. It stays in the records, marked as cancelled.', input: 'Reason', confirm: 'Reverse', danger: true }); if (r) run(() => S.reversePayment(p.id, r), 'Reversed'); }}>Not received</Button>
            </div> },
          ]} />
        </Card>
      )}
      {tab === 'ledger' && (
        <Card>
          <CardHeader title="Transaction ledger" sub="Every payment, cancelled payment and refund in the selected period. Nothing here is ever edited or deleted." right={S.allowed('fees', 'export', db) && <Button size="sm" onClick={() => downloadCSV(ledger.map((p) => ({ Txn: p.id, Type: p.kind, Date: p.date, Student: sName(p.studentId), Amount: (p.kind === 'payment' ? p.amount : -p.amount) / 100, Method: p.method, Reference: p.reference, Verified: p.verified ? 'yes' : 'no', 'Reverses': p.reversesId ?? '', 'Received by': S.empName(p.receivedBy, db), Receipt: p.receiptNo, Notes: p.notes })), 'ledger')}>Export</Button>} />
          <Table rows={ledger} rowKey={(p) => p.id} empty={<Empty title="No transactions in this period" />} cols={[
            { key: 'id', label: 'Txn', render: (p) => <span className="text-muted">{p.id}</span> }, { key: 'k', label: 'Type', render: (p) => <Badge tone={p.kind === 'payment' ? (reversed.has(p.id) ? 'gray' : 'green') : 'red'}>{p.kind}</Badge> },
            { key: 'd', label: 'Date', render: (p) => fmtDate(p.date) }, { key: 's', label: 'Student', render: (p) => sName(p.studentId) },
            { key: 'a', label: 'Amount', render: (p) => <Money v={p.kind === 'payment' ? p.amount : -p.amount} />, className: 'text-right' },
            { key: 'm', label: 'Method', render: (p) => p.method }, { key: 'r', label: 'Ref', render: (p) => p.reference || p.reversesId || '—' }, { key: 'b', label: 'By', render: (p) => S.empName(p.receivedBy, db) },
          ]} />
        </Card>
      )}
    </>
  );
}


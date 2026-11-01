import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Button, Card, Empty, Kpi, Money, PageHeader, SearchInput, Table, Tabs } from '../ui/kit';
import { CallButton, useCall, useRange } from '../ui/shell';
import { PaymentModal } from '../ui/modals';
import { financeFor } from '../domain/finance';
import { addDays, fmtDate, fmtINR, fmtPhone, inRange, todayIST } from '../domain/util';
import { downloadCSV } from '../lib/export';

type View = 'all' | 'today' | 'due_today' | 'due_tomorrow' | 'due7' | 'overdue' | 'partial' | 'paid';
const VIEWS: { id: View; label: string }[] = [
  { id: 'overdue', label: 'Overdue' }, { id: 'due_today', label: 'Due today' }, { id: 'due_tomorrow', label: 'Due tomorrow' }, { id: 'due7', label: 'Due in 7 days' },
  { id: 'partial', label: 'Partially paid' }, { id: 'paid', label: 'Fully paid' }, { id: 'today', label: 'Collected today' }, { id: 'all', label: 'All payments' },
];

export default function Collections() {
  const db = S.useDB();
  const nav = useNavigate();
  const { log } = useCall();
  const { range } = useRange();
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('view') as View) || 'overdue';
  const [q, setQ] = useState('');
  const [pay, setPay] = useState<string | null>(null);
  const today = todayIST();
  const rows = useMemo(() => db.students.filter((s) => s.status !== 'Refunded' && s.status !== 'Dropped').map((s) => ({ s, f: financeFor(db, s.id, today) })), [db]);
  const t = q.toLowerCase();
  const match = (name: string, phone: string) => !t || name.toLowerCase().includes(t) || phone.includes(t);
  const due = (d: string) => rows.filter((r) => r.f.lines.some((l) => l.remaining > 0 && l.dueDate === d));
  const by: Record<Exclude<View, 'all' | 'today'>, typeof rows> = {
    overdue: rows.filter((r) => r.f.lines.some((l) => l.status === 'Overdue')),
    due_today: due(today), due_tomorrow: due(addDays(today, 1)),
    due7: rows.filter((r) => r.f.lines.some((l) => l.remaining > 0 && l.dueDate >= today && l.dueDate <= addDays(today, 7))),
    partial: rows.filter((r) => r.f.paid > 0 && r.f.outstanding > 0), paid: rows.filter((r) => r.f.total > 0 && r.f.outstanding === 0),
  };
  // latest fee call per student (db.calls is newest-first)
  const lastCall = (id: string) => db.calls.find((c) => c.entity === 'student' && c.entityId === id);
  const sum = (rs: typeof rows, pick: (r: (typeof rows)[0]) => number) => rs.reduce((a, r) => a + pick(r), 0);
  const overdueAmt = sum(by.overdue, (r) => r.f.lines.filter((l) => l.status === 'Overdue').reduce((a, l) => a + l.remaining, 0));
  const payments = db.payments.filter((p) => p.kind === 'payment' && (view === 'today' ? p.date === today : inRange(p.date, range)));
  const reversed = new Set(db.payments.filter((p) => p.kind === 'reversal').map((p) => p.reversesId));
  const collectedToday = db.payments.filter((p) => p.kind === 'payment' && p.verified && !reversed.has(p.id) && p.date === today).reduce((a, p) => a + p.amount, 0);
  const sName = (id: string) => db.students.find((s) => s.id === id);

  const counts = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length]));
  const list = view === 'all' || view === 'today' ? [] : by[view].filter((r) => match(r.s.name, r.s.phone));
  const nextFor = (r: (typeof rows)[0]) => (view === 'overdue' ? r.f.lines.find((l) => l.status === 'Overdue') : r.f.next);

  return (
    <>
      <PageHeader title="Collections" sub="Who to call for money today." actions={S.allowed('collections', 'export', db) && view !== 'all' && view !== 'today' &&
        <Button onClick={() => downloadCSV(list.map((r) => ({ Student: r.s.name, ID: r.s.code, Mobile: r.s.phone, 'Total fee': r.f.total / 100, Paid: r.f.paid / 100, Remaining: r.f.outstanding / 100, 'Next instalment': nextFor(r)?.label ?? '', 'Due date': nextFor(r)?.dueDate ?? '', Status: r.f.status })), `collections-${view}`)}>Export</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="Overdue" value={fmtINR(overdueAmt)} sub={`${by.overdue.length} students`} tone={overdueAmt ? 'bad' : undefined} />
        <Kpi label="Due today" value={fmtINR(sum(by.due_today, (r) => r.f.lines.filter((l) => l.dueDate === today).reduce((a, l) => a + l.remaining, 0)))} sub={`${by.due_today.length} students`} tone="warn" />
        <Kpi label="Due next 7 days" value={fmtINR(sum(by.due7, (r) => r.f.lines.filter((l) => l.dueDate >= today && l.dueDate <= addDays(today, 7)).reduce((a, l) => a + l.remaining, 0)))} sub={`${by.due7.length} students`} />
        <Kpi label="Collected today" value={fmtINR(collectedToday)} tone="ok" />
      </div>
      <Tabs tabs={VIEWS.map((v) => ({ ...v, count: v.id === 'all' || v.id === 'today' ? undefined : counts[v.id] }))} value={view} onChange={(v) => { sp.set('view', v); setSp(sp, { replace: true }); }} />
      <SearchInput value={q} onChange={setQ} placeholder="Search student or mobile" className="w-full sm:w-64 mb-3" />
      <Card>
        {view === 'all' || view === 'today' ? (
          <Table rows={payments.filter((p) => { const s = sName(p.studentId); return !!s && match(s.name, s.phone); }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))} rowKey={(p) => p.id}
            onRow={(p) => nav(`/students/${p.studentId}?tab=payments`)} empty={<Empty title="No payments in this range" body="Use the date range at the top to widen it." />} cols={[
              { key: 'id', label: 'Transaction', render: (p) => <span className="text-muted">{p.id}</span> }, { key: 'd', label: 'Date', render: (p) => fmtDate(p.date), sort: (p) => p.date },
              { key: 's', label: 'Student', render: (p) => <span className="font-medium">{sName(p.studentId)?.name}</span> },
              { key: 'a', label: 'Amount', render: (p) => <Money v={p.amount} className={reversed.has(p.id) ? 'line-through text-muted' : ''} />, className: 'text-right', sort: (p) => p.amount },
              { key: 'm', label: 'Method', render: (p) => p.method }, { key: 'r', label: 'Reference', render: (p) => p.reference || '—' },
              { key: 'v', label: 'Status', render: (p) => (reversed.has(p.id) ? <Badge tone="gray">Reversed</Badge> : p.verified ? <Badge tone="green">Received</Badge> : <Badge tone="orange">Unverified</Badge>) },
              { key: 'b', label: 'By', render: (p) => S.empName(p.receivedBy, db) },
            ]} />
        ) : (
          <Table rows={list} rowKey={(r) => r.s.id} onRow={(r) => nav(`/students/${r.s.id}?tab=fees`)}
            empty={<Empty title={view === 'overdue' ? 'Nothing overdue' : 'No students in this view'} body={view === 'overdue' ? 'Every instalment that is due has been paid.' : undefined} />}
            cols={[
              { key: 'n', label: 'Name', render: (r) => <span className="font-medium">{r.s.name}</span>, sort: (r) => r.s.name },
              { key: 'p', label: 'Mobile', render: (r) => fmtPhone(r.s.phone) },
              { key: 't', label: 'Total fee', render: (r) => <Money v={r.f.total} />, className: 'text-right' },
              { key: 'pd', label: 'Paid', render: (r) => <Money v={r.f.paid} className="text-ok" />, className: 'text-right' },
              { key: 'rm', label: 'Remaining', render: (r) => <Money v={r.f.outstanding} />, className: 'text-right', sort: (r) => r.f.outstanding },
              { key: 'ni', label: 'Next instalment', render: (r) => { const n = nextFor(r); return n ? <>{n.label} · <Money v={n.remaining} /></> : '—'; } },
              { key: 'dd', label: 'Due date', render: (r) => { const n = nextFor(r); return <span className={n?.status === 'Overdue' ? 'text-bad font-medium' : ''}>{fmtDate(n?.dueDate)}</span>; }, sort: (r) => nextFor(r)?.dueDate ?? '9' },
              { key: 'st', label: 'Status', render: (r) => <Badge>{view === 'overdue' ? 'Overdue' : r.f.status}</Badge> },
              { key: 'lc', label: 'Last call', sort: (r) => lastCall(r.s.id)?.nextFollowUp ?? '9', render: (r) => {
                const c = lastCall(r.s.id);
                if (!c) return <span className="text-muted text-[12.5px]">Not called</span>;
                const late = c.nextFollowUp && c.nextFollowUp < today;
                return (
                  <div className="leading-tight" title={c.notes || undefined}>
                    <Badge>{c.outcome}</Badge>
                    <div className={`mt-1 text-[11.5px] ${late ? 'text-bad font-semibold' : 'text-muted'}`}>
                      {c.nextFollowUp ? `${c.outcome === 'Promised to Pay' ? 'Promised' : c.outcome === 'Needs More Time' ? 'Pay by' : 'Follow up'} ${fmtDate(c.nextFollowUp)}${late ? ' · missed' : ''}` : fmtDate(c.at.slice(0, 10))}
                    </div>
                  </div>
                );
              } },
              { key: 'c', label: 'Call', render: (r) => (
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <CallButton target={{ entity: 'student', id: r.s.id, name: r.s.name, phone: r.s.phone }} />
                  <Button size="sm" variant="ghost" onClick={() => log({ entity: 'student', id: r.s.id, name: r.s.name, phone: r.s.phone })}>Log</Button>
                  {r.f.outstanding > 0 && S.allowed('fees', 'create', db) && <Button size="sm" onClick={() => setPay(r.s.id)}>Collect</Button>}
                </div>
              ) },
            ]} />
        )}
      </Card>
      <PaymentModal open={!!pay} onClose={() => setPay(null)} studentId={pay ?? undefined} />
    </>
  );
}

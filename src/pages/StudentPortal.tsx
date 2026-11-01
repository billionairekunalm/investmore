import { useEffect, useState, type ReactNode } from 'react';
import * as S from '../store/store';
import { loadPortal } from '../store/cloud';
import { TABLES, fromRow } from '../store/schema';
import { studentFinance } from '../domain/fees';
import type { Batch, Course, Enrolment, Instalment, Payment, Student } from '../domain/types';
import { daysBetween, fmtDate, fmtINR, fmtPhone, todayIST } from '../domain/util';
import { Badge, Button, Card, Empty, LogoMark, Wordmark, cx } from '../ui/kit';

type Portal = {
  student: Student; course?: Course; batch?: Batch; teacher?: string; instalments: Instalment[]; payments: Payment[];
  enrolments: Enrolment[]; attendance: { date: string; present: boolean }[]; certificates: { id: string; issued_at: string; status: string }[]; academy?: string;
};
const spec = (table: string) => TABLES.find((t) => t.table === table)!;
const conv = <T,>(table: string, row: unknown) => (row ? (fromRow(spec(table), row as Record<string, unknown>) as T) : undefined);

/** Dashboard for a signed-in student: only their own records (served by my_portal() in the database). */
export default function StudentPortal() {
  const [data, setData] = useState<Portal | null | 'missing'>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    setErr(null);
    loadPortal().then((p) => {
      if (!p) return setData('missing');
      setData({
        student: conv<Student>('students', p.student)!, course: conv<Course>('courses', p.course), batch: conv<Batch>('batches', p.batch),
        teacher: (p.teacher as string) ?? undefined,
        instalments: (p.instalments as unknown[]).map((r) => conv<Instalment>('instalments', r)!),
        payments: (p.payments as unknown[]).map((r) => conv<Payment>('payments', r)!),
        enrolments: (p.enrolments as unknown[]).map((r) => conv<Enrolment>('enrolments', r)!),
        attendance: p.attendance as Portal['attendance'], certificates: p.certificates as Portal['certificates'], academy: (p.academy as string) ?? undefined,
      });
    }).catch((e) => setErr((e as Error).message));
  };
  useEffect(load, []);

  const top = (
    <header className="bg-white border-b border-line">
      <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
        <LogoMark className="size-8" />
        <Wordmark name={data && data !== 'missing' && data.academy ? data.academy : 'InvestMore'} className="text-[14px]" />
        <span className="ml-1 rounded-full bg-accent-soft text-accent text-[11px] font-semibold px-2 py-0.5">Student</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => S.logout()}>Sign out</Button>
      </div>
    </header>
  );
  if (err) return <div className="min-h-full bg-surface">{top}<div className="max-w-4xl mx-auto p-4"><Card><Empty title="Couldn't load your details" body={err} action={<Button onClick={load}>Try again</Button>} /></Card></div></div>;
  if (data === null) return <div className="min-h-full bg-surface">{top}<p className="text-center text-muted py-16">Loading…</p></div>;
  if (data === 'missing') return <div className="min-h-full bg-surface">{top}<div className="max-w-4xl mx-auto p-4"><Card><Empty title="No student record found for this login" body="Please contact the academy office." /></Card></div></div>;

  const { student: s, course, batch } = data;
  const today = todayIST();
  const f = studentFinance(s, data.instalments, data.payments, today);
  const overdue = f.lines.filter((l) => l.status === 'Overdue').reduce((t, l) => t + l.remaining, 0);
  const reversed = new Set(data.payments.filter((p) => p.kind === 'reversal').map((p) => p.reversesId));
  const pays = data.payments.filter((p) => p.kind !== 'reversal');
  const present = data.attendance.filter((a) => a.present).length;
  const attPct = data.attendance.length ? Math.round((present / data.attendance.length) * 100) : null;
  const paidPct = f.total ? Math.min(100, Math.round((f.paid / f.total) * 100)) : 0;
  const cert = data.certificates.find((c) => c.status === 'Issued');
  const initials = s.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  return (
    <div className="min-h-full bg-surface pb-10">
      {top}
      <main className="max-w-4xl mx-auto px-4 pt-5 space-y-4">
        {/* who */}
        <Card className="overflow-hidden rounded-2xl">
          <div className="h-1.5 bg-gradient-to-r from-navy via-[#173563] to-accent" />
          <div className="p-5 flex items-center gap-4">
            {s.photo ? <img src={s.photo} alt="" className="size-16 rounded-full object-cover ring-4 ring-accent-soft" />
              : <span className="size-16 rounded-full bg-gradient-to-br from-navy to-[#2b5491] text-white grid place-items-center text-xl font-semibold">{initials}</span>}
            <div className="min-w-0">
              <h1 className="text-[20px] font-bold text-navy leading-tight">Hello, {s.name.split(' ')[0]}</h1>
              <p className="text-[13px] text-muted mt-0.5"><b className="text-ink tabular">{s.code}</b> · {course?.name ?? 'Course'} · <Badge>{s.status}</Badge></p>
            </div>
          </div>
          {/* fees at a glance */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border-t border-line">
            <Cell label="Total fee" value={fmtINR(f.total)} />
            <Cell label="Paid" value={<span className="text-accent">{fmtINR(f.paid)}</span>} foot={<span className="flex items-center gap-2"><span className="flex-1 max-w-24 h-1.5 rounded-full bg-zinc-200 overflow-hidden"><span className="block h-full bg-accent rounded-full" style={{ width: `${paidPct}%` }} /></span><b className="text-accent">{paidPct}%</b></span>} />
            <Cell label="Balance due" value={<span className={f.outstanding ? (overdue ? 'text-bad' : 'text-warn') : 'text-accent'}>{fmtINR(f.outstanding)}</span>} foot={overdue ? <span className="text-bad font-medium">{fmtINR(overdue)} overdue</span> : f.outstanding ? 'Nothing overdue' : 'Fully paid'} />
            <Cell label="Next payment" value={f.next ? fmtINR(f.next.remaining) : '—'} foot={f.next ? dueText(f.next.dueDate, today) : 'Nothing due'} />
          </div>
        </Card>

        <div className="grid md:grid-cols-5 gap-4">
          {/* schedule */}
          <Card className="md:col-span-3 rounded-2xl">
            <Head title="Fee schedule" />
            {!f.lines.length ? <Empty title="No fee plan yet" /> : (
              <ul className="divide-y divide-line">
                {f.lines.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={cx('size-2.5 rounded-full shrink-0', l.status === 'Paid' ? 'bg-accent' : l.status === 'Overdue' ? 'bg-bad' : l.status === 'Due Soon' || l.status === 'Partially Paid' ? 'bg-warn' : 'bg-zinc-300')} />
                    <div className="flex-1 min-w-0"><div className="font-medium">{l.label}</div><div className="text-[12px] text-muted">Due {fmtDate(l.dueDate)}{l.paid > 0 && l.remaining > 0 && ` · ${fmtINR(l.remaining)} left`}</div></div>
                    <div className="text-right"><div className="font-semibold tabular">{fmtINR(l.amount)}</div><Badge>{l.status}</Badge></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {/* batch */}
          <Card className="md:col-span-2 rounded-2xl">
            <Head title="My batch" />
            <dl className="px-4 pb-4 space-y-2.5 text-[13px]">
              <Row k="Course" v={course?.name ?? '—'} />
              <Row k="Batch" v={batch?.name ?? 'Not assigned yet'} />
              {batch && <><Row k="Days" v={batch.schedule} /><Row k="Time" v={batch.timing} /><Row k="Dates" v={`${fmtDate(batch.startDate)} – ${fmtDate(batch.endDate)}`} /></>}
              {data.teacher && <Row k="Teacher" v={data.teacher} />}
              <Row k="Attendance" v={attPct === null ? 'Not marked yet' : `${attPct}% (${present} of ${data.attendance.length})`} />
              <Row k="Certificate" v={cert ? `Issued ${fmtDate(cert.issued_at.slice(0, 10))}` : s.status === 'Completed' ? 'Coming soon' : 'After you complete the course'} />
              <Row k="Mobile on file" v={fmtPhone(s.phone)} />
            </dl>
          </Card>
        </div>

        {/* payments */}
        <Card className="rounded-2xl">
          <Head title="My payments" />
          {!pays.length ? <Empty title="No payments yet" /> : (
            <ul className="divide-y divide-line">
              {pays.map((p) => {
                const st = p.kind === 'refund' ? 'Refund' : reversed.has(p.id) ? 'Cancelled' : p.verified ? 'Received' : 'Being confirmed';
                return (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0"><div className="font-medium">{fmtDate(p.date)} · {p.method}</div><div className="text-[12px] text-muted">{p.receiptNo ? `Receipt ${p.receiptNo}` : p.kind === 'refund' ? 'Refund' : ''}</div></div>
                    <div className="text-right"><div className={cx('font-semibold tabular', st === 'Cancelled' && 'line-through text-muted')}>{p.kind === 'refund' ? '−' : ''}{fmtINR(p.amount)}</div>
                      <Badge tone={st === 'Received' ? 'green' : st === 'Being confirmed' ? 'orange' : st === 'Refund' ? 'blue' : 'gray'}>{st}</Badge></div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <p className="text-center text-[12px] text-muted">Questions about your fees? Contact the academy office.</p>
      </main>
    </div>
  );
}

const dueText = (d: string, today: string) => { const n = daysBetween(today, d); return n < 0 ? <span className="text-bad font-medium">{fmtDate(d)} · {-n} days late</span> : n === 0 ? <span className="text-warn font-medium">Due today</span> : `${fmtDate(d)} · in ${n} days`; };
const Head = ({ title }: { title: string }) => <h2 className="px-4 pt-4 pb-2 font-semibold text-[15px] text-navy">{title}</h2>;
const Row = ({ k, v }: { k: string; v: ReactNode }) => <div className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="font-medium text-right">{v}</dd></div>;
function Cell({ label, value, foot }: { label: string; value: ReactNode; foot?: ReactNode }) {
  return (
    <div className="bg-surface px-4 py-3.5 min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-[19px] font-bold tabular text-navy leading-tight">{value}</div>
      {foot && <div className="mt-1 text-[11.5px] text-muted">{foot}</div>}
    </div>
  );
}

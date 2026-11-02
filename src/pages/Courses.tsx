import { useEffect, useState } from 'react';
import * as S from '../store/store';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Textarea, cx, useRun, useUI } from '../ui/kit';
import { effectivePayments } from '../domain/fees';
import type { Course, CourseStatus, Share } from '../domain/types';
import { fmtDate, fmtINR, parseRupees } from '../domain/util';

const STATUS: { value: CourseStatus; label: string; tone: string }[] = [
  { value: 'upcoming', label: 'Upcoming', tone: 'blue' }, { value: 'active', label: 'Active', tone: 'green' }, { value: 'closed', label: 'Closed', tone: 'gray' },
];
const statusOf = (c: Course) => STATUS.find((s) => s.value === (c.status ?? 'active'))!;
const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;

/** Courses the academy runs or will launch: fees, duration and how the founders split each course's fees. */
export default function Courses() {
  const db = S.useDB();
  const can = S.allowed('settings', 'edit', db);
  const [edit, setEdit] = useState<string | 'new' | null>(null);
  const order = { upcoming: 0, active: 1, closed: 2 } as const;
  const courses = [...db.courses].sort((a, b) => order[a.status ?? 'active'] - order[b.status ?? 'active'] || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="Courses" sub="Fees, duration and founder split for every course" actions={can && <Button variant="primary" onClick={() => setEdit('new')}>+ Add course</Button>} />
      {!courses.length ? <Card><Empty title="No courses yet" /></Card> : (
        <div className="grid lg:grid-cols-2 gap-4">
          {courses.map((c) => <CourseCard key={c.id} c={c} onEdit={can ? () => setEdit(c.id) : undefined} />)}
        </div>
      )}
      <CourseForm id={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function CourseCard({ c, onEdit }: { c: Course; onEdit?: () => void }) {
  const db = S.useDB();
  const st = statusOf(c);
  const studentIds = new Set(db.students.filter((s) => s.courseId === c.id).map((s) => s.id));
  const active = db.students.filter((s) => s.courseId === c.id && s.status === 'Active').length;
  const collected = effectivePayments(db.payments.filter((p) => studentIds.has(p.studentId))).reduce((t, p) => t + p.amount, 0);
  const fee = S.courseFee(c); // booking included
  const shares = c.shares ?? db.settings.shares;
  return (
    <Card className="rounded-2xl overflow-hidden flex flex-col">
      <div className="h-1.5 bg-gradient-to-r from-navy via-[#173563] to-accent" />
      <div className="p-5 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap"><h2 className="font-bold text-[17px] text-navy">{c.name}</h2><Badge tone={st.tone}>{st.label}</Badge></div>
            {c.description && <p className="text-[13px] text-muted mt-1">{c.description}</p>}
          </div>
          {onEdit && <Button size="sm" onClick={onEdit}>Edit</Button>}
        </div>
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Fact k="Course fee" v={fmtINR(fee)} />
          <Fact k="Booking (in fee)" v={fmtINR(c.bookingDefault)} />
          <Fact k="Duration" v={`${c.durationWeeks} weeks`} />
          <Fact k={c.status === 'upcoming' ? 'Launches' : 'Students'} v={c.status === 'upcoming' ? (c.launchDate ? fmtDate(c.launchDate) : 'Date not set') : `${active} active`} />
        </dl>
        <div className="mt-3 text-[12.5px] text-muted">{fmtINR(c.bookingDefault)} booking + {c.instalments.map((x) => fmtINR(x)).join(' + ')} = <b className="text-ink">{fmtINR(fee)}</b></div>
        <div className="mt-4 rounded-xl border border-line bg-surface/70 p-3">
          <div className="flex items-center justify-between text-[12px]"><span className="font-semibold uppercase tracking-wider text-zinc-500">Founder split</span><span className="text-muted">Collected so far <b className="text-ink tabular">{fmtINR(collected)}</b></span></div>
          <ul className="mt-2 space-y-1.5">
            {shares.map((s) => (
              <li key={s.name} className="flex items-center gap-2 text-[13px]">
                <span className="flex-1 font-medium">{s.name}</span>
                <span className="w-24 h-1.5 rounded-full bg-zinc-200 overflow-hidden"><span className="block h-full bg-accent rounded-full" style={{ width: `${s.pctBp / 100}%` }} /></span>
                <span className="w-14 text-right tabular text-zinc-600">{pct(s.pctBp)}</span>
                <span className="w-24 text-right tabular font-semibold">{fmtINR(Math.floor((collected * s.pctBp) / 10000))}</span>
              </li>
            ))}
          </ul>
          {!c.shares && <p className="mt-2 text-[11.5px] text-muted">Using the default split from Settings.</p>}
        </div>
      </div>
    </Card>
  );
}
const Fact = ({ k, v }: { k: string; v: string }) => <div><dt className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">{k}</dt><dd className="font-semibold text-zinc-800 tabular">{v}</dd></div>;

type ShareRow = { name: string; pct: string };
function CourseForm({ id, onClose }: { id: string | 'new' | null; onClose: () => void }) {
  const db = S.useDB();
  const run = useRun();
  const { ask } = useUI();
  const c = id && id !== 'new' ? db.courses.find((x) => x.id === id) : undefined;
  const toRows = (sh: Share[]) => sh.map((s) => ({ name: s.name, pct: String(s.pctBp / 100) }));
  const [f, setF] = useState({ name: '', description: '', status: 'upcoming' as CourseStatus, launchDate: '', weeks: '8', booking: '1000', fee: '8500' });
  const [inst, setInst] = useState<string[]>(['3000', '3000', '1500']);
  const [rows, setRows] = useState<ShareRow[]>([]);
  useEffect(() => {
    if (!id) return;
    setF(c ? { name: c.name, description: c.description ?? '', status: c.status ?? 'active', launchDate: c.launchDate ?? '', weeks: String(c.durationWeeks), booking: String(c.bookingDefault / 100), fee: String(S.courseFee(c) / 100) }
      : { name: '', description: '', status: 'upcoming', launchDate: '', weeks: '8', booking: '1000', fee: '8500' });
    setInst(c ? c.instalments.map((x) => String(x / 100)) : ['3000', '3000', '1500']);
    setRows(toRows(c?.shares ?? db.settings.shares));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const instP = inst.map(parseRupees), booking = parseRupees(f.booking), fee = parseRupees(f.fee);
  const instSum = instP.every((x) => x !== null) ? instP.reduce((t, x) => t! + x!, 0)! : null;
  const rest = fee !== null && booking !== null ? fee - booking : null; // what the instalments must add up to
  const matches = rest !== null && instSum === rest;
  // changing the fee or booking: the last instalment takes up the difference
  const setMoney = (k: 'fee' | 'booking') => (e: { target: { value: string } }) => {
    const next = { ...f, [k]: e.target.value };
    const fe = parseRupees(next.fee), bk = parseRupees(next.booking), others = inst.slice(0, -1).map(parseRupees);
    if (fe !== null && bk !== null && others.every((x) => x !== null)) {
      const last = fe - bk - others.reduce((t, x) => t! + x!, 0)!;
      if (last > 0) setInst([...inst.slice(0, -1), String(last / 100)]);
    }
    setF(next);
  };
  const totalBp = rows.reduce((t, r) => t + Math.round((parseFloat(r.pct) || 0) * 100), 0);
  const ok = !!f.name.trim() && booking !== null && fee !== null && fee > 0 && booking <= fee && matches && instP.every((x) => x !== null && x > 0) && +f.weeks >= 1 && rows.length > 0 && totalBp === 10000 && rows.every((r) => r.name.trim());
  const save = () => {
    let done = false;
    run(() => {
      S.saveCourse({
        id: c?.id, name: f.name, description: f.description.trim() || undefined, status: f.status, launchDate: f.launchDate || undefined,
        durationWeeks: Math.round(+f.weeks), bookingDefault: booking!, instalments: instP as number[],
        shares: rows.map((r) => ({ name: r.name.trim(), pctBp: Math.round((parseFloat(r.pct) || 0) * 100) })),
      });
      done = true;
    }, c ? 'Course saved' : 'Course added');
    if (done) onClose();
  };
  const remove = async () => {
    if (!c || !(await ask({ title: `Delete ${c.name}?`, message: 'Only possible when no students or batches use it.', confirm: 'Delete', danger: true }))) return;
    let done = false; run(() => { S.deleteCourse(c.id); done = true; }, 'Course deleted'); if (done) onClose();
  };

  return (
    <Modal open={!!id} onClose={onClose} wide title={c ? `Edit ${c.name}` : 'Add course'}
      footer={<>
        {c && <Button variant="danger" className="mr-auto" onClick={remove}>Delete</Button>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ok} onClick={save}>{c ? 'Save course' : 'Add course'}</Button>
      </>}>
      <div className="space-y-6">
        <section className="grid sm:grid-cols-2 gap-x-4 gap-y-3.5">
          <Field label="Course name" required className="sm:col-span-2"><Input autoFocus value={f.name} onChange={set('name')} /></Field>
          <Field label="Short description" className="sm:col-span-2"><Textarea value={f.description} onChange={set('description')} className="min-h-16" /></Field>
          <Field label="Status"><Select value={f.status} onChange={set('status')} options={STATUS.map((s) => ({ value: s.value, label: s.label }))} /></Field>
          <Field label="Launch date"><Input type="date" value={f.launchDate} onChange={set('launchDate')} /></Field>
          <Field label="Duration (weeks)" required error={f.weeks && +f.weeks < 1 ? 'At least 1 week' : undefined}><Input type="number" min={1} inputMode="numeric" value={f.weeks} onChange={set('weeks')} /></Field>
        </section>

        <section>
          <h3 className="font-semibold text-[14px] mb-2">Fees</h3>
          <div className="grid sm:grid-cols-3 gap-x-4 gap-y-3.5">
            <Field label="Course fee (₹)" hint="Full fee, booking included" error={fee === null || fee <= 0 ? 'Enter the course fee' : undefined}><Input inputMode="decimal" value={f.fee} onChange={setMoney('fee')} /></Field>
            <Field label="Booking / advance (₹)" hint="Taken first, part of the fee" error={booking === null ? 'Enter an amount' : fee !== null && booking > fee ? 'More than the course fee' : undefined}><Input inputMode="decimal" value={f.booking} onChange={setMoney('booking')} /></Field>
            <div className="hidden sm:block" />
            {inst.map((v, i) => (
              <Field key={i} label={`Instalment ${i + 1} (₹)`} error={instP[i] === null || (instP[i] ?? 0) <= 0 ? 'Enter an amount' : undefined}>
                <Input inputMode="decimal" value={v} onChange={(e) => setInst(inst.map((x, j) => (j === i ? e.target.value : x)))} />
              </Field>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setInst([...inst, '1000'])}>+ Instalment</Button>
            {inst.length > 1 && <Button size="sm" variant="ghost" onClick={() => setInst(inst.slice(0, -1))}>Remove last</Button>}
            <span className={cx('ml-auto text-[13px]', rest !== null && instSum !== null && !matches && 'text-bad')}>
              {booking !== null ? fmtINR(booking) : '—'} booking + {instSum !== null ? fmtINR(instSum) : '—'} instalments = <b className="tabular">{booking !== null && instSum !== null ? fmtINR(booking + instSum) : '—'}</b>
              {rest !== null && instSum !== null && !matches && <span className="block text-right text-[12px]">Instalments must add up to {fmtINR(rest)} (course fee − booking)</span>}
            </span>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="font-semibold text-[14px]">Founder split</h3>
            <button type="button" className="text-[12.5px] font-medium text-navy hover:underline" onClick={() => setRows(toRows(db.settings.shares))}>Use default split</button>
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input aria-label="Founder name" value={r.name} placeholder="Name" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <div className="relative w-28 shrink-0">
                  <Input aria-label="Share %" inputMode="decimal" value={r.pct} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} className="w-28 pr-7 text-right" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span>
                </div>
                {rows.length > 1 && <Button size="sm" variant="ghost" aria-label="Remove founder" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</Button>}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <Button size="sm" onClick={() => setRows([...rows, { name: '', pct: '0' }])}>+ Founder</Button>
            <span className={cx('text-[13px] font-semibold tabular', totalBp === 10000 ? 'text-accent' : 'text-bad')}>Total {pct(totalBp)}{totalBp !== 10000 && ' — must be 100%'}</span>
          </div>
        </section>
      </div>
    </Modal>
  );
}

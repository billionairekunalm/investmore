import { useEffect, useState } from 'react';
import * as S from '../store/store';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Table, Tabs, cx, useRun } from '../ui/kit';
import { financeFor } from '../domain/finance';
import type { Batch, BatchStatus } from '../domain/types';
import { fmtDate, fmtINR, fmtTime, nowIST, todayIST, addDays } from '../domain/util';
import { BatchAttendance, BatchHistory, BatchStudents, ClassCalendar, ClassModal, batchColor, classLabel, classesOf, defaultClass, roster, stateOf } from './BatchClasses';

export default function Batches() {
  const db = S.useDB();
  const me = S.useMe()!;
  const [edit, setEdit] = useState<Partial<Batch> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [calendar, setCalendar] = useState(false);
  // list or cards; remembered on this device
  const [view, setViewState] = useState<'list' | 'cards'>(() => { try { return localStorage.getItem('batchesView') === 'cards' ? 'cards' : 'list'; } catch { return 'list'; } });
  const setView = (v: 'list' | 'cards') => { setViewState(v); try { localStorage.setItem('batchesView', v); } catch { /* */ } };
  const mine = me.role === 'teacher' ? db.batches.filter((b) => b.teacherId === me.id) : db.batches;
  const enrolled = (id: string) => db.students.filter((s) => s.batchId === id && s.status === 'Active').length;
  // grouped by course; inside a course: running, upcoming, completed, cancelled — newest start first
  const [courseF, setCourseF] = useState('');
  const [showPast, setShowPast] = useState(false);
  const RANK: Record<BatchStatus, number> = { running: 0, upcoming: 1, completed: 2, cancelled: 3 };
  const sorted = [...mine].sort((a, b) => RANK[a.status] - RANK[b.status] || b.startDate.localeCompare(a.startDate));
  const past = (b: Batch) => b.status === 'completed' || b.status === 'cancelled';
  const batches = sorted.filter((b) => (!courseF || b.courseId === courseF) && (showPast || !past(b)));
  const pastCount = sorted.filter((b) => (!courseF || b.courseId === courseF) && past(b)).length;
  const courseIds = [...new Set(mine.map((b) => b.courseId))].sort((a, b) => (db.courses.find((c) => c.id === a)?.name ?? '').localeCompare(db.courses.find((c) => c.id === b)?.name ?? ''));
  const groups = courseIds.map((cid) => ({ cid, name: db.courses.find((c) => c.id === cid)?.name ?? 'Other', list: batches.filter((b) => b.courseId === cid) })).filter((g) => g.list.length);
  if (open && db.batches.some((b) => b.id === open)) return <><BatchDetail id={open} onBack={() => setOpen(null)} onEdit={() => setEdit(db.batches.find((b) => b.id === open)!)} /><BatchModal batch={edit} onClose={() => setEdit(null)} /></>;
  if (calendar) return (
    <>
      <button onClick={() => setCalendar(false)} className="text-muted hover:text-ink mb-2">← All batches</button>
      <PageHeader title="Class calendar" sub="All batches · click a day to schedule a class, click a class to see or change it" />
      <ClassCalendar />
    </>
  );
  return (
    <>
      <PageHeader title="Batches" sub={me.role === 'teacher' ? 'Batches assigned to you' : undefined} actions={<><Button onClick={() => setCalendar(true)}>📅 Calendar</Button>{S.allowed('batches', 'create', db) && <Button variant="primary" onClick={() => setEdit({ status: 'upcoming', capacity: 30, courseId: db.courses[0]?.id, startDate: todayIST(), endDate: addDays(todayIST(), 56), schedule: 'Mon–Fri', timing: '10:00–12:00' })}>+ New batch</Button>}</>} />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {[['', 'All courses', mine.length] as const, ...courseIds.map((cid) => [cid, db.courses.find((c) => c.id === cid)?.name ?? 'Other', mine.filter((b) => b.courseId === cid).length] as const)].map(([v, l, n]) => (
            <button key={v || 'all'} onClick={() => setCourseF(v)} aria-pressed={courseF === v}
              className={cx('h-8 px-3 rounded-full border text-[13px] font-medium transition-colors', courseF === v ? 'bg-navy border-navy text-white' : 'bg-white border-line text-zinc-600 hover:border-navy/40 hover:text-navy')}>
              {l} <span className={cx('tabular', courseF === v ? 'text-white/70' : 'text-zinc-400')}>{n}</span>
            </button>
          ))}
        </div>
        {pastCount > 0 && <label className="ml-1 inline-flex items-center gap-1.5 text-[12.5px] text-zinc-600 cursor-pointer"><input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />Show completed ({pastCount})</label>}
        <span className="flex-1" />
        <div role="group" aria-label="View" className="flex p-0.5 rounded-lg bg-zinc-100/80 border border-line">
          {([['list', 'List', 'M2 4h12M2 8h12M2 12h12'], ['cards', 'Cards', 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z']] as const).map(([v, l, d]) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={cx('inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12.5px] font-medium transition-colors', view === v ? 'bg-white text-navy shadow-sm' : 'text-zinc-500 hover:text-navy')}>
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden><path d={d} /></svg>{l}
            </button>
          ))}
        </div>
      </div>
      {!groups.length ? <Card><Empty title={mine.length ? 'No running or upcoming batches' : 'No batches yet'} body={mine.length ? 'Tick "Show completed" to see finished batches.' : 'Create a batch to assign students and track attendance.'} /></Card> : (
        <div className="space-y-6">
          {groups.map((g) => {
            const students = g.list.reduce((t, b) => t + enrolled(b.id), 0);
            return (
              <section key={g.cid}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2.5 pb-2 border-b border-line">
                  <h2 className="text-[16px] font-bold text-navy">{g.name}</h2>
                  <span className="text-[12.5px] text-muted">{g.list.length} batch{g.list.length === 1 ? '' : 'es'} · {students} student{students === 1 ? '' : 's'}
                    {g.list.some((b) => b.status === 'running') && <> · <b className="text-emerald-700 font-semibold">{g.list.filter((b) => b.status === 'running').length} running</b></>}</span>
                </div>
                {view === 'cards' ? (
                  <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {g.list.map((b) => <BatchCard key={b.id} b={b} enrolled={enrolled(b.id)} onOpen={() => setOpen(b.id)} />)}
                  </div>
                ) : (
                  <Card>
                    <Table rows={g.list} rowKey={(b) => b.id} onRow={(b) => setOpen(b.id)} cols={[
                      { key: 'n', label: 'Batch', render: (b) => <span className="font-medium">{b.name}</span>, sort: (b) => b.name },
                      { key: 'tm', label: 'Timing', render: (b) => `${b.schedule} · ${b.timing}` },
                      { key: 't', label: 'Teacher', render: (b) => S.empName(b.teacherId, db) },
                      { key: 'd', label: 'Dates', render: (b) => `${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}`, sort: (b) => b.startDate },
                      { key: 'e', label: 'Students', className: 'text-right', render: (b) => { const n = enrolled(b.id); return <span className={cx('tabular', n >= b.capacity && 'text-bad font-medium')}>{n}/{b.capacity}</span>; } },
                      { key: 's', label: 'Status', render: (b) => <Badge>{b.status}</Badge> },
                    ]} />
                  </Card>
                )}
              </section>
            );
          })}
        </div>
      )}
      <BatchModal batch={edit} onClose={() => setEdit(null)} />
    </>
  );
}

const STATUS_TONE: Record<BatchStatus, string> = { upcoming: '#1d4ed8', running: '#047857', completed: '#52525b', cancelled: '#b91c1c' };

/** One batch as a card: course, teacher, timing, dates and how full it is. Click opens the batch. */
function BatchCard({ b, enrolled, onOpen }: { b: Batch; enrolled: number; onOpen: () => void }) {
  const db = S.useDB();
  const tone = STATUS_TONE[b.status] ?? '#52525b';
  const full = Math.min(100, Math.round((enrolled / Math.max(1, b.capacity)) * 100));
  return (
    <button type="button" onClick={onOpen} className="text-left rounded-2xl border border-line bg-white overflow-hidden shadow-[0_1px_3px_rgba(15,35,65,.06)] hover:shadow-[0_6px_18px_-8px_rgba(15,35,65,.3)] hover:border-navy/25 transition-all">
      <div className="h-1.5" style={{ background: tone }} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold text-[16px] text-navy truncate">{b.name}</div>
            <div className="text-[12.5px] text-muted truncate">{db.courses.find((c) => c.id === b.courseId)?.name ?? '—'}</div>
          </div>
          <Badge>{b.status}</Badge>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
          <div><dt className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">Timing</dt><dd className="font-medium text-zinc-800">{b.timing || '—'}</dd></div>
          <div><dt className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">Days</dt><dd className="font-medium text-zinc-800">{b.schedule || '—'}</dd></div>
          <div><dt className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">Teacher</dt><dd className="font-medium text-zinc-800 truncate">{S.empName(b.teacherId, db)}</dd></div>
          <div><dt className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">Dates</dt><dd className="font-medium text-zinc-800 tabular">{fmtDate(b.startDate)} – {fmtDate(b.endDate)}</dd></div>
        </dl>
        <div className="mt-3 pt-3 border-t border-line">
          <div className="flex items-center justify-between text-[12.5px]"><span className="text-muted">Students</span><b className={cx('tabular', enrolled >= b.capacity ? 'text-bad' : 'text-navy')}>{enrolled}/{b.capacity}</b></div>
          <div className="mt-1.5 h-1.5 rounded-full bg-zinc-100 overflow-hidden"><div className={cx('h-full rounded-full', enrolled >= b.capacity ? 'bg-bad' : 'bg-accent')} style={{ width: `${full}%` }} /></div>
        </div>
      </div>
    </button>
  );
}

function BatchModal({ batch, onClose }: { batch: Partial<Batch> | null; onClose: () => void }) {
  const db = S.useDB();
  const run = useRun();
  const [b, setB] = useState<Partial<Batch>>({});
  useEffect(() => { if (batch) setB(batch); }, [batch]);
  const set = (k: keyof Batch) => (e: { target: { value: string } }) => setB({ ...b, [k]: k === 'capacity' ? +e.target.value : e.target.value });
  const teachers = db.employees.filter((e) => e.active && (e.role === 'teacher' || e.role === 'admin' || e.role === 'super_admin'));
  return (
    <Modal open={!!batch} onClose={onClose} title={b.id ? `Edit ${b.name}` : 'New batch'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!b.name || !b.courseId} onClick={() => { let ok = false; run(() => { S.saveBatch(b as Batch); ok = true; }, 'Batch saved'); if (ok) onClose(); }}>Save</Button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Batch name" required className="sm:col-span-2"><Input value={b.name ?? ''} onChange={set('name')} placeholder="e.g. Nov Morning Batch" /></Field>
        <Field label="Course" required><Select value={b.courseId ?? ''} onChange={set('courseId')} options={db.courses.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Teacher"><Select value={b.teacherId ?? ''} onChange={set('teacherId')} placeholder="Unassigned" options={teachers.map((t) => ({ value: t.id, label: t.name }))} /></Field>
        <Field label="Start date"><Input type="date" value={b.startDate ?? ''} onChange={set('startDate')} /></Field>
        <Field label="End date"><Input type="date" value={b.endDate ?? ''} onChange={set('endDate')} /></Field>
        <Field label="Days"><Input value={b.schedule ?? ''} onChange={set('schedule')} placeholder="Mon–Fri / Sat–Sun" /></Field>
        <Field label="Class timing"><Input value={b.timing ?? ''} onChange={set('timing')} placeholder="10:00–12:00" /></Field>
        <Field label="Capacity"><Input type="number" min={1} value={b.capacity ?? 30} onChange={set('capacity')} /></Field>
        <Field label="Status"><Select value={b.status ?? 'upcoming'} onChange={(e) => setB({ ...b, status: e.target.value as BatchStatus })} options={['upcoming', 'running', 'completed', 'cancelled']} /></Field>
      </div>
    </Modal>
  );
}

type DTab = 'overview' | 'students' | 'calendar' | 'attendance' | 'history';
/** Batch dashboard: overview, students (coloured by attendance), calendar, attendance (with classroom QR) and history. */
function BatchDetail({ id, onBack, onEdit }: { id: string; onBack: () => void; onEdit: () => void }) {
  const db = S.useDB();
  const b = db.batches.find((x) => x.id === id)!;
  const [tab, setTab] = useState<DTab>('overview');
  const [schedule, setSchedule] = useState(false);
  const [openClass, setOpenClass] = useState<string | null>(null);
  const list = classesOf(db, id), now = nowIST();
  const [classId, setClassId] = useState<string | undefined>(() => defaultClass(list)?.id);
  useEffect(() => { if (!classId || !list.some((c) => c.id === classId)) setClassId(defaultClass(list)?.id); }, [list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const students = db.students.filter((s) => s.batchId === id && s.status !== 'Dropped' && s.status !== 'Refunded');
  const live = list.filter((c) => c.status === 'scheduled');
  const upcoming = live.filter((c) => `${c.date}T${c.endTime}` > now);
  const held = live.filter((c) => `${c.date}T${c.startTime}` <= now);
  const latest = held[held.length - 1];
  const lat = latest ? roster(db, latest).map((s) => stateOf(latest, db.marks.find((m) => m.id === `${latest.id}:${s.id}`), now)) : [];
  let pres = 0, slots = 0;
  for (const c of held) { const r = roster(db, c); slots += r.length; pres += db.marks.filter((m) => m.classId === c.id && m.status === 'present').length; }
  const fees = S.allowed('fees', 'view', db);
  const fin = students.map((s) => financeFor(db, s.id, todayIST()));
  const color = batchColor(db, id);
  const goAttendance = (cid: string) => { setClassId(cid); setTab('attendance'); };

  return (
    <>
      <button onClick={onBack} className="text-muted hover:text-ink mb-2">← All batches</button>
      <Card className="rounded-2xl overflow-hidden mb-4">
        <div className="h-1.5" style={{ background: color }} />
        <div className="p-4 sm:p-5 flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap"><h1 className="text-[22px] font-bold tracking-tight text-navy">{b.name}</h1><Badge>{b.status}</Badge></div>
            <p className="text-[13px] text-muted mt-0.5">{db.courses.find((c) => c.id === b.courseId)?.name} · {S.empName(b.teacherId, db)} · {b.schedule} {b.timing} · {fmtDate(b.startDate)} – {fmtDate(b.endDate)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {S.allowed('batches', 'create', db) && <Button variant="primary" onClick={() => setSchedule(true)}>+ Schedule class</Button>}
            {S.allowed('batches', 'edit', db) && <Button onClick={onEdit}>Edit batch</Button>}
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-line border-t border-line">
          <Tile label="Students" value={`${students.filter((s) => s.status === 'Active').length}/${b.capacity}`} />
          <Tile label="Classes scheduled" value={live.length} foot={`${held.length} held`} />
          <Tile label="Next class" value={upcoming[0] ? fmtTime(upcoming[0].startTime) : '—'} foot={upcoming[0] ? fmtDate(upcoming[0].date) : 'None scheduled'} onClick={upcoming[0] ? () => setOpenClass(upcoming[0].id) : undefined} />
          <Tile label="Latest class" value={latest ? <><span className="text-emerald-600">{lat.filter((x) => x === 'present').length}</span> / <span className="text-red-600">{lat.filter((x) => x === 'absent').length}</span></> : '—'} foot={latest ? `present / absent · ${fmtDate(latest.date)}` : 'No class held yet'} onClick={latest ? () => goAttendance(latest.id) : undefined} />
          <Tile label="Overall attendance" value={slots ? `${Math.round((pres / slots) * 100)}%` : '—'} foot={fees ? `Fees due ${fmtINR(fin.reduce((a, f) => a + f.outstanding, 0))}` : undefined} />
        </div>
      </Card>

      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'students', label: 'Students', count: students.length }, { id: 'calendar', label: 'Calendar' }, { id: 'attendance', label: 'Attendance' }, { id: 'history', label: 'Attendance history' }]} />
      {tab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="rounded-2xl">
            <div className="px-4 pt-4 pb-2 font-semibold text-navy">Upcoming classes</div>
            {!upcoming.length ? <Empty title="No upcoming classes" action={S.allowed('batches', 'create', db) ? <Button onClick={() => setSchedule(true)}>+ Schedule class</Button> : undefined} /> : (
              <ul className="divide-y divide-line">{upcoming.slice(0, 6).map((c) => (
                <li key={c.id}><button onClick={() => setOpenClass(c.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface"><span className="size-2.5 rounded-full" style={{ background: color }} /><span className="flex-1 font-medium">{classLabel(c)}</span>{c.notes && <span className="text-[12px] text-muted truncate max-w-40">{c.notes}</span>}</button></li>
              ))}</ul>
            )}
          </Card>
          <Card className="rounded-2xl">
            <div className="px-4 pt-4 pb-2 font-semibold text-navy">Recent classes</div>
            {!held.length ? <Empty title="No classes held yet" /> : (
              <ul className="divide-y divide-line">{[...held].reverse().slice(0, 6).map((c) => {
                const r = roster(db, c), p = db.marks.filter((m) => m.classId === c.id && m.status === 'present').length;
                return <li key={c.id}><button onClick={() => goAttendance(c.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface"><span className="flex-1 font-medium">{classLabel(c)}</span><span className="text-[12.5px] tabular text-zinc-600">{p}/{r.length} present</span></button></li>;
              })}</ul>
            )}
          </Card>
        </div>
      )}
      {tab === 'students' && <BatchStudents batch={b} classId={classId} setClassId={setClassId} />}
      {tab === 'calendar' && <ClassCalendar batchId={id} />}
      {tab === 'attendance' && <BatchAttendance batch={b} classId={classId} setClassId={setClassId} />}
      {tab === 'history' && <BatchHistory batch={b} />}
      <ClassModal open={schedule} batchId={id} onClose={() => setSchedule(false)} />
      <ClassModal open={!!openClass} classId={openClass ?? undefined} batchId={id} onClose={() => setOpenClass(null)} onAttendance={goAttendance} />
    </>
  );
}
const Tile = ({ label, value, foot, onClick }: { label: string; value: React.ReactNode; foot?: string; onClick?: () => void }) => (
  <button type="button" disabled={!onClick} onClick={onClick} className={cx('bg-white px-4 py-3 text-left min-w-0', onClick && 'hover:bg-surface')}>
    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
    <div className="mt-0.5 text-[20px] font-bold tabular text-navy leading-tight">{value}</div>
    {foot && <div className="mt-0.5 text-[11.5px] text-muted truncate">{foot}</div>}
  </button>
);

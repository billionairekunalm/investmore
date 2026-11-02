import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as S from '../store/store';
import { Badge, Button, Card, Empty, Field, Input, Modal, SearchInput, Select, Textarea, cx, useRun, useUI } from '../ui/kit';
import { cloudEnabled, sb } from '../store/cloud';
import { downloadCSV, printTable } from '../lib/export';
import type { Batch, ClassMark, ClassSession, DB, ISODate, Student } from '../domain/types';
import { addDays, batchTimes, fmtDate, fmtDateTime, fmtPhone, fmtTime, minutesOf, nowIST, timeOf, todayIST } from '../domain/util';

/* -------------------------------------------------------------------------------------------------
 * Class schedule (calendar) and per-class attendance for batches.
 * A student's state in a class: present / absent (marked absent, or the class ended without them) / not marked yet.
 * ------------------------------------------------------------------------------------------------- */

export const PALETTE = ['#1d4ed8', '#047857', '#7c3aed', '#c2410c', '#0f766e', '#be185d', '#4d7c0f', '#0369a1', '#a16207', '#9333ea'];
export const batchColor = (db: DB, batchId: string) => PALETTE[Math.max(0, db.batches.findIndex((b) => b.id === batchId)) % PALETTE.length];
const startOf = (c: ClassSession) => `${c.date}T${c.startTime}`;
const endOf = (c: ClassSession) => `${c.date}T${c.endTime}`;
export const classesOf = (db: DB, batchId?: string) => db.classes.filter((c) => !batchId || c.batchId === batchId).sort((a, b) => startOf(a).localeCompare(startOf(b)));
/** students a class is for: the batch's current students, plus anyone already marked in it */
export function roster(db: DB, c: ClassSession): Student[] {
  const marked = new Set(db.marks.filter((m) => m.classId === c.id).map((m) => m.studentId));
  return db.students.filter((s) => marked.has(s.id) || (s.batchId === c.batchId && s.status !== 'Dropped' && s.status !== 'Refunded'))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export type AttState = 'present' | 'absent' | 'none';
export const stateOf = (c: ClassSession, m: ClassMark | undefined, now = nowIST()): AttState =>
  m ? m.status : c.status === 'scheduled' && endOf(c) <= now ? 'absent' : 'none';
const markOf = (db: DB, classId: string, studentId: string) => db.marks.find((m) => m.id === `${classId}:${studentId}`);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const dayName = (d: ISODate, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { ...opts, timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const durLabel = (c: { startTime: string; endTime: string }) => { const m = minutesOf(c.endTime) - minutesOf(c.startTime); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`; };
export const classLabel = (c: ClassSession) => `${dayName(c.date, { weekday: 'short', day: '2-digit', month: 'short' })} · ${fmtTime(c.startTime)}–${fmtTime(c.endTime)}`;

/** The class to show by default: one running now, else the latest that has started, else the next one. */
export function defaultClass(list: ClassSession[], now = nowIST()) {
  const live = list.filter((c) => c.status === 'scheduled');
  return live.find((c) => startOf(c) <= now && endOf(c) > now) ?? [...live].reverse().find((c) => startOf(c) <= now) ?? live.find((c) => startOf(c) > now) ?? list[list.length - 1];
}

/* ===================================== calendar ===================================== */
type View = 'month' | 'week' | 'day';
const mondayOf = (d: ISODate) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

export function ClassCalendar({ batchId }: { batchId?: string }) {
  const db = S.useDB();
  const canAdd = S.allowed('batches', 'create', db);
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(todayIST());
  const [modal, setModal] = useState<{ id?: string; date?: ISODate } | null>(null);
  const today = todayIST();
  const list = classesOf(db, batchId);
  const onDay = (d: ISODate) => list.filter((c) => c.date === d);
  const step = (n: number) => setCursor(view === 'month' ? (() => { const [y, m] = cursor.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1 + n, 1)); return dt.toISOString().slice(0, 10); })() : addDays(cursor, n * (view === 'week' ? 7 : 1)));
  const title = view === 'month' ? dayName(cursor, { month: 'long', year: 'numeric' })
    : view === 'week' ? `${dayName(mondayOf(cursor), { day: '2-digit', month: 'short' })} – ${dayName(addDays(mondayOf(cursor), 6), { day: '2-digit', month: 'short', year: 'numeric' })}`
      : dayName(cursor, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const add = (date: ISODate) => canAdd && setModal({ date });
  const usedBatches = [...new Set(list.map((c) => c.batchId))];

  return (
    <Card className="rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Previous" onClick={() => step(-1)}>‹</Button>
          <Button size="sm" onClick={() => setCursor(today)}>Today</Button>
          <Button size="sm" variant="ghost" aria-label="Next" onClick={() => step(1)}>›</Button>
        </div>
        <h3 className="font-semibold text-navy text-[15px] mr-auto">{title}</h3>
        <div role="group" aria-label="Calendar view" className="flex p-0.5 rounded-lg bg-zinc-100/80 border border-line">
          {(['month', 'week', 'day'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={cx('h-7 px-3 rounded-md text-[12.5px] font-medium capitalize', view === v ? 'bg-white text-navy shadow-sm' : 'text-zinc-500 hover:text-navy')}>{v}</button>
          ))}
        </div>
        {canAdd && <Button size="sm" variant="primary" onClick={() => setModal({ date: cursor < today ? today : cursor })}>+ Schedule class</Button>}
      </div>

      {view === 'month' && (() => {
        const first = `${cursor.slice(0, 7)}-01`, start = mondayOf(first);
        const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
        const weeks = days[35].slice(0, 7) === cursor.slice(0, 7) ? 6 : 5;
        return (
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-7 border-b border-line bg-surface/60">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{d}</div>)}</div>
              <div className="grid grid-cols-7">
                {days.slice(0, weeks * 7).map((d) => {
                  const items = onDay(d), other = d.slice(0, 7) !== cursor.slice(0, 7);
                  return (
                    <div key={d} onClick={() => add(d)} className={cx('min-h-24 border-b border-r border-line p-1.5 text-left', canAdd && 'cursor-pointer hover:bg-surface/70', other && 'bg-zinc-50/70')}>
                      <div className={cx('mb-1 inline-grid place-items-center size-6 rounded-full text-[12px] tabular', d === today ? 'bg-accent text-white font-bold' : other ? 'text-zinc-400' : 'text-zinc-700')}>{+d.slice(8)}</div>
                      <div className="space-y-1">
                        {items.slice(0, 3).map((c) => <Chip key={c.id} c={c} db={db} onClick={() => setModal({ id: c.id })} />)}
                        {items.length > 3 && <button onClick={(e) => { e.stopPropagation(); setCursor(d); setView('day'); }} className="text-[11px] font-medium text-navy hover:underline">+{items.length - 3} more</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {view === 'week' && (
        <div className="overflow-x-auto">
          <div className="grid grid-cols-7 min-w-[760px]">
            {Array.from({ length: 7 }, (_, i) => addDays(mondayOf(cursor), i)).map((d) => (
              <div key={d} className="border-r border-line last:border-r-0 min-h-64">
                <button onClick={() => add(d)} className={cx('w-full px-2 py-2 border-b border-line text-left', d === today ? 'bg-accent-soft' : 'bg-surface/60', canAdd && 'hover:bg-surface')}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{dayName(d, { weekday: 'short' })}</div>
                  <div className={cx('text-[15px] font-bold tabular', d === today ? 'text-accent' : 'text-navy')}>{+d.slice(8)}</div>
                </button>
                <div className="p-1.5 space-y-1.5">{onDay(d).map((c) => <Chip key={c.id} c={c} db={db} big onClick={() => setModal({ id: c.id })} />)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'day' && (
        <div className="p-4 space-y-2">
          {!onDay(cursor).length ? <Empty title="No classes this day" action={canAdd ? <Button onClick={() => add(cursor)}>+ Schedule a class</Button> : undefined} />
            : onDay(cursor).map((c) => <DayRow key={c.id} c={c} db={db} onClick={() => setModal({ id: c.id })} />)}
        </div>
      )}

      {!batchId && usedBatches.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 py-2.5 border-t border-line text-[12px] text-zinc-600">
          {usedBatches.map((id) => <span key={id} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: batchColor(db, id) }} />{db.batches.find((b) => b.id === id)?.name}</span>)}
        </div>
      )}
      <ClassModal open={!!modal} classId={modal?.id} date={modal?.date} batchId={batchId} onClose={() => setModal(null)} />
    </Card>
  );
}

function Chip({ c, db, big, onClick }: { c: ClassSession; db: DB; big?: boolean; onClick: () => void }) {
  const color = batchColor(db, c.batchId), off = c.status === 'cancelled';
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} title={`${db.batches.find((b) => b.id === c.batchId)?.name} · ${fmtTime(c.startTime)}–${fmtTime(c.endTime)}${off ? ' (cancelled)' : ''}`}
      className={cx('w-full text-left rounded-md px-1.5 py-1 text-[11.5px] leading-tight border-l-[3px] hover:brightness-95', off && 'opacity-55 line-through')}
      style={{ borderColor: color, background: `color-mix(in srgb, ${color} 12%, white)` }}>
      <span className="font-semibold tabular" style={{ color }}>{fmtTime(c.startTime)}</span>{' '}
      <span className="text-zinc-800">{db.batches.find((b) => b.id === c.batchId)?.name}</span>
      {big && <span className="block text-zinc-500 tabular">until {fmtTime(c.endTime)}</span>}
    </button>
  );
}
function DayRow({ c, db, onClick }: { c: ClassSession; db: DB; onClick: () => void }) {
  const color = batchColor(db, c.batchId);
  const r = roster(db, c), present = r.filter((s) => markOf(db, c.id, s.id)?.status === 'present').length;
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 rounded-xl border border-line p-3 text-left hover:bg-surface" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="w-28 shrink-0 tabular"><div className="font-bold text-navy">{fmtTime(c.startTime)}</div><div className="text-[12px] text-muted">to {fmtTime(c.endTime)}</div></div>
      <div className="flex-1 min-w-0"><div className={cx('font-semibold truncate', c.status === 'cancelled' && 'line-through text-muted')}>{db.batches.find((b) => b.id === c.batchId)?.name}</div><div className="text-[12px] text-muted">{durLabel(c)}{c.notes ? ` · ${c.notes}` : ''}</div></div>
      {c.status === 'cancelled' ? <Badge tone="gray">Cancelled</Badge> : <span className="text-[12.5px] text-zinc-600 tabular">{present}/{r.length} present</span>}
    </button>
  );
}

/* ===================================== schedule / edit a class ===================================== */
const DURATIONS = [30, 45, 60, 90, 120, 150, 180];
export function ClassModal({ open, classId, date, batchId, onClose, onAttendance }: { open: boolean; classId?: string; date?: ISODate; batchId?: string; onClose: () => void; onAttendance?: (id: string) => void }) {
  const db = S.useDB();
  const run = useRun();
  const { ask } = useUI();
  const c = classId ? db.classes.find((x) => x.id === classId) : undefined;
  const batches = db.batches.filter((b) => b.status !== 'cancelled' || b.id === c?.batchId);
  const [f, setF] = useState({ batchId: '', date: '', startTime: '', endTime: '', notes: '' });
  const [jobs, setJobs] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!open) return;
    if (c) setF({ batchId: c.batchId, date: c.date, startTime: c.startTime, endTime: c.endTime, notes: c.notes });
    else {
      const b = db.batches.find((x) => x.id === (batchId ?? '')) ?? batches.find((x) => x.status === 'running' || x.status === 'upcoming') ?? batches[0];
      const [st, en] = batchTimes(b?.timing ?? '');
      setF({ batchId: b?.id ?? '', date: date ?? todayIST(), startTime: st, endTime: en, notes: '' });
    }
    setJobs(null);
    if (c && cloudEnabled) void sb!.from('notification_jobs').select('status').eq('class_id', c.id).then(({ data }) => {
      const n: Record<string, number> = {}; for (const r of (data ?? []) as { status: string }[]) n[r.status] = (n[r.status] ?? 0) + 1; setJobs(n);
    });
  }, [open, classId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickBatch = (id: string) => { const [st, en] = batchTimes(db.batches.find((b) => b.id === id)?.timing ?? ''); setF({ ...f, batchId: id, ...(c ? {} : { startTime: st, endTime: en }) }); };
  const dur = f.startTime && f.endTime ? minutesOf(f.endTime) - minutesOf(f.startTime) : 0;
  const ok = !!f.batchId && !!f.date && !!f.startTime && !!f.endTime && dur > 0;
  const save = () => { let id: string | undefined; run(() => { id = S.saveClass({ id: c?.id, ...f }); }, c ? 'Class updated — reminders updated' : 'Class scheduled — students will get reminders'); if (id) onClose(); };
  const cancel = async () => { if (!c) return; const r = await ask({ title: 'Cancel this class?', message: 'Pending reminders are removed. Attendance already marked is kept.', input: 'Reason', confirm: 'Cancel class', danger: true }); if (r) run(() => S.setClassStatus(c.id, 'cancelled', r), 'Class cancelled'); };
  const r = c ? roster(db, c) : [], now = nowIST();
  const counts = c ? r.reduce((a, s) => { a[stateOf(c, markOf(db, c.id, s.id), now)]++; return a; }, { present: 0, absent: 0, none: 0 }) : null;
  const canEdit = S.allowed('batches', c ? 'edit' : 'create', db);

  return (
    <Modal open={open} onClose={onClose} title={c ? 'Class details' : 'Schedule a class'}
      footer={<>
        {c && canEdit && (c.status === 'scheduled' ? <Button variant="danger" className="mr-auto" onClick={cancel}>Cancel class</Button>
          : <Button className="mr-auto" onClick={() => run(() => S.setClassStatus(c.id, 'scheduled'), 'Class restored')}>Restore class</Button>)}
        <Button onClick={onClose}>Close</Button>
        {canEdit && <Button variant="primary" disabled={!ok} onClick={save}>{c ? 'Save changes' : 'Schedule class'}</Button>}
      </>}>
      {c && counts && (
        <div className="mb-4 rounded-xl border border-line p-3" style={{ borderLeft: `4px solid ${batchColor(db, c.batchId)}` }}>
          <div className="flex items-start justify-between gap-2">
            <div><div className="font-bold text-navy">{db.batches.find((b) => b.id === c.batchId)?.name}</div><div className="text-[13px] text-zinc-600">{classLabel(c)} · {durLabel(c)}</div></div>
            <Badge tone={c.status === 'cancelled' ? 'gray' : 'green'}>{c.status === 'cancelled' ? 'Cancelled' : 'Scheduled'}</Badge>
          </div>
          {c.status === 'scheduled' && <div className="mt-2.5 flex flex-wrap gap-3 text-[12.5px]">
            <span className="text-ok font-semibold">{counts.present} present</span><span className="text-bad font-semibold">{counts.absent} absent</span><span className="text-muted">{counts.none} not marked</span>
            {onAttendance && <button className="ml-auto font-medium text-navy hover:underline" onClick={() => { onAttendance(c.id); onClose(); }}>Open attendance →</button>}
          </div>}
          {cloudEnabled && jobs && <div className="mt-2 text-[12px] text-muted">Reminders: {Object.keys(jobs).length ? Object.entries(jobs).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(' · ') : 'none (no students, or the class is too soon / past)'}</div>}
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3.5">
        <Field label="Batch" required className="sm:col-span-2"><Select value={f.batchId} disabled={!canEdit || (!!batchId && !c)} onChange={(e) => pickBatch(e.target.value)} options={batches.map((b) => ({ value: b.id, label: b.name }))} /></Field>
        <Field label="Class date" required><Input type="date" value={f.date} disabled={!canEdit} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Duration"><Select value={DURATIONS.includes(dur) ? String(dur) : ''} disabled={!canEdit || !f.startTime} placeholder={dur > 0 ? durLabel(f) : 'Custom'}
          onChange={(e) => e.target.value && setF({ ...f, endTime: timeOf(Math.min(minutesOf(f.startTime) + +e.target.value, 23 * 60 + 59)) })}
          options={DURATIONS.map((m) => ({ value: String(m), label: durLabel({ startTime: '00:00', endTime: timeOf(m) }) }))} /></Field>
        <Field label="Start time" required><Input type="time" value={f.startTime} disabled={!canEdit} onChange={(e) => { const st = e.target.value; setF({ ...f, startTime: st, endTime: dur > 0 && st ? timeOf(Math.min(minutesOf(st) + dur, 23 * 60 + 59)) : f.endTime }); }} /></Field>
        <Field label="End time" required error={f.startTime && f.endTime && dur <= 0 ? 'After the start time' : undefined}><Input type="time" value={f.endTime} disabled={!canEdit} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></Field>
        <Field label="Note (optional)" className="sm:col-span-2"><Textarea value={f.notes} disabled={!canEdit} onChange={(e) => setF({ ...f, notes: e.target.value })} className="min-h-14" placeholder="e.g. Topic: Candlestick patterns" /></Field>
      </div>
      {!c && <p className="mt-3 text-[12px] text-muted">Times are filled in from the batch's usual timing. Students of the batch are notified right away, then reminded 1 day before, at 8:00 AM on the day, and 30 minutes before. If you change or cancel the class, they are told too.</p>}
    </Modal>
  );
}

/* ===================================== student cards ===================================== */
const TONE: Record<AttState, { card: string; dot: string; label: string }> = {
  present: { card: 'border-emerald-300 bg-emerald-50', dot: 'bg-emerald-500', label: 'Present' },
  absent: { card: 'border-red-300 bg-red-50', dot: 'bg-red-500', label: 'Absent' },
  none: { card: 'border-line bg-zinc-50', dot: 'bg-zinc-300', label: 'Not marked' },
};
function StudentAttCard({ s, state, mark, onSet, children }: { s: Student; state: AttState; mark?: ClassMark; onSet?: (v: ClassMark['status'] | null) => void; children?: ReactNode }) {
  const t = TONE[state];
  const initials = s.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <div className={cx('rounded-xl border p-3 transition-colors', t.card)}>
      <div className="flex items-center gap-3">
        {s.photo ? <img src={s.photo} alt="" className="size-11 rounded-full object-cover ring-2 ring-white" /> : <span className="size-11 rounded-full bg-navy/85 text-white grid place-items-center font-semibold text-[14px] ring-2 ring-white">{initials}</span>}
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink truncate">{s.name}</div>
          <div className="text-[12px] text-zinc-600 tabular truncate">{s.code} · {fmtPhone(s.phone)}</div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-zinc-700"><span className={cx('size-2.5 rounded-full', t.dot)} />{t.label}</span>
      </div>
      {mark && <div className="mt-2 text-[11.5px] text-zinc-600">{mark.status === 'present' ? 'Marked present' : 'Marked absent'} {mark.method === 'qr' ? 'by QR scan' : mark.method === 'app' ? 'in the app (no QR)' : 'by staff'} · {fmtDateTime(mark.at)}</div>}
      {onSet && (
        <div className="mt-2.5 flex gap-1.5">
          <button onClick={() => onSet(mark?.status === 'present' ? null : 'present')} className={cx('flex-1 h-8 rounded-lg text-[12.5px] font-semibold border', mark?.status === 'present' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50')}>Present</button>
          <button onClick={() => onSet(mark?.status === 'absent' ? null : 'absent')} className={cx('flex-1 h-8 rounded-lg text-[12.5px] font-semibold border', mark?.status === 'absent' ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-red-300 text-red-700 hover:bg-red-50')}>Absent</button>
        </div>
      )}
      {children}
    </div>
  );
}

function ClassPicker({ list, value, onChange }: { list: ClassSession[]; value?: string; onChange: (id: string) => void }) {
  return <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="w-full sm:w-80" placeholder={list.length ? undefined : 'No classes scheduled'}
    options={[...list].reverse().map((c) => ({ value: c.id, label: `${classLabel(c)}${c.status === 'cancelled' ? ' (cancelled)' : ''}` }))} />;
}

/** Students tab: everyone in the batch, coloured by their attendance in the chosen class. */
export function BatchStudents({ batch, classId, setClassId }: { batch: Batch; classId?: string; setClassId: (id: string) => void }) {
  const db = S.useDB();
  const [q, setQ] = useState('');
  const list = classesOf(db, batch.id), c = list.find((x) => x.id === classId);
  const people = c ? roster(db, c) : db.students.filter((s) => s.batchId === batch.id && s.status !== 'Dropped' && s.status !== 'Refunded');
  const t = q.trim().toLowerCase(), now = nowIST();
  const shown = people.filter((s) => !t || s.name.toLowerCase().includes(t) || s.code.toLowerCase().includes(t));
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <ClassPicker list={list} value={classId} onChange={setClassId} />
        <SearchInput value={q} onChange={setQ} placeholder="Search name or student ID" className="w-full sm:w-64" />
        <span className="ml-auto text-[12px] text-muted inline-flex gap-3"><Legend tone="present" /><Legend tone="absent" /><Legend tone="none" /></span>
      </div>
      {!shown.length ? <Card><Empty title="No students in this batch yet" /></Card> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {shown.map((s) => { const m = c ? markOf(db, c.id, s.id) : undefined; return <StudentAttCard key={s.id} s={s} state={c ? stateOf(c, m, now) : 'none'} mark={m} />; })}
        </div>
      )}
    </div>
  );
}
const Legend = ({ tone }: { tone: AttState }) => <span className="inline-flex items-center gap-1.5"><span className={cx('size-2.5 rounded-full', TONE[tone].dot)} />{TONE[tone].label}</span>;

/* ===================================== attendance tab ===================================== */
export function BatchAttendance({ batch, classId, setClassId }: { batch: Batch; classId?: string; setClassId: (id: string) => void }) {
  const db = S.useDB();
  const run = useRun();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | AttState>('all');
  const [newClass, setNewClass] = useState(false);
  const can = S.allowed('batches', 'edit', db);
  const list = classesOf(db, batch.id), c = list.find((x) => x.id === classId);
  const today = todayIST(), now = nowIST();
  const todays = list.find((x) => x.date === today && x.status === 'scheduled');
  // students' QR scans arrive on the server: pick them up every 10 s while this tab is open
  // ponytail: pulls all tables; switch to a Supabase realtime subscription on class_marks if it ever feels slow
  useEffect(() => { if (!cloudEnabled) return; const t = setInterval(() => { if (!document.hidden) void S.refreshNow(); }, 10000); return () => clearInterval(t); }, []);

  if (!c) return (
    <Card className="p-6 text-center">
      <Empty title="No class to take attendance for" body="Schedule a class first. Attendance is kept separately for every class." action={S.allowed('batches', 'create', db) ? <Button variant="primary" onClick={() => setNewClass(true)}>+ Schedule today's class</Button> : undefined} />
      <ClassModal open={newClass} date={today} batchId={batch.id} onClose={() => setNewClass(false)} />
      {cloudEnabled && can && <div className="mt-4 text-left"><QrPanel /></div>}
    </Card>
  );

  const people = roster(db, c);
  const rows = people.map((s) => ({ s, m: markOf(db, c.id, s.id), st: stateOf(c, markOf(db, c.id, s.id), now) }));
  const sum = { total: rows.length, present: rows.filter((r) => r.st === 'present').length, absent: rows.filter((r) => r.st === 'absent').length, none: rows.filter((r) => r.st === 'none').length };
  const t = q.trim().toLowerCase();
  const shown = rows.filter((r) => (filter === 'all' || r.st === filter) && (!t || r.s.name.toLowerCase().includes(t) || r.s.code.toLowerCase().includes(t)));
  const off = c.status === 'cancelled';
  const report = () => rows.map((r) => ({ 'Student ID': r.s.code, Name: r.s.name, Mobile: r.s.phone, Status: TONE[r.st].label, 'Marked at': r.m ? fmtDateTime(r.m.at) : '', Method: r.m ? (r.m.method === 'qr' ? 'QR scan' : r.m.method === 'app' ? 'App (no QR)' : 'Staff') : '' }));
  const file = `attendance-${batch.name}-${c.date}`.replace(/[^\w-]+/g, '_');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ClassPicker list={list} value={c.id} onChange={setClassId} />
        {todays && todays.id !== c.id && <Button size="sm" onClick={() => setClassId(todays.id)}>Today's class</Button>}
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => downloadCSV(report(), file)}>Excel (CSV)</Button>
          <Button size="sm" onClick={() => printTable(`Attendance — ${batch.name}`, classLabel(c), report())}>PDF</Button>
        </div>
      </div>
      {off ? <Card className="p-5"><Empty title="This class was cancelled" /></Card> : <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SumTile label="Total students" value={sum.total} />
          <SumTile label="Present" value={sum.present} tone="text-emerald-600" />
          <SumTile label="Absent" value={sum.absent} tone="text-red-600" sub={sum.none ? `${sum.none} not marked yet` : undefined} />
          <SumTile label="Attendance" value={`${pct(sum.present, sum.total)}%`} tone="text-navy" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Search name or student ID" className="w-full sm:w-64" />
          <div className="flex p-0.5 rounded-lg bg-zinc-100/80 border border-line">
            {([['all', 'All', sum.total], ['present', 'Present', sum.present], ['absent', 'Absent', sum.absent], ['none', 'Not marked', sum.none]] as const).map(([v, l, n]) => (
              <button key={v} onClick={() => setFilter(v)} aria-pressed={filter === v} className={cx('h-7 px-2.5 rounded-md text-[12.5px] font-medium', filter === v ? 'bg-white text-navy shadow-sm' : 'text-zinc-500 hover:text-navy')}>{l} <span className="tabular text-zinc-400">{n}</span></button>
            ))}
          </div>
          {can && sum.none > 0 && <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => run(() => S.markRest(c.id, rows.filter((r) => !r.m).map((r) => r.s.id), 'present'), 'Marked present')}>Mark rest present</Button>
            <Button size="sm" onClick={() => run(() => S.markRest(c.id, rows.filter((r) => !r.m).map((r) => r.s.id), 'absent'), 'Marked absent')}>Mark rest absent</Button>
          </div>}
        </div>
        {!shown.length ? <Card><Empty title="No students match" /></Card> : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {shown.map((r) => <StudentAttCard key={r.s.id} s={r.s} state={r.st} mark={r.m} onSet={can ? (v) => run(() => S.setMark(c.id, r.s.id, v)) : undefined} />)}
          </div>
        )}
        {cloudEnabled && <p className="text-[12px] text-muted">Students who scan the classroom QR turn green here by themselves within about 10 seconds. To update now, press <button className="font-medium text-navy hover:underline" onClick={() => void S.refreshNow()}>Refresh</button>.</p>}
      </>}
      {cloudEnabled && can && <QrPanel />}
    </div>
  );
}
const SumTile = ({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: string; sub?: string }) => (
  <div className="rounded-xl border border-line bg-white px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div><div className={cx('text-[24px] font-bold tabular leading-tight', tone ?? 'text-ink')}>{value}</div>{sub && <div className="text-[11.5px] text-muted">{sub}</div>}</div>
);

/* ===================================== classroom QR ===================================== */
function QrPanel() {
  const db = S.useDB();
  const run = useRun();
  const { ask, toast } = useUI();
  const [token, setToken] = useState<string | null>(null);
  const [img, setImg] = useState('');
  const [show, setShow] = useState(false);
  const w = db.settings.attendanceWindow ?? S.DEFAULT_ATTENDANCE_WINDOW;
  const [win, setWin] = useState({ before: String(w.beforeMins), after: String(w.afterMins) });
  const url = token ? `${location.origin}/attend?t=${token}` : '';
  const load = async (regen = false) => {
    const { data, error } = await sb!.rpc('classroom_qr_token', { p_regenerate: regen });
    if (error) return toast(error.message, 'bad');
    setToken(String(data));
  };
  useEffect(() => { if (show && !token) void load(); }, [show]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (url) void import('qrcode').then((Q) => Q.toDataURL(url, { width: 640, margin: 2, errorCorrectionLevel: 'M' })).then(setImg); }, [url]);
  const print = () => {
    const wnd = window.open('', '_blank'); if (!wnd) return;
    wnd.document.write(`<!doctype html><title>Classroom attendance QR</title><body style="font-family:system-ui,sans-serif;text-align:center;padding:40px"><img src="/logo-mark.png" style="height:80px"><h1 style="margin:8px 0 4px">Scan to mark your attendance</h1><p style="color:#555;margin:0 0 20px">Open your phone camera and scan. Sign in with your student ID if asked.</p><img src="${img}" style="width:420px;max-width:90%"><p style="color:#888;font-size:12px">${db.settings.academyName}</p><script>onload=()=>print()<\/script></body>`);
    wnd.document.close();
  };
  return (
    <Card className="p-4 rounded-2xl">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto"><div className="font-semibold text-navy">Classroom QR code</div><div className="text-[12.5px] text-muted">One code for the classroom, reused for every class. Students scan it to mark themselves present.</div></div>
        <Button size="sm" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show QR code'}</Button>
      </div>
      {show && (
        <div className="mt-4 grid sm:grid-cols-[auto_1fr] gap-5 items-start">
          <div className="rounded-xl border border-line p-2 bg-white w-fit">{img ? <img src={img} alt="Classroom attendance QR code" className="size-52" /> : <div className="size-52 grid place-items-center text-muted">Loading…</div>}</div>
          <div className="space-y-3 text-[13px]">
            <div className="flex flex-wrap gap-2">
              <a href={img} download="classroom-attendance-qr.png" className={cx('inline-flex items-center h-9 px-3.5 rounded-lg border border-zinc-300 bg-white font-medium hover:bg-surface', !img && 'pointer-events-none opacity-50')}>Download</a>
              <Button disabled={!img} onClick={print}>Print</Button>
              <Button variant="danger" onClick={async () => { if (await ask({ title: 'Make a new QR code?', message: 'The old printed code stops working straight away. Print and put up the new one.', confirm: 'New code', danger: true })) { setImg(''); await load(true); toast('New QR code made — print it again', 'ok'); } }}>Regenerate</Button>
            </div>
            <div>
              <div className="font-medium mb-1">Attendance window</div>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Opens (min before start)"><Input type="number" min={0} max={180} className="w-28" value={win.before} onChange={(e) => setWin({ ...win, before: e.target.value })} /></Field>
                <Field label="Closes (min after end)"><Input type="number" min={0} max={180} className="w-28" value={win.after} onChange={(e) => setWin({ ...win, after: e.target.value })} /></Field>
                <Button onClick={() => run(() => { const b = Math.round(+win.before), a = Math.round(+win.after); if (!(b >= 0 && b <= 180 && a >= 0 && a <= 180)) throw new S.AppError('Use 0–180 minutes.'); S.updateSettings({ attendanceWindow: { beforeMins: b, afterMins: a } }); }, 'Saved')}>Save</Button>
              </div>
              <p className="mt-1 text-[12px] text-muted">Students can mark themselves present only during their own batch's class, inside this window, and only once.</p>
              <label className="mt-3 flex items-start gap-2 text-[13px] cursor-pointer">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={db.settings.attendanceNoQr ?? true}
                  onChange={(e) => run(() => S.updateSettings({ attendanceNoQr: e.target.checked }), e.target.checked ? 'Students can mark without QR' : 'QR scan required')} />
                <span><b>Allow marking without QR</b> — for students who can't scan. Still only during their own class time; shown to you as "in the app (no QR)".</span>
              </label>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ===================================== history & reports ===================================== */
export function BatchHistory({ batch }: { batch: Batch }) {
  const db = S.useDB();
  const [mode, setMode] = useState<'date' | 'student'>('date');
  const [who, setWho] = useState<string | null>(null);
  const now = nowIST();
  const done = classesOf(db, batch.id).filter((c) => c.status === 'scheduled' && startOf(c) <= now); // conducted classes
  const students = db.students.filter((s) => s.batchId === batch.id && s.status !== 'Dropped' && s.status !== 'Refunded').sort((a, b) => a.name.localeCompare(b.name));
  const byClass = useMemo(() => [...done].reverse().map((c) => {
    const r = roster(db, c), st = r.map((s) => stateOf(c, markOf(db, c.id, s.id), now));
    const present = st.filter((x) => x === 'present').length, absent = st.filter((x) => x === 'absent').length;
    return { c, total: r.length, present, absent, none: r.length - present - absent };
  }), [db, batch.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const statOf = (s: Student) => {
    const mine = done.filter((c) => roster(db, c).some((x) => x.id === s.id));
    const present = mine.filter((c) => markOf(db, c.id, s.id)?.status === 'present').length;
    const missed = mine.filter((c) => stateOf(c, markOf(db, c.id, s.id), now) === 'absent').length;
    return { total: mine.length, present, missed, pct: pct(present, mine.length) };
  };
  const byStudent = students.map((s) => ({ s, ...statOf(s) }));
  const LOW = 75;
  const file = (k: string) => `${k}-${batch.name}`.replace(/[^\w-]+/g, '_');
  const dateRows = () => byClass.map((x) => ({ Date: x.c.date, Time: `${x.c.startTime}–${x.c.endTime}`, Students: x.total, Present: x.present, Absent: x.absent, 'Attendance %': pct(x.present, x.total) }));
  const studentRows = () => byStudent.map((x) => ({ 'Student ID': x.s.code, Name: x.s.name, 'Classes held': x.total, Present: x.present, Absent: x.missed, 'Attendance %': x.pct }));
  const person = byStudent.find((x) => x.s.id === who);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex p-0.5 rounded-lg bg-zinc-100/80 border border-line">
          {([['date', 'Date-wise'], ['student', 'Student-wise']] as const).map(([v, l]) => <button key={v} onClick={() => setMode(v)} aria-pressed={mode === v} className={cx('h-8 px-3 rounded-md text-[13px] font-medium', mode === v ? 'bg-white text-navy shadow-sm' : 'text-zinc-500 hover:text-navy')}>{l}</button>)}
        </div>
        <span className="text-[12.5px] text-muted"><b className="text-navy tabular">{done.length}</b> classes held</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => (mode === 'date' ? downloadCSV(dateRows(), file('attendance-by-date')) : downloadCSV(studentRows(), file('attendance-by-student')))}>Excel (CSV)</Button>
          <Button size="sm" onClick={() => printTable(`Attendance — ${batch.name}`, mode === 'date' ? 'Date-wise' : 'Student-wise', mode === 'date' ? dateRows() : studentRows())}>PDF</Button>
        </div>
      </div>
      {mode === 'date' ? (
        <Card className="overflow-hidden">
          {!byClass.length ? <Empty title="No classes held yet" /> : (
            <table className="w-full text-[13px]">
              <thead><tr className="bg-surface text-[11px] uppercase tracking-wider text-muted"><th className="text-left font-semibold px-4 py-2">Class</th><th className="text-right font-semibold px-3 py-2">Present</th><th className="text-right font-semibold px-3 py-2">Absent</th><th className="text-right font-semibold px-4 py-2">Attendance</th></tr></thead>
              <tbody>{byClass.map((x) => (
                <tr key={x.c.id} className="border-t border-line"><td className="px-4 py-2.5 font-medium">{classLabel(x.c)}</td><td className="px-3 text-right tabular text-emerald-700 font-semibold">{x.present}</td><td className="px-3 text-right tabular text-red-700 font-semibold">{x.absent}{x.none ? <span className="text-muted font-normal"> +{x.none}</span> : ''}</td>
                  <td className="px-4 text-right"><span className="inline-flex items-center gap-2"><span className="w-20 h-1.5 rounded-full bg-zinc-200 overflow-hidden"><span className="block h-full bg-accent" style={{ width: `${pct(x.present, x.total)}%` }} /></span><b className="tabular w-12 text-right">{pct(x.present, x.total)}%</b></span></td></tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {!byStudent.length ? <Empty title="No students in this batch" /> : (
            <table className="w-full text-[13px]">
              <thead><tr className="bg-surface text-[11px] uppercase tracking-wider text-muted"><th className="text-left font-semibold px-4 py-2">Student</th><th className="text-right font-semibold px-3 py-2">Classes</th><th className="text-right font-semibold px-3 py-2">Present</th><th className="text-right font-semibold px-3 py-2">Absent</th><th className="text-right font-semibold px-4 py-2">Attendance</th></tr></thead>
              <tbody>{byStudent.map((x) => (
                <tr key={x.s.id} onClick={() => setWho(x.s.id)} className="border-t border-line cursor-pointer hover:bg-surface/70">
                  <td className="px-4 py-2.5"><div className="font-medium">{x.s.name}</div><div className="text-[11.5px] text-muted tabular">{x.s.code}</div></td>
                  <td className="px-3 text-right tabular">{x.total}</td><td className="px-3 text-right tabular text-emerald-700 font-semibold">{x.present}</td><td className="px-3 text-right tabular text-red-700 font-semibold">{x.missed}</td>
                  <td className="px-4 text-right">{x.total ? <span className={cx('inline-flex items-center gap-1.5 font-bold tabular', x.pct < LOW ? 'text-red-600' : 'text-ink')}>{x.pct}%{x.pct < LOW && <Badge tone="red">Low</Badge>}</span> : <span className="text-muted">—</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      )}
      {mode === 'student' && byStudent.some((x) => x.total && x.pct < LOW) && <p className="text-[12.5px] text-red-600">Students below {LOW}% attendance are marked <b>Low</b>.</p>}
      <Modal open={!!person} onClose={() => setWho(null)} title={person ? `${person.s.name} — attendance` : ''}>
        {person && <>
          <div className="grid grid-cols-4 gap-2 mb-4">
            <SumTile label="Classes" value={person.total} /><SumTile label="Present" value={person.present} tone="text-emerald-600" /><SumTile label="Absent" value={person.missed} tone="text-red-600" /><SumTile label="Attendance" value={`${person.pct}%`} tone={person.pct < LOW ? 'text-red-600' : 'text-navy'} />
          </div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {[...done].reverse().filter((c) => roster(db, c).some((x) => x.id === person.s.id)).map((c) => { const m = markOf(db, c.id, person.s.id), st = stateOf(c, m, now); return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-[13px]"><span className={cx('size-2.5 rounded-full', TONE[st].dot)} /><span className="flex-1">{classLabel(c)}</span><span className="text-zinc-600">{TONE[st].label}{m?.method === 'qr' ? ' · QR' : m?.method === 'app' ? ' · App' : ''}</span></li>
            ); })}
          </ul>
        </>}
      </Modal>
    </div>
  );
}

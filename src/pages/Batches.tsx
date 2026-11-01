import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Button, Card, CardHeader, Checkbox, Empty, Field, Input, Modal, Money, PageHeader, Select, Stat, Table, useRun } from '../ui/kit';
import { financeFor } from '../domain/finance';
import type { Batch, BatchStatus } from '../domain/types';
import { fmtDate, fmtINR, todayIST, addDays } from '../domain/util';

export default function Batches() {
  const db = S.useDB();
  const me = S.useMe()!;
  const [edit, setEdit] = useState<Partial<Batch> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const batches = me.role === 'teacher' ? db.batches.filter((b) => b.teacherId === me.id) : db.batches;
  const enrolled = (id: string) => db.students.filter((s) => s.batchId === id && s.status === 'Active').length;
  if (open) return <BatchDetail id={open} onBack={() => setOpen(null)} onEdit={() => setEdit(db.batches.find((b) => b.id === open)!)} />;
  return (
    <>
      <PageHeader title="Batches" sub={me.role === 'teacher' ? 'Batches assigned to you' : undefined} actions={S.allowed('batches', 'create', db) && <Button variant="primary" onClick={() => setEdit({ status: 'upcoming', capacity: 30, courseId: db.courses[0]?.id, startDate: todayIST(), endDate: addDays(todayIST(), 56), schedule: 'Mon–Fri', timing: '10:00–12:00' })}>+ New batch</Button>} />
      <Card>
        <Table rows={batches} rowKey={(b) => b.id} onRow={(b) => setOpen(b.id)} empty={<Empty title="No batches yet" body="Create a batch to assign students and track attendance." />} cols={[
          { key: 'id', label: 'ID', render: (b) => <span className="text-muted">{b.id}</span> },
          { key: 'n', label: 'Batch', render: (b) => <span className="font-medium">{b.name}</span>, sort: (b) => b.name },
          { key: 'c', label: 'Course', render: (b) => db.courses.find((c) => c.id === b.courseId)?.name },
          { key: 't', label: 'Teacher', render: (b) => S.empName(b.teacherId, db) },
          { key: 'd', label: 'Dates', render: (b) => `${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}`, sort: (b) => b.startDate },
          { key: 'tm', label: 'Schedule', render: (b) => `${b.schedule} · ${b.timing}` },
          { key: 'e', label: 'Enrolled', render: (b) => { const n = enrolled(b.id); return <span className={n >= b.capacity ? 'text-bad font-medium' : ''}>{n}/{b.capacity}</span>; } },
          { key: 's', label: 'Status', render: (b) => <Badge>{b.status}</Badge> },
        ]} />
      </Card>
      <BatchModal batch={edit} onClose={() => setEdit(null)} />
    </>
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

function BatchDetail({ id, onBack, onEdit }: { id: string; onBack: () => void; onEdit: () => void }) {
  const db = S.useDB();
  const run = useRun();
  const nav = useNavigate();
  const b = db.batches.find((x) => x.id === id)!;
  const [date, setDate] = useState(todayIST());
  const students = db.students.filter((s) => s.batchId === id && s.status !== 'Dropped' && s.status !== 'Refunded');
  const session = db.attendance.find((a) => a.batchId === id && a.date === date);
  const [present, setPresent] = useState<Set<string>>(new Set());
  useEffect(() => setPresent(new Set(session?.present ?? students.map((s) => s.id))), [date, session?.id]);
  const fees = S.allowed('fees', 'view', db);
  const fin = students.map((s) => financeFor(db, s.id, todayIST()));
  const sessions = db.attendance.filter((a) => a.batchId === id);
  const avg = sessions.length && students.length ? sessions.reduce((a, s) => a + s.present.length, 0) / (sessions.length * students.length) : null;
  return (
    <>
      <button onClick={onBack} className="text-muted hover:text-ink mb-2">← All batches</button>
      <PageHeader title={b.name} sub={`${db.courses.find((c) => c.id === b.courseId)?.name} · ${S.empName(b.teacherId, db)} · ${b.schedule} ${b.timing} · ${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}`} actions={S.allowed('batches', 'edit', db) && <Button onClick={onEdit}>Edit batch</Button>} />
      <Card className="p-4 grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
        <Stat label="Enrolled" value={`${students.filter((s) => s.status === 'Active').length}/${b.capacity}`} />
        <Stat label="Admissions" value={db.enrolments.filter((e) => e.batchId === id).length} />
        <Stat label="Avg. attendance" value={avg === null ? '—' : `${(avg * 100).toFixed(0)}%`} />
        {fees && <><Stat label="Collected" value={fmtINR(fin.reduce((a, f) => a + f.paid, 0))} tone="ok" /><Stat label="Balance due" value={fmtINR(fin.reduce((a, f) => a + f.outstanding, 0))} tone="warn" /></>}
      </Card>
      <Card>
        <CardHeader title="Attendance" right={<div className="flex gap-2 items-center"><Input type="date" max={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
          {S.allowed('batches', 'edit', db) && <Button variant="primary" disabled={!students.length} onClick={() => run(() => S.markAttendance(id, date, [...present]), `Attendance saved for ${fmtDate(date)}`)}>{session ? 'Update' : 'Save'}</Button>}</div>} />
        <Table rows={students} rowKey={(s) => s.id} empty={<Empty title="No students in this batch" />} cols={[
          { key: 'p', label: 'Present', render: (s) => <Checkbox checked={present.has(s.id)} onChange={() => { const n = new Set(present); n.has(s.id) ? n.delete(s.id) : n.add(s.id); setPresent(n); }} label="" /> },
          { key: 'n', label: 'Student', render: (s) => <button className="font-medium hover:text-accent" onClick={() => nav(`/students/${s.id}`)}>{s.name}</button> },
          { key: 'c', label: 'ID', render: (s) => <span className="text-muted">{s.code}</span> },
          { key: 'a', label: 'Attendance', render: (s) => { const n = sessions.filter((x) => x.present.includes(s.id)).length; return sessions.length ? `${n}/${sessions.length}` : '—'; } },
          ...(fees ? [{ key: 'o', label: 'Balance due', render: (s: any) => <Money v={financeFor(db, s.id, todayIST()).outstanding} /> }] : []),
          { key: 's', label: 'Status', render: (s) => <Badge>{s.status}</Badge> },
        ]} />
      </Card>
    </>
  );
}

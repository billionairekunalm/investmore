import { useState } from 'react';
import { Link } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Button, Card, Empty, PageHeader, SearchInput, Select, Table, cx, useRun } from '../ui/kit';
import { StatTile } from './Dashboard';
import { Avatar } from './Students';
import type { Student } from '../domain/types';
import { fmtDate, fmtDateTime, fmtPhone } from '../domain/util';

type View = 'pending' | 'received' | 'all';

/** Course kit hand-over: who has received their kit and who hasn't. */
export default function Kits() {
  const db = S.useDB();
  const run = useRun();
  const [view, setView] = useState<View>('pending');
  const [q, setQ] = useState('');
  const [batch, setBatch] = useState('');
  const canEdit = S.allowed('students', 'edit', db);
  const students = db.students;
  const given = students.filter((s) => s.kitReceivedAt);
  const t = q.trim().toLowerCase(), digits = t.replace(/\D/g, '');
  const shown = students
    .filter((s) => (view === 'all' ? true : view === 'received' ? !!s.kitReceivedAt : !s.kitReceivedAt))
    .filter((s) => !batch || s.batchId === batch)
    .filter((s) => !t || s.name.toLowerCase().includes(t) || s.code.toLowerCase().includes(t) || (digits.length > 2 && s.phone.includes(digits)))
    .sort((a, b) => (b.kitReceivedAt ?? '').localeCompare(a.kitReceivedAt ?? '') || a.name.localeCompare(b.name));
  const bName = (id: string) => db.batches.find((b) => b.id === id)?.name ?? 'No batch';
  const mark = (s: Student, received: boolean) => run(() => S.setKitReceived(s.id, received), received ? `Kit given to ${s.name}` : 'Kit status reset');
  const action = (s: Student) => !canEdit ? null : s.kitReceivedAt
    ? <Button size="sm" variant="ghost" onClick={() => mark(s, false)}>Undo</Button>
    : <Button size="sm" variant="primary" onClick={() => mark(s, true)}>Mark received</Button>;
  const status = (s: Student) => s.kitReceivedAt ? <Badge tone="green">Received</Badge> : <Badge tone="orange">Not received</Badge>;
  const givenLine = (s: Student) => s.kitReceivedAt ? <span title={fmtDateTime(s.kitReceivedAt)}>{fmtDate(s.kitReceivedAt.slice(0, 10))} · {S.empName(s.kitReceivedBy, db)}</span> : <span className="text-muted">—</span>;

  return (
    <>
      <PageHeader title="Kits" sub="Course kits handed to students" />
      <div className="grid sm:grid-cols-3 gap-4 mb-5">
        <StatTile color="#1d4ed8" icon="students" label="Total students" value={students.length} note="Everyone on the student list" />
        <StatTile color="#15803d" icon="target" label="Kits given" value={given.length} note={`${students.length ? Math.round((given.length / students.length) * 100) : 0}% of students`} />
        <StatTile color="#c2410c" icon="clock" label="Kits pending" value={students.length - given.length} note="Still to hand over" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div role="tablist" className="flex gap-1 p-1 rounded-xl bg-zinc-100/80 border border-line">
          {([['pending', 'Not received', students.length - given.length], ['received', 'Received', given.length], ['all', 'All', students.length]] as const).map(([v, l, n]) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cx('inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium transition-colors',
              view === v ? 'bg-navy text-white shadow-sm' : 'text-zinc-600 hover:text-navy hover:bg-white')}>
              {l}<span className={cx('tabular text-[11px] leading-none rounded-md px-1.5 py-1', view === v ? 'bg-white/15' : 'bg-white border border-line text-zinc-500')}>{n}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <SearchInput value={q} onChange={setQ} placeholder="Name, student ID or mobile" className="w-full sm:w-64" />
          <Select value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="All batches" options={db.batches.map((b) => ({ value: b.id, label: b.name }))} className="w-full sm:w-44" />
        </div>
      </div>

      {/* desktop / tablet */}
      <Card className="hidden md:block overflow-hidden">
        <Table rows={shown} rowKey={(s) => s.id} className="[&_td]:py-3"
          empty={<Empty title={view === 'pending' ? 'Every student has received their kit' : 'No students here'} />}
          cols={[
            { key: 'n', label: 'Student', sort: (s) => s.name, render: (s) => (
              <Link to={`/students/${s.id}`} className="flex items-center gap-3 min-w-0 hover:text-accent">
                <Avatar name={s.name} photo={s.photo} size="size-9" />
                <div className="min-w-0 leading-tight"><div className="font-semibold text-navy truncate">{s.name}</div><div className="text-[12px] text-muted tabular">{s.code} · {fmtPhone(s.phone)}</div></div>
              </Link>
            ) },
            { key: 'b', label: 'Batch', sort: (s) => bName(s.batchId), render: (s) => bName(s.batchId) },
            { key: 'a', label: 'Admitted', sort: (s) => s.admissionDate, render: (s) => <span className="tabular">{fmtDate(s.admissionDate)}</span> },
            { key: 's', label: 'Kit', sort: (s) => (s.kitReceivedAt ? 1 : 0), render: status },
            { key: 'g', label: 'Given on', sort: (s) => s.kitReceivedAt ?? '', render: givenLine },
            { key: 'x', label: '', className: 'text-right', render: action },
          ]} />
      </Card>

      {/* phones */}
      <div className="md:hidden space-y-3">
        {!shown.length && <Card><Empty title={view === 'pending' ? 'Every student has received their kit' : 'No students here'} /></Card>}
        {shown.map((s) => (
          <Card key={s.id} className="p-4 flex items-center gap-3">
            <Avatar name={s.name} photo={s.photo} size="size-10" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{s.name}</div>
              <div className="text-[12px] text-muted tabular">{s.code} · {bName(s.batchId)}</div>
              <div className="mt-1 flex items-center gap-2 text-[12px]">{status(s)}{s.kitReceivedAt && <span className="text-muted">{fmtDate(s.kitReceivedAt.slice(0, 10))}</span>}</div>
            </div>
            {action(s)}
          </Card>
        ))}
      </div>
    </>
  );
}

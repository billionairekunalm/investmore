import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as S from '../store/store';
import { Button, Card, Empty, Field, Input, PageHeader, SearchInput, Table, cx, useRun, useUI } from '../ui/kit';
import { cloudEnabled } from '../store/cloud';
import { fmtDateTime } from '../domain/util';
import { loadDemo } from '../lib/demo';
import { balance } from './Courses';

/** Settings, kept to what the academy actually changes. Each section saves on its own. */
const SECTIONS = [
  { id: 'academy', label: 'Academy', icon: 'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6' },
  { id: 'fees', label: 'Fees', icon: 'M6 3h12M6 8h12M13 21 6 13h3a5 5 0 0 0 0-10' },
  { id: 'profit', label: 'Profit split', icon: 'M21 12A9 9 0 1 1 12 3v9z M15 3.5A9 9 0 0 1 20.5 9H15z' },
  { id: 'attendance', label: 'Attendance', icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2z' },
  { id: 'leads', label: 'Leads', icon: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' },
  { id: 'automation', label: 'Automation', icon: 'M13 2 4 14h7l-1 8 9-12h-7z' },
  { id: 'activity', label: 'Activity log', icon: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z' },
  { id: 'backup', label: 'Backup', icon: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2' },
] as const;
type Sec = (typeof SECTIONS)[number]['id'];
const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" className="size-[17px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;

export default function Settings() {
  const db = S.useDB();
  const [sp, setSp] = useSearchParams();
  const sec = (SECTIONS.find((s) => s.id === sp.get('tab'))?.id ?? 'academy') as Sec;
  const canEdit = S.allowed('settings', 'edit', db);
  return (
    <>
      <PageHeader title="Settings" sub={canEdit ? undefined : 'View only — your role cannot change settings.'} />
      <div className="grid md:grid-cols-[200px_minmax(0,1fr)] gap-5 items-start">
        <nav aria-label="Settings sections" className="flex md:flex-col gap-1 overflow-x-auto [scrollbar-width:none] md:sticky md:top-20 -mx-1 px-1">
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => setSp({ tab: s.id })} aria-current={sec === s.id ? 'page' : undefined}
              ref={(el) => { if (el && sec === s.id) el.scrollIntoView({ block: 'nearest', inline: 'center' }); }} // phones: keep the open section visible
              className={cx('flex items-center gap-2.5 h-10 px-3 rounded-lg text-[13.5px] font-medium whitespace-nowrap transition-colors',
                sec === s.id ? 'bg-navy text-white shadow-sm' : 'text-zinc-600 hover:bg-white hover:text-navy')}>
              <Icon d={s.icon} />{s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 max-w-3xl">
          {sec === 'academy' && <Academy canEdit={canEdit} />}
          {sec === 'fees' && <Fees canEdit={canEdit} />}
          {sec === 'profit' && <Profit />}
          {sec === 'attendance' && <Attendance canEdit={canEdit} />}
          {sec === 'leads' && <Leads canEdit={canEdit} />}
          {sec === 'automation' && <Automation canEdit={canEdit} />}
          {sec === 'activity' && <Activity />}
          {sec === 'backup' && <Backup />}
        </div>
      </div>
    </>
  );
}

/** One card per section: title, one short line, the fields, and a Save button that only lights up after a change. */
function Section({ title, sub, children, onSave, dirty, saveLabel = 'Save changes' }: { title: string; sub?: string; children: ReactNode; onSave?: () => void; dirty?: boolean; saveLabel?: string }) {
  return (
    <Card className="rounded-2xl overflow-hidden">
      <div className="px-5 pt-5 pb-1"><h2 className="font-semibold text-[16px] text-navy">{title}</h2>{sub && <p className="text-[13px] text-muted mt-0.5">{sub}</p>}</div>
      <div className="px-5 py-4">{children}</div>
      {onSave && <div className="px-5 py-3 border-t border-line bg-surface/50 flex justify-end"><Button variant="primary" disabled={!dirty} onClick={onSave}>{saveLabel}</Button></div>}
    </Card>
  );
}

function Academy({ canEdit }: { canEdit: boolean }) {
  const db = S.useDB();
  const run = useRun();
  const [name, setName] = useState(db.settings.academyName);
  const [inv, setInv] = useState(db.settings.invoice);
  const set = (k: keyof typeof inv) => (e: { target: { value: string } }) => setInv({ ...inv, [k]: e.target.value });
  const dirty = name !== db.settings.academyName || (Object.keys(inv) as (keyof typeof inv)[]).some((k) => inv[k] !== db.settings.invoice[k]);
  return (
    <Section title="Academy details" sub="Shown on invoices, receipts and statements." dirty={dirty && !!name.trim() && canEdit}
      onSave={() => run(() => S.updateSettings({ academyName: name.trim(), invoice: { ...inv, gstin: inv.gstin.trim().toUpperCase() } }), 'Saved')}>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3.5">
        <Field label="Academy name" className="sm:col-span-2"><Input value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={inv.address} disabled={!canEdit} onChange={set('address')} placeholder="Office address, city, PIN" /></Field>
        <Field label="Phone"><Input value={inv.phone} disabled={!canEdit} inputMode="tel" onChange={set('phone')} /></Field>
        <Field label="Email"><Input value={inv.email} disabled={!canEdit} type="email" onChange={set('email')} /></Field>
        <Field label="GSTIN" hint="Only if GST-registered"><Input value={inv.gstin} disabled={!canEdit} onChange={set('gstin')} /></Field>
        <Field label="Invoice footer note"><Input value={inv.note} disabled={!canEdit} onChange={set('note')} placeholder="e.g. Fees once paid are non-refundable" /></Field>
      </div>
    </Section>
  );
}

function Fees({ canEdit }: { canEdit: boolean }) {
  const db = S.useDB();
  const run = useRun();
  const s = db.settings;
  const [start, setStart] = useState(s.startEvent);
  const [gst, setGst] = useState(String(s.gstRateBp / 100));
  const [days, setDays] = useState(s.reminderOffsets.join(', '));
  const parsedDays = days.split(',').map((x) => x.trim()).filter(Boolean).map((x) => Number(x));
  const daysOk = parsedDays.length > 0 && parsedDays.every((x) => Number.isInteger(x) && x >= -30 && x <= 60);
  const gstOk = gst.trim() !== '' && !isNaN(+gst) && +gst >= 0 && +gst <= 28;
  const dirty = start !== s.startEvent || Math.round(+gst * 100) !== s.gstRateBp || parsedDays.join(',') !== s.reminderOffsets.join(',');
  return (
    <Section title="Fees" sub="Course fees and booking amounts are set per course in Courses." dirty={dirty && daysOk && gstOk && canEdit}
      onSave={() => run(() => S.updateSettings({ startEvent: start, gstRateBp: Math.round(+gst * 100), reminderOffsets: [...new Set(parsedDays)].sort((a, b) => a - b) }), 'Saved')}>
      <div className="space-y-5">
        <div>
          <div className="text-[12.5px] font-medium text-zinc-700 mb-1.5">First instalment is due</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {([['admission', '7 days after admission'], ['batch_start', '7 days after the batch starts']] as const).map(([v, l]) => (
              <button key={v} type="button" disabled={!canEdit} onClick={() => setStart(v)}
                className={cx('h-11 rounded-xl border px-3 text-left text-[13.5px] font-medium flex items-center gap-2.5', start === v ? 'border-accent bg-accent-soft text-ink' : 'border-line hover:bg-surface text-zinc-600')}>
                <span className={cx('size-4 rounded-full border-2 grid place-items-center', start === v ? 'border-accent' : 'border-zinc-300')}>{start === v && <span className="size-2 rounded-full bg-accent" />}</span>{l}
              </button>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3.5">
          <Field label="GST included in fees (%)" hint="0 if not GST-registered" error={gstOk ? undefined : 'Enter 0–28'}><Input value={gst} disabled={!canEdit} inputMode="decimal" onChange={(e) => setGst(e.target.value)} /></Field>
          <Field label="Payment reminder days" hint="Before (−) or after the due date, e.g. -2, 0, 1, 3" error={daysOk ? undefined : 'Whole numbers, comma separated'}><Input value={days} disabled={!canEdit} onChange={(e) => setDays(e.target.value)} /></Field>
        </div>
      </div>
    </Section>
  );
}

function Profit() {
  const db = S.useDB();
  const run = useRun();
  const isSA = S.currentUser()?.role === 'super_admin';
  const init = () => db.settings.shares.map((s) => ({ name: s.name, pct: String(s.pctBp / 100) }));
  const [rows, setRows] = useState(init);
  const total = rows.reduce((a, r) => a + Math.round((parseFloat(r.pct) || 0) * 100), 0);
  const dirty = JSON.stringify(rows) !== JSON.stringify(init());
  const ok = total === 10000 && rows.every((r) => r.name.trim());
  return (
    <Section title="Default profit split" sub="Used for courses without their own split. Changing one founder re-shares the rest so it stays 100%." dirty={isSA && dirty && ok}
      onSave={() => run(() => S.updateSettings({ shares: rows.map((r) => ({ name: r.name.trim(), pctBp: Math.round((parseFloat(r.pct) || 0) * 100) })) }), 'Profit split saved')}>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input aria-label="Founder name" value={r.name} disabled={!isSA} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <div className="relative w-28 shrink-0">
              <Input aria-label="Share %" value={r.pct} disabled={!isSA} inputMode="decimal" className="w-28 pr-7 text-right" onChange={(e) => setRows(balance(rows, i, e.target.value))} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span>
            </div>
            {isSA && rows.length > 1 && <Button size="sm" variant="ghost" aria-label="Remove founder" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</Button>}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        {isSA ? <Button size="sm" onClick={() => setRows([...rows, { name: '', pct: '0' }])}>+ Founder</Button> : <span className="text-[12.5px] text-muted">Only the Super Admin can change this.</span>}
        <span className={cx('text-[13px] font-semibold tabular', total === 10000 ? 'text-accent' : 'text-bad')}>Total {total / 100}%</span>
      </div>
    </Section>
  );
}

function Attendance({ canEdit }: { canEdit: boolean }) {
  const db = S.useDB();
  const run = useRun();
  const w = db.settings.attendanceWindow ?? S.DEFAULT_ATTENDANCE_WINDOW;
  const [f, setF] = useState({ before: String(w.beforeMins), after: String(w.afterMins), noQr: db.settings.attendanceNoQr ?? true });
  const b = Math.round(+f.before), a = Math.round(+f.after);
  const ok = b >= 0 && b <= 180 && a >= 0 && a <= 180;
  const dirty = b !== w.beforeMins || a !== w.afterMins || f.noQr !== (db.settings.attendanceNoQr ?? true);
  return (
    <Section title="Attendance" sub="When students can mark themselves present for a class." dirty={dirty && ok && canEdit}
      onSave={() => run(() => S.updateSettings({ attendanceWindow: { beforeMins: b, afterMins: a }, attendanceNoQr: f.noQr }), 'Saved')}>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3.5">
        <Field label="Opens before class starts (minutes)" error={b >= 0 && b <= 180 ? undefined : '0–180'}><Input type="number" min={0} max={180} value={f.before} disabled={!canEdit} onChange={(e) => setF({ ...f, before: e.target.value })} /></Field>
        <Field label="Closes after class ends (minutes)" error={a >= 0 && a <= 180 ? undefined : '0–180'}><Input type="number" min={0} max={180} value={f.after} disabled={!canEdit} onChange={(e) => setF({ ...f, after: e.target.value })} /></Field>
      </div>
      <label className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-line px-4 py-3 cursor-pointer">
        <span><span className="block font-medium text-[14px]">Allow marking without QR</span><span className="block text-[12.5px] text-muted">For students who can't scan. Shown to you as "in the app (no QR)".</span></span>
        <Switch on={f.noQr} disabled={!canEdit} onChange={(v) => setF({ ...f, noQr: v })} />
      </label>
      <p className="mt-3 text-[12.5px] text-muted">The classroom QR code is in Batches → a batch → Attendance.</p>
    </Section>
  );
}

const CORE_STATUSES = ['New', 'Not Contacted', 'Connected', 'Warm', 'Hot', 'Call Later', 'Converted', 'Cold', 'Lost'];
function Leads({ canEdit }: { canEdit: boolean }) {
  const db = S.useDB();
  const run = useRun();
  const [list, setList] = useState(db.settings.leadStatuses);
  const [add, setAdd] = useState('');
  const dirty = list.join('|') !== db.settings.leadStatuses.join('|');
  const addOne = () => { const v = add.trim(); if (v && !list.some((x) => x.toLowerCase() === v.toLowerCase())) setList([...list, v]); setAdd(''); };
  return (
    <Section title="Lead statuses" sub="The steps a lead moves through. The main ones (locked) are used by reminders and reports." dirty={dirty && canEdit}
      onSave={() => run(() => S.updateSettings({ leadStatuses: list }), 'Statuses saved')}>
      <div className="flex flex-wrap gap-2">
        {list.map((st) => {
          const core = CORE_STATUSES.includes(st);
          return (
            <span key={st} className={cx('inline-flex items-center gap-1.5 h-8 pl-3 rounded-full border text-[13px] font-medium', core ? 'pr-3 bg-surface border-line text-zinc-700' : 'pr-1.5 bg-accent-soft border-accent/25 text-ink')}>
              {core && <svg viewBox="0 0 24 24" className="size-3 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2.2" aria-label="Locked"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>}
              {st}
              {!core && canEdit && <button type="button" aria-label={`Remove ${st}`} onClick={() => setList(list.filter((x) => x !== st))} className="size-5 rounded-full grid place-items-center text-zinc-500 hover:bg-white hover:text-bad">✕</button>}
            </span>
          );
        })}
      </div>
      {canEdit && (
        <form onSubmit={(e) => { e.preventDefault(); addOne(); }} className="mt-4 flex gap-2 max-w-sm">
          <Input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Add a status, e.g. Demo booked" />
          <Button type="submit" disabled={!add.trim()}>Add</Button>
        </form>
      )}
    </Section>
  );
}

function Automation({ canEdit }: { canEdit: boolean }) {
  const db = S.useDB();
  const run = useRun();
  return (
    <Section title="Automatic reminders & alerts" sub="Turn each one on or off. Changes save straight away.">
      <div className="-my-1 divide-y divide-line">
        {S.RULES.map((r) => {
          const [when, then] = r.label.split(' → ');
          return (
            <label key={r.id} className="flex items-center justify-between gap-4 py-3 cursor-pointer">
              <span className="min-w-0"><span className="block text-[14px] font-medium text-ink">{when}</span>{then && <span className="block text-[12.5px] text-muted">{then}</span>}</span>
              <Switch on={!!db.settings.rules[r.id]} disabled={!canEdit} onChange={(v) => run(() => S.updateSettings({ rules: { ...db.settings.rules, [r.id]: v } }), v ? 'Turned on' : 'Turned off')} />
            </label>
          );
        })}
      </div>
    </Section>
  );
}

function Activity() {
  const db = S.useDB();
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const rows = db.audit.filter((a) => !t || a.action.toLowerCase().includes(t) || a.detail.toLowerCase().includes(t) || S.empName(a.by, db).toLowerCase().includes(t));
  return (
    <Section title="Activity log" sub="Who changed what, and when. Nothing here can be edited.">
      <SearchInput value={q} onChange={setQ} placeholder="Search person, action or detail" className="w-full sm:w-80 mb-3" />
      <div className="-mx-5 border-t border-line">
        <Table rows={rows} rowKey={(a) => a.id} pageSize={50} empty={<Empty title="Nothing found" />} cols={[
          { key: 'a', label: 'When', render: (a) => <span className="tabular whitespace-nowrap">{fmtDateTime(a.at)}</span> },
          { key: 'b', label: 'Who', render: (a) => S.empName(a.by, db) },
          { key: 'd', label: 'What', render: (a) => <span className="whitespace-normal"><span className="font-medium">{a.action.replace(/[._]/g, ' ')}</span>{a.detail && <span className="text-zinc-600"> — {a.detail}</span>}</span> },
        ]} />
      </div>
    </Section>
  );
}

function Backup() {
  const db = S.useDB();
  const run = useRun();
  const { ask, toast } = useUI();
  const [busy, setBusy] = useState(false);
  const isSA = S.currentUser()?.role === 'super_admin';
  const download = () => run(() => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([S.exportBackup()], { type: 'application/json' }));
    a.download = `investmore-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  });
  return (
    <div className="space-y-4">
      <Section title="Backup" sub={cloudEnabled ? 'Your data is saved online automatically. Download a copy now and then to keep on your computer.' : 'Data is saved on this device only. Download a backup regularly.'}>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={download}>Download backup</Button>
          {!cloudEnabled && isSA && (
            <label className="inline-flex items-center h-9 px-3.5 rounded-lg border border-line font-medium cursor-pointer hover:bg-surface">Restore from file
              <input type="file" accept="application/json" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return; const txt = await f.text(); e.target.value = '';
                if (await ask({ title: 'Restore this backup?', message: 'All data on this device will be replaced.', confirm: 'Restore', danger: true })) run(() => S.restoreBackup(txt), 'Backup restored');
              }} />
            </label>
          )}
        </div>
      </Section>
      {/* trying the app / starting over: only for the device-only version, never on the live online data */}
      {!cloudEnabled && isSA && (
        <Section title="Try the app or start over" sub="Only on this device.">
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || db.students.length > 0} loading={busy} onClick={async () => { setBusy(true); await new Promise((r) => setTimeout(r, 30)); run(() => loadDemo(), 'Sample data added'); setBusy(false); }}>
              {db.students.length ? 'Sample data: academy not empty' : 'Add sample data'}
            </Button>
            <Button variant="danger" onClick={async () => { const r = await ask({ title: 'Erase everything on this device?', message: 'This cannot be undone. Type ERASE to confirm.', input: 'Type ERASE', confirm: 'Erase', danger: true }); if (r === 'ERASE') run(() => S.resetAll()); else if (r) toast('Not erased — the text did not match.', 'bad'); }}>Erase all data</Button>
          </div>
        </Section>
      )}
    </div>
  );
}

function Switch({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={(e) => { e.preventDefault(); onChange(!on); }}
      className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', on ? 'bg-accent' : 'bg-zinc-300')}>
      <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

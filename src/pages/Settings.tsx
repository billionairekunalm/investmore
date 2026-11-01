import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, SearchInput, Table, Tabs, useRun, useUI, cx } from '../ui/kit';
import { fmtDateTime } from '../domain/util';
import { loadDemo } from '../lib/demo';

type Tab = 'general' | 'fees' | 'profit' | 'crm' | 'automation' | 'audit' | 'privacy' | 'data';

export default function Settings() {
  const db = S.useDB();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'fees';
  const isSA = S.currentUser()?.role === 'super_admin';
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[
        { id: 'fees', label: 'Fees' }, { id: 'general', label: 'General' }, { id: 'profit', label: 'Profit sharing' }, { id: 'crm', label: 'CRM' },
        { id: 'automation', label: 'Automation' }, { id: 'audit', label: 'Audit log' }, { id: 'privacy', label: 'Privacy & data' }, ...(isSA ? [{ id: 'data' as Tab, label: 'Backup & demo' }] : []),
      ]} />
      {tab === 'general' && <General />}
      {tab === 'fees' && <Fees />}
      {tab === 'profit' && <Shares />}
      {tab === 'crm' && <Crm />}
      {tab === 'automation' && <Automation />}
      {tab === 'audit' && <Audit />}
      {tab === 'privacy' && <Privacy />}
      {tab === 'data' && isSA && <Data />}
      {!S.allowed('settings', 'edit', db) && <p className="text-muted mt-3">View only — your role cannot change settings.</p>}
    </>
  );
}

function General() {
  const db = S.useDB();
  const run = useRun();
  const [name, setName] = useState(db.settings.academyName);
  const [inv, setInv] = useState(db.settings.invoice);
  const setI = (k: keyof typeof inv) => (e: { target: { value: string } }) => setInv({ ...inv, [k]: e.target.value });
  const invDirty = (Object.keys(inv) as (keyof typeof inv)[]).some((k) => inv[k] !== db.settings.invoice[k]);
  return (
    <div className="space-y-4 max-w-xl">
      <Card className="p-5 space-y-3">
        <Field label="Academy name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <p className="text-muted text-xs">Time zone: Asia/Kolkata (IST). Currency: Indian Rupee (₹). Money is stored in whole paise.</p>
        <Button variant="primary" disabled={name === db.settings.academyName || !name.trim()} onClick={() => run(() => S.updateSettings({ academyName: name }), 'Saved')}>Save</Button>
      </Card>
      <Card className="p-5 space-y-3">
        <div><h3 className="font-semibold">Invoice details</h3><p className="text-muted text-xs mt-0.5">Printed at the top of every fee invoice. Leave blank to hide a line.</p></div>
        <Field label="Address"><Input value={inv.address} onChange={setI('address')} placeholder="Office address, city, PIN" /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Phone"><Input value={inv.phone} onChange={setI('phone')} /></Field>
          <Field label="Email"><Input value={inv.email} onChange={setI('email')} /></Field>
        </div>
        <Field label="GSTIN" hint="Shown only if your academy is GST-registered"><Input value={inv.gstin} onChange={setI('gstin')} /></Field>
        <Field label="Footer note" hint="e.g. Fees once paid are non-refundable except as per policy."><Input value={inv.note} onChange={setI('note')} /></Field>
        <Button variant="primary" disabled={!invDirty} onClick={() => run(() => S.updateSettings({ invoice: { ...inv, gstin: inv.gstin.trim().toUpperCase() } }), 'Invoice details saved')}>Save invoice details</Button>
      </Card>
    </div>
  );
}

function Fees() {
  const db = S.useDB();
  const run = useRun();
  const { ask } = useUI();
  const s = db.settings;
  const [gst, setGst] = useState(String(s.gstRateBp / 100));
  const [offsets, setOffsets] = useState(s.reminderOffsets.join(', '));
  const choose = async (p: 'additional' | 'credited') => {
    if (s.bookingPolicy === p) return;
    if (s.bookingPolicy && !(await ask({ title: 'Change booking policy?', message: 'Applies to new admissions only. Existing fee plans keep their policy.', confirm: 'Change policy' }))) return;
    run(() => S.updateSettings({ bookingPolicy: p }), 'Booking policy saved');
  };
  return (
    <div className="space-y-4 max-w-3xl">
      <Card className="p-5">
        <h3 className="font-semibold">Booking amount policy {!s.bookingPolicy && <Badge tone="red">Required</Badge>}</h3>
        <p className="text-muted mt-0.5 mb-4">How the ₹500–₹1,000 booking amount relates to the ₹3,000 + ₹3,000 + ₹1,500 instalments. Admissions are blocked until you choose.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {([['additional', 'Additional', 'Student pays booking + ₹7,500. Example: ₹1,000 + ₹7,500 = ₹8,500.'], ['credited', 'Credited against fee', 'Booking is part of ₹7,500 and reduces the last instalment(s). Example: ₹1,000 + 3,000 + 3,000 + 500.']] as const).map(([id, t, d]) => (
            <button key={id} onClick={() => choose(id)} disabled={!S.allowed('settings', 'edit', db)} className={cx('text-left rounded-xl border p-4', s.bookingPolicy === id ? 'border-accent bg-accent-soft ring-3 ring-accent/10' : 'border-line hover:bg-surface')}>
              <div className="font-medium">{t}</div><div className="text-muted text-[12.5px] mt-1">{d}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="font-semibold mb-2">Instalment clock</h3>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2"><input type="radio" checked={s.startEvent === 'admission'} onChange={() => run(() => S.updateSettings({ startEvent: 'admission' }), 'Saved')} /> First instalment 7 days after admission</label>
            <label className="flex items-center gap-2"><input type="radio" checked={s.startEvent === 'batch_start'} onChange={() => run(() => S.updateSettings({ startEvent: 'batch_start' }), 'Saved')} /> 7 days after batch start</label>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 items-end">
          <Field label="GST included in fees (%)" hint="0 if not registered. Used to separate statutory liability from revenue."><Input value={gst} onChange={(e) => setGst(e.target.value)} /></Field>
          <Button className="w-fit" disabled={+gst * 100 === s.gstRateBp || isNaN(+gst)} onClick={() => run(() => S.updateSettings({ gstRateBp: Math.round(+gst * 100) }), 'Saved')}>Save GST</Button>
          <Field label="Reminder schedule (days from due date)" hint="Negative = before. Default: -2, 0, 1, 3"><Input value={offsets} onChange={(e) => setOffsets(e.target.value)} /></Field>
          <Button className="w-fit" onClick={() => { const v = offsets.split(',').map((x) => parseInt(x.trim(), 10)); run(() => { if (v.some(isNaN)) throw new S.AppError('Use whole numbers separated by commas.'); S.updateSettings({ reminderOffsets: v }); }, 'Saved'); }}>Save reminders</Button>
        </div>
        <p className="text-xs text-muted">Course fee amounts are edited in Fee Management → Course fee structure.</p>
      </Card>
    </div>
  );
}

function Shares() {
  const db = S.useDB();
  const run = useRun();
  const [rows, setRows] = useState(db.settings.shares.map((s) => ({ name: s.name, pct: String(s.pctBp / 100) })));
  const total = rows.reduce((a, r) => a + Math.round(parseFloat(r.pct || '0') * 100), 0);
  const isSA = S.currentUser()?.role === 'super_admin';
  return (
    <Card className="p-5 max-w-xl">
      <h3 className="font-semibold">Profit-sharing structure</h3>
      <p className="text-muted mb-4">Applied to distributable profit of approved, closed periods. Must total exactly 100%. Super Admin only.</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <Input value={r.name} disabled={!isSA} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <Input value={r.pct} disabled={!isSA} className="w-24" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
            <span className="self-center text-muted">%</span>
            {isSA && rows.length > 1 && <Button variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</Button>}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-4">
        <span className={total === 10000 ? 'text-ok' : 'text-bad'}>Total {(total / 100).toFixed(2)}%</span>
        {isSA && <div className="flex gap-2"><Button onClick={() => setRows([...rows, { name: '', pct: '0' }])}>+ Person</Button>
          <Button variant="primary" disabled={total !== 10000 || rows.some((r) => !r.name.trim())} onClick={() => run(() => S.updateSettings({ shares: rows.map((r) => ({ name: r.name.trim(), pctBp: Math.round(parseFloat(r.pct) * 100) })) }), 'Shares saved — applies to new distributions')}>Save</Button></div>}
      </div>
    </Card>
  );
}

function Crm() {
  const db = S.useDB();
  const run = useRun();
  const [list, setList] = useState(db.settings.leadStatuses.join('\n'));
  const LOCKED = ['New', 'Not Contacted', 'Connected', 'Warm', 'Hot', 'Call Later', 'Converted', 'Cold', 'Lost'];
  return (
    <Card className="p-5 max-w-xl">
      <h3 className="font-semibold">Lead pipeline statuses</h3>
      <p className="text-muted mb-3">One per line, in pipeline order. Core statuses used by automation (New, Hot, Converted, Lost…) cannot be removed.</p>
      <textarea className="w-full min-h-56 rounded-lg border border-line p-3 font-mono text-[13px]" value={list} onChange={(e) => setList(e.target.value)} />
      <Button variant="primary" className="mt-3" onClick={() => {
        const v = [...new Set(list.split('\n').map((x) => x.trim()).filter(Boolean))];
        run(() => { const missing = LOCKED.filter((x) => !v.includes(x)); if (missing.length) throw new S.AppError(`Keep the core statuses: ${missing.join(', ')}`); S.updateSettings({ leadStatuses: v }); }, 'Statuses saved');
      }}>Save statuses</Button>
    </Card>
  );
}

function Automation() {
  const db = S.useDB();
  const run = useRun();
  return (
    <Card className="max-w-3xl">
      <CardHeader title="Automation rules" sub="Runs on app open and every minute. Every generated item has a unique key, so retries never duplicate reminders, expenses or certificates." />
      <div className="divide-y divide-line">
        {S.RULES.map((r) => (
          <label key={r.id} className="flex items-center justify-between px-4 py-3 cursor-pointer">
            <span>{r.label}</span>
            <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={!!db.settings.rules[r.id]} disabled={!S.allowed('settings', 'edit', db)}
              onChange={(e) => run(() => S.updateSettings({ rules: { ...db.settings.rules, [r.id]: e.target.checked } }), 'Rule updated')} />
          </label>
        ))}
      </div>
      <div className="px-4 py-3 border-t border-line text-xs text-muted">Channels: in-app notifications (active). WhatsApp hand-off link on reminders (staff sends). SMS / WhatsApp Business API / email providers plug in with the backend and respect student opt-outs.</div>
    </Card>
  );
}

function Audit() {
  const db = S.useDB();
  const [q, setQ] = useState('');
  const t = q.toLowerCase();
  const rows = db.audit.filter((a) => !t || a.action.includes(t) || a.detail.toLowerCase().includes(t) || a.entityId.toLowerCase().includes(t) || S.empName(a.by, db).toLowerCase().includes(t));
  return (
    <>
      <SearchInput value={q} onChange={setQ} placeholder="Filter by action, person, ID…" className="w-full sm:w-72 mb-3" />
      <Card>
        <Table rows={rows} rowKey={(a) => a.id} pageSize={100} empty={<Empty title="No audit entries" />} cols={[
          { key: 'a', label: 'When', render: (a) => fmtDateTime(a.at) }, { key: 'b', label: 'Who', render: (a) => S.empName(a.by, db) },
          { key: 'c', label: 'Action', render: (a) => <span className="font-medium">{a.action}</span> }, { key: 'e', label: 'Record', render: (a) => <span className="text-muted">{a.entity} {a.entityId.slice(0, 18)}</span> },
          { key: 'd', label: 'Detail', render: (a) => <span className="whitespace-normal">{a.detail}</span> },
        ]} />
      </Card>
    </>
  );
}

function Privacy() {
  const db = S.useDB();
  const withId = db.students.filter((s) => s.idDoc).length;
  return (
    <div className="space-y-4 max-w-3xl">
      <Card className="p-5 space-y-2 text-zinc-700">
        <h3 className="font-semibold text-ink">How personal data is handled</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Identity documents need recorded consent. We keep only the document type, a masked number (last 4 characters) and the name. Images and full Aadhaar numbers are never stored.</li>
          <li>Aadhaar is optional. PAN, Driving Licence, Passport and Voter ID are accepted too, and a photographed card is not treated as authenticated Aadhaar.</li>
          <li>Identity records can only be viewed with the "Sensitive records" permission. Every view, capture and deletion is written to the access log.</li>
          <li>Callers cannot see fees, payments, profit, certificates or identity data, and they only see leads assigned to them.</li>
          <li>Students can opt out of payment reminders from their profile.</li>
          <li>To delete an identity record, use the student's Documents tab. Export a student's data from Students → Export.</li>
        </ul>
        <p className="text-xs text-muted pt-2">For the backend phase: encrypted at-rest storage, private buckets with signed URLs, server-side RLS, retention jobs and a published DPDP privacy notice.</p>
      </Card>
      <Card className="p-5"><div className="text-muted">Students with an identity record on file</div><div className="text-[22px] font-semibold">{withId}</div></Card>
    </div>
  );
}

function Data() {
  const run = useRun();
  const { ask, toast } = useUI();
  const db = S.useDB();
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4 max-w-3xl">
      <Card className="p-5">
        <h3 className="font-semibold">Backup</h3>
        <p className="text-muted mb-3">All data currently lives on this device (IndexedDB) until the cloud database is connected. Download a backup regularly.</p>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => run(() => { const blob = new Blob([S.exportBackup()], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `academy-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); })}>Download backup</Button>
          <label className="inline-flex items-center h-9 px-3.5 rounded-lg border border-line font-medium cursor-pointer hover:bg-surface">Restore backup<input type="file" accept="application/json" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            const txt = await f.text();
            if (await ask({ title: 'Restore this backup?', message: 'All current data on this device will be replaced.', confirm: 'Restore', danger: true })) run(() => S.restoreBackup(txt), 'Backup restored');
          }} /></label>
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="font-semibold">Demo data</h3>
        <p className="text-muted mb-3">Adds clearly labelled sample staff, batches, leads, students, payments and expenses for the last 6 months, so you can try every screen. Clear it before going live.</p>
        <Button disabled={busy || db.students.length > 0} loading={busy} onClick={async () => {
          if (!db.settings.bookingPolicy) return toast('Choose the booking policy in Settings → Fees first.', 'bad');
          setBusy(true); await new Promise((r) => setTimeout(r, 30));
          run(() => loadDemo(), 'Demo data loaded'); setBusy(false);
        }}>{db.students.length ? 'Only available on an empty academy' : 'Load demo data'}</Button>
      </Card>
      <Card className="p-5 border-bad/30">
        <h3 className="font-semibold text-bad">Erase all data</h3>
        <p className="text-muted mb-3">Permanently deletes every record on this device. Download a backup first.</p>
        <Button variant="danger" onClick={async () => { const r = await ask({ title: 'Erase everything?', message: 'This cannot be undone. Type ERASE to confirm.', input: 'Type ERASE', confirm: 'Erase all data', danger: true }); if (r === 'ERASE') run(() => S.resetAll()); else if (r) toast('Not erased — confirmation text did not match.', 'bad'); }}>Erase all data</Button>
      </Card>
    </div>
  );
}

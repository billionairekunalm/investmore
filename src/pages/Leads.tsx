import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Button, Card, CardHeader, Empty, Field, Modal, PageHeader, SearchInput, Select, Table, Tabs, useRun, useUI, cx } from '../ui/kit';
import { CallButton, useCall } from '../ui/shell';
import { LeadModal } from '../ui/modals';
import { AdmissionForm } from './Admissions';
import { callingQueue, checkImport, guessMapping, IMPORT_FIELDS, roundRobin, TIER_LABELS, type ImportCheck, type ImportField } from '../domain/leads';
import { LEAD_SOURCES, type Lead } from '../domain/types';
import { fmtDate, fmtDateTime, fmtPhone, inRange, todayIST } from '../domain/util';
import { downloadCSV, readSheet } from '../lib/export';
import { useRange } from '../ui/shell';
import { StatTile } from './Dashboard';

type View = 'pipeline' | 'list' | 'calling' | 'import' | 'performance';

export default function Leads() {
  const db = S.useDB();
  const me = S.useMe()!;
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('view') as View) || (me.role === 'caller' ? 'calling' : 'pipeline');
  const setView = (v: View) => { sp.set('view', v); setSp(sp, { replace: true }); };
  const [q, setQ] = useState('');
  const [fCaller, setFCaller] = useState('');
  const [fSource, setFSource] = useState(sp.get('source') ?? '');
  const [fStatus, setFStatus] = useState(sp.get('status') ?? '');
  const [edit, setEdit] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const openId = sp.get('lead');
  const leads = S.visibleLeads(db);
  const isManager = me.role !== 'caller';
  const callers = db.employees.filter((e) => e.active && (e.role === 'caller' || e.role === 'calling_manager'));

  const filtered = leads.filter((l) =>
    (!q || l.name.toLowerCase().includes(q.toLowerCase()) || l.phone.includes(q) || l.id.toLowerCase().includes(q.toLowerCase()) || l.campaign.toLowerCase().includes(q.toLowerCase())) &&
    (!fCaller || l.assignedTo === fCaller) && (!fSource || l.source === fSource) && (!fStatus || l.status === fStatus));

  // follow-ups due as of today (same rule as the calling queue): open leads with a follow-up date today or earlier
  const today = todayIST();
  const due = leads.filter((l) => l.nextFollowUp && l.nextFollowUp <= today && l.status !== 'Converted' && l.status !== 'Lost');
  const dueToday = due.filter((l) => l.nextFollowUp === today).length;

  const tabs: { id: View; label: string; count?: number }[] = [
    { id: 'calling', label: 'Calling queue', count: callingQueue(leads, todayIST()).filter((l) => l.tier <= 2).length },
    { id: 'pipeline', label: 'Pipeline' }, { id: 'list', label: 'All leads', count: leads.length },
    ...(S.allowed('leads', 'create', db) && isManager ? [{ id: 'import' as View, label: 'Import' }] : []),
    ...(isManager ? [{ id: 'performance' as View, label: 'Team performance' }] : []),
  ];
  const filters = (
    <div className="flex flex-wrap gap-2 mb-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search name, mobile, campaign" className="w-full sm:w-64" />
      {isManager && <Select value={fCaller} onChange={(e) => setFCaller(e.target.value)} placeholder="All callers" options={callers.map((c) => ({ value: c.id, label: c.name }))} className="w-40" />}
      <Select value={fSource} onChange={(e) => setFSource(e.target.value)} placeholder="All sources" options={LEAD_SOURCES} className="w-36" />
      {view !== 'pipeline' && <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} placeholder="All statuses" options={db.settings.leadStatuses} className="w-36" />}
    </div>
  );

  return (
    <>
      <PageHeader title="Leads CRM" sub={`${leads.length} leads${me.role === 'caller' ? ' assigned to you' : ''}`}
        actions={S.allowed('leads', 'create', db) && <Button variant="primary" onClick={() => setAdding(true)}>+ New lead</Button>} />
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-5">
        <StatTile color="#0f766e" icon="phone" label="Follow-ups due" scope="As of today" value={due.length} to="/leads?view=calling"
          subs={[['Due today', dueToday], ['Missed earlier', due.length - dueToday]]} />
      </div>
      <Tabs tabs={tabs} value={view} onChange={setView} />
      {view === 'calling' && <CallingQueue leads={filtered} filters={filters} onOpen={(id) => { sp.set('lead', id); setSp(sp); }} />}
      {view === 'pipeline' && <>{filters}<Pipeline leads={filtered} onOpen={(id) => { sp.set('lead', id); setSp(sp); }} /></>}
      {view === 'list' && <>{filters}<LeadList leads={filtered} onOpen={(id) => { sp.set('lead', id); setSp(sp); }} /></>}
      {view === 'import' && <ImportLeads />}
      {view === 'performance' && <Performance />}
      <LeadModal open={adding || !!edit} leadId={edit ?? undefined} onClose={() => { setAdding(false); setEdit(null); }} />
      {openId && <LeadDetail id={openId} onClose={() => { sp.delete('lead'); setSp(sp); }} onEdit={() => setEdit(openId)} />}
    </>
  );
}

function CallingQueue({ leads, filters, onOpen }: { leads: Lead[]; filters: React.ReactNode; onOpen: (id: string) => void }) {
  const db = S.useDB();
  const q = callingQueue(leads, todayIST());
  const { log } = useCall();
  return (
    <>
      {filters}
      <Card>
        {!q.length ? <Empty title="Queue is clear" body="No open leads match these filters. New and imported leads appear here automatically." /> : (
          <div className="divide-y divide-line">
            {q.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-surface/60">
                <div className="w-1 self-stretch rounded-full" style={{ background: ['', '#dc2626', '#ea7a2b', '#028a02', '#a1a1aa', '#e4e4e7'][l.tier] }} />
                <button onClick={() => onOpen(l.id)} className="text-left min-w-0 flex-1 basis-48">
                  <div className="font-medium">{l.name} <span className="text-muted font-normal">· {fmtPhone(l.phone)}</span></div>
                  <div className="text-xs text-muted mt-0.5">{TIER_LABELS[l.tier]} · {l.source}{l.campaign && ` / ${l.campaign}`} · {S.empName(l.assignedTo, db)}</div>
                </button>
                <div className="text-xs text-muted w-40"><div>Last: {l.lastCallAt ? fmtDateTime(l.lastCallAt) : 'never called'}</div><div>Next: {l.nextFollowUp ? fmtDate(l.nextFollowUp) : '—'}</div></div>
                <Badge>{l.status}</Badge>
                <div className="flex gap-1.5">
                  <CallButton target={{ entity: 'lead', id: l.id, name: l.name, phone: l.phone }} />
                  <Button size="sm" variant="ghost" onClick={() => log({ entity: 'lead', id: l.id, name: l.name, phone: l.phone })}>Log</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function Pipeline({ leads, onOpen }: { leads: Lead[]; onOpen: (id: string) => void }) {
  const db = S.useDB();
  const run = useRun();
  const [drag, setDrag] = useState<string | null>(null);
  const [convert, setConvert] = useState<string | null>(null);
  const drop = (status: string) => {
    if (!drag) return;
    if (status === 'Converted') setConvert(drag);
    else run(() => S.setLeadStatus(drag, status));
    setDrag(null);
  };
  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-3 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x">
        {db.settings.leadStatuses.map((st) => {
          const col = leads.filter((l) => l.status === st);
          return (
            <div key={st} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(st)} className="snap-start shrink-0 w-64 rounded-xl bg-surface border border-line flex flex-col max-h-[70vh]">
              <div className="px-3 py-2.5 flex items-center justify-between"><Badge>{st}</Badge><span className="text-xs text-muted tabular">{col.length}</span></div>
              <div className="px-2 pb-2 space-y-2 overflow-y-auto">
                {col.map((l) => (
                  <div key={l.id} draggable={st !== 'Converted'} onDragStart={() => setDrag(l.id)} onClick={() => onOpen(l.id)}
                    className={cx('rounded-lg bg-white border border-line p-2.5 cursor-pointer hover:border-zinc-300', drag === l.id && 'opacity-50')}>
                    <div className="font-medium truncate">{l.name}</div>
                    <div className="text-xs text-muted mt-0.5">{fmtPhone(l.phone)} · {l.source}</div>
                    <div className="flex items-center justify-between mt-2 text-[11px] text-muted">
                      <span>{S.empName(l.assignedTo, db)}</span>
                      {l.nextFollowUp && <span className={l.nextFollowUp < todayIST() ? 'text-bad font-medium' : ''}>↻ {fmtDate(l.nextFollowUp)}</span>}
                    </div>
                  </div>
                ))}
                {!col.length && <div className="text-center text-xs text-zinc-400 py-6">Drop leads here</div>}
              </div>
            </div>
          );
        })}
      </div>
      <ConvertModal leadId={convert} onClose={() => setConvert(null)} />
    </>
  );
}

function LeadList({ leads, onOpen }: { leads: Lead[]; onOpen: (id: string) => void }) {
  const db = S.useDB();
  const run = useRun();
  const me = S.useMe()!;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [to, setTo] = useState('');
  const callers = db.employees.filter((e) => e.active && (e.role === 'caller' || e.role === 'calling_manager'));
  return (
    <Card>
      {sel.size > 0 && me.role !== 'caller' && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-line bg-accent-soft/50">
          <span className="font-medium">{sel.size} selected</span>
          <Select value={to} onChange={(e) => setTo(e.target.value)} placeholder="Assign to…" options={callers.map((c) => ({ value: c.id, label: c.name }))} className="w-44 h-8" />
          <Button size="sm" variant="primary" disabled={!to} onClick={() => { run(() => S.assignLeads([...sel], to), `${sel.size} leads assigned`); setSel(new Set()); }}>Assign</Button>
          <Button size="sm" variant="ghost" onClick={() => downloadCSV(leads.filter((l) => sel.has(l.id)).map(leadRow(db)), 'leads')}>Export</Button>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
        </div>
      )}
      <Table rows={leads} rowKey={(l) => l.id} onRow={(l) => onOpen(l.id)} selectable={me.role !== 'caller'} selected={sel} onSelect={setSel}
        empty={<Empty title="No leads" body="Add a lead or import a spreadsheet to get started." />}
        cols={[
          { key: 'id', label: 'ID', render: (l) => <span className="text-muted">{l.id}</span>, sort: (l) => l.id },
          { key: 'name', label: 'Name', render: (l) => <span className="font-medium">{l.name}</span>, sort: (l) => l.name },
          { key: 'phone', label: 'Mobile', render: (l) => fmtPhone(l.phone) },
          { key: 'src', label: 'Source', render: (l) => <>{l.source}{l.campaign && <span className="text-muted"> · {l.campaign}</span>}</>, sort: (l) => l.source },
          { key: 'status', label: 'Status', render: (l) => <Badge>{l.status}</Badge>, sort: (l) => l.status },
          { key: 'int', label: 'Interest', render: (l) => l.interest },
          { key: 'who', label: 'Caller', render: (l) => S.empName(l.assignedTo, db) },
          { key: 'last', label: 'Last call', render: (l) => (l.lastCallAt ? fmtDateTime(l.lastCallAt) : '—'), sort: (l) => l.lastCallAt ?? '' },
          { key: 'next', label: 'Follow-up', render: (l) => <span className={l.nextFollowUp && l.nextFollowUp < todayIST() ? 'text-bad' : ''}>{fmtDate(l.nextFollowUp)}</span>, sort: (l) => l.nextFollowUp ?? '9' },
          { key: 'c', label: 'Created', render: (l) => fmtDate(l.createdAt.slice(0, 10)), sort: (l) => l.createdAt },
        ]} />
    </Card>
  );
}
const leadRow = (db: ReturnType<typeof S.getDB>) => (l: Lead) => ({
  'Lead ID': l.id, Name: l.name, Mobile: l.phone, Email: l.email, Source: l.source, Campaign: l.campaign, Status: l.status, Interest: l.interest,
  Caller: S.empName(l.assignedTo, db), 'Last call': l.lastCallAt ?? '', 'Next follow-up': l.nextFollowUp ?? '', Notes: l.notes, Created: l.createdAt.slice(0, 10),
});

function LeadDetail({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: () => void }) {
  const db = S.useDB();
  const run = useRun();
  const { log } = useCall();
  const [convert, setConvert] = useState(false);
  const l = S.visibleLeads(db).find((x) => x.id === id);
  if (!l) return <Modal open onClose={onClose} title="Lead"><Empty title="Lead not found or not assigned to you" /></Modal>;
  const calls = db.calls.filter((c) => c.entity === 'lead' && c.entityId === id);
  const student = db.students.find((s) => s.id === l.convertedStudentId);
  return (
    <>
      <Modal open onClose={onClose} title={<>{l.name} <span className="text-muted font-normal">· {l.id}</span></>} wide
        footer={l.status !== 'Converted' ? <>
          <Button onClick={onEdit}>Edit</Button>
          <Button onClick={() => log({ entity: 'lead', id, name: l.name, phone: l.phone })}>Log call</Button>
          {S.allowed('admissions', 'create', db) && <Button variant="primary" onClick={() => setConvert(true)}>Convert to student</Button>}
        </> : student && <a href={`/students/${student.id}`} className="text-accent font-medium">Open student {student.code} →</a>}>
        <div className="grid sm:grid-cols-3 gap-4 mb-5">
          <Info k="Mobile" v={<span className="flex items-center gap-2">{fmtPhone(l.phone)} <CallButton target={{ entity: 'lead', id, name: l.name, phone: l.phone }} /></span>} />
          <Info k="Email" v={l.email || '—'} />
          <Info k="Source" v={`${l.source}${l.campaign ? ` · ${l.campaign}` : ''}`} />
          <Info k="Assigned caller" v={S.empName(l.assignedTo, db)} />
          <Info k="Interest" v={l.interest} />
          <Info k="Created" v={fmtDateTime(l.createdAt)} />
          <Info k="Status" v={l.status === 'Converted' ? <Badge>Converted</Badge> : (
            <Select value={l.status} onChange={(e) => (e.target.value === 'Converted' ? setConvert(true) : run(() => S.setLeadStatus(id, e.target.value), 'Status updated'))} options={db.settings.leadStatuses} className="h-8" />
          )} />
          <Info k="Next follow-up" v={fmtDate(l.nextFollowUp)} />
          <Info k="Last call" v={l.lastCallAt ? fmtDateTime(l.lastCallAt) : '—'} />
        </div>
        {l.notes && <div className="rounded-lg bg-surface border border-line p-3 mb-5 text-zinc-700 whitespace-pre-wrap">{l.notes}</div>}
        <h4 className="font-semibold mb-2">Call history</h4>
        {!calls.length ? <p className="text-muted">No calls logged yet.</p> : (
          <ol className="space-y-2">
            {calls.map((c) => (
              <li key={c.id} className="flex gap-3"><Badge>{c.outcome}</Badge><div className="flex-1"><div className="text-xs text-muted">{fmtDateTime(c.at)} · {S.empName(c.by, db)}{c.nextFollowUp && ` · follow-up ${fmtDate(c.nextFollowUp)}`}</div>{c.notes && <div>{c.notes}</div>}</div></li>
            ))}
          </ol>
        )}
      </Modal>
      <ConvertModal leadId={convert ? id : null} onClose={() => setConvert(false)} />
    </>
  );
}
const Info = ({ k, v }: { k: string; v: React.ReactNode }) => <div><div className="text-xs text-muted mb-0.5">{k}</div><div>{v}</div></div>;

export function ConvertModal({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  return (
    <Modal open={!!leadId} onClose={onClose} title="Convert lead to student" wide>
      {leadId && <AdmissionForm leadId={leadId} onDone={onClose} />}
    </Modal>
  );
}

// ------------------------------------------------------------------ import
function ImportLeads() {
  const db = S.useDB();
  const run = useRun();
  const { toast } = useUI();
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: Record<string, unknown>[] } | null>(null);
  const [map, setMap] = useState<Partial<Record<ImportField, string>>>({});
  const [source, setSource] = useState('Meta Ads');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [tab, setTab] = useState<'valid' | 'duplicates' | 'invalid'>('valid');
  const [result, setResult] = useState<ReturnType<typeof S.importLeads> | null>(null);
  const callers = db.employees.filter((e) => e.active && e.role === 'caller');
  const existing = useMemo(() => new Set([...db.leads.map((l) => l.phone), ...db.students.flatMap((s) => [s.phone, s.altPhone])]), [db]);
  const check: ImportCheck | null = file && map.phone && map.name ? checkImport(file.rows, map, existing, source) : null;

  const onFile = async (f?: File) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return toast('File is larger than 10 MB.', 'bad');
    try {
      const s = await readSheet(f);
      if (!s.rows.length) return toast('No rows found in the first sheet.', 'bad');
      setFile({ name: f.name, ...s }); setMap(guessMapping(s.headers)); setResult(null);
    } catch { toast('Could not read this file. Upload a .xlsx, .xls or .csv file.', 'bad'); }
  };
  const doImport = () => {
    if (!check || !file) return;
    const assigned = roundRobin(check.valid, assignees);
    const errors = [...check.duplicates, ...check.invalid].map((r) => ({ row: r.row, reason: r.reason, data: r.data }));
    const job = run(() => S.importLeads(file.name, assigned.map(({ item, assignee }) => ({ ...item, assignee })), errors, { total: file.rows.length, duplicates: check.duplicates.length, invalid: check.invalid.length }));
    if (job) { setResult(job); setFile(null); }
  };
  const errorReport = (job: { errors: { row: number; reason: string; data: Record<string, string> }[]; fileName: string }) =>
    downloadCSV(job.errors.map((e) => ({ Row: e.row, Reason: e.reason, ...e.data })), `import-errors-${job.fileName.replace(/\.\w+$/, '')}`);

  if (result) return (
    <Card className="p-6">
      <h3 className="font-semibold text-[15px]">Import complete — {result.fileName}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 my-5">
        <Sum k="Rows in file" v={result.total} /><Sum k="Imported" v={result.imported} tone="text-ok" /><Sum k="Duplicates" v={result.duplicates} tone="text-warn" /><Sum k="Invalid" v={result.invalid} tone="text-bad" />
      </div>
      <div className="flex gap-2">
        {result.errors.length > 0 && <Button onClick={() => errorReport(result)}>Download error report</Button>}
        <Button variant="primary" onClick={() => setResult(null)}>Import another file</Button>
      </div>
    </Card>
  );

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-semibold">1. Upload spreadsheet</h3>
        <p className="text-muted mt-0.5 mb-3">XLSX, XLS or CSV with a header row — e.g. a Meta Lead Ads export.</p>
        <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-line py-8 cursor-pointer hover:bg-surface">
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          <span className="font-medium">{file ? file.name : 'Choose file'}</span>
          <span className="text-xs text-muted mt-1">{file ? `${file.rows.length} rows · ${file.headers.length} columns` : 'or drop it here'}</span>
        </label>
      </Card>
      {file && (
        <Card className="p-5">
          <h3 className="font-semibold mb-3">2. Map columns</h3>
          <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {IMPORT_FIELDS.map((f) => (
              <Field key={f} label={f[0].toUpperCase() + f.slice(1)} required={f === 'name' || f === 'phone'}>
                <Select value={map[f] ?? ''} onChange={(e) => setMap({ ...map, [f]: e.target.value || undefined })} placeholder="— not in file —" options={file.headers} />
              </Field>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            <Field label="Default source" hint="Used when the source column is empty or not mapped"><Select value={source} onChange={(e) => setSource(e.target.value)} options={LEAD_SOURCES} /></Field>
            <Field label="Assign to callers" hint={assignees.length ? `Round-robin across ${assignees.length} callers` : 'Leave empty to keep unassigned'}>
              <div className="flex flex-wrap gap-1.5">
                {callers.map((c) => (
                  <button key={c.id} onClick={() => setAssignees(assignees.includes(c.id) ? assignees.filter((x) => x !== c.id) : [...assignees, c.id])}
                    className={cx('rounded-full border px-2.5 h-7 text-[12.5px]', assignees.includes(c.id) ? 'border-accent bg-accent-soft text-accent' : 'border-line')}>{c.name}</button>
                ))}
                {!callers.length && <span className="text-muted text-xs">No callers yet — add them in Employees.</span>}
              </div>
            </Field>
          </div>
        </Card>
      )}
      {check && file && (
        <Card>
          <CardHeader title="3. Review & import" sub="Every row is accounted for. Nothing is dropped silently."
            right={<Button variant="primary" disabled={!check.valid.length} onClick={doImport}>Import {check.valid.length} leads</Button>} />
          <div className="px-4">
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'valid', label: 'Valid', count: check.valid.length }, { id: 'duplicates', label: 'Duplicates', count: check.duplicates.length }, { id: 'invalid', label: 'Invalid', count: check.invalid.length }]} />
          </div>
          <Table rows={(check[tab] as any[]).slice(0, 200)} rowKey={(r) => String(r.row)} pageSize={20} empty={<Empty title={`No ${tab} rows`} />}
            cols={[
              { key: 'row', label: 'Row', render: (r) => <span className="text-muted">{r.row}</span> },
              { key: 'name', label: 'Name', render: (r) => r.name || <span className="text-bad">missing</span> },
              { key: 'phone', label: 'Mobile', render: (r) => r.phone },
              { key: 'email', label: 'Email', render: (r) => r.email },
              { key: 'source', label: 'Source', render: (r) => r.source },
              ...(tab !== 'valid' ? [{ key: 'reason', label: 'Reason', render: (r: any) => <span className={tab === 'invalid' ? 'text-bad' : 'text-warn'}>{r.reason}</span> }] : []),
            ]} />
        </Card>
      )}
      {!!db.imports.length && (
        <Card>
          <CardHeader title="Import history" />
          <Table rows={db.imports} rowKey={(j) => j.id} cols={[
            { key: 'id', label: 'Job', render: (j) => j.id }, { key: 'f', label: 'File', render: (j) => j.fileName }, { key: 'at', label: 'When', render: (j) => fmtDateTime(j.at) },
            { key: 'by', label: 'By', render: (j) => S.empName(j.by, db) }, { key: 'n', label: 'Imported', render: (j) => <span className="text-ok">{j.imported}/{j.total}</span> },
            { key: 'd', label: 'Dup.', render: (j) => j.duplicates }, { key: 'i', label: 'Invalid', render: (j) => j.invalid },
            { key: 'e', label: '', render: (j) => j.errors.length > 0 && <Button size="sm" onClick={() => errorReport(j)}>Error report</Button> },
          ]} />
        </Card>
      )}
    </div>
  );
}
const Sum = ({ k, v, tone }: { k: string; v: number; tone?: string }) => <div><div className="text-xs text-muted">{k}</div><div className={cx('text-[22px] font-semibold tabular', tone)}>{v}</div></div>;

// ------------------------------------------------------------------ performance
const PICKED_UP = ['Connected', 'Interested', 'Not Interested', 'Call Later'];
function Performance() {
  const db = S.useDB();
  const { range } = useRange();
  const callers = db.employees.filter((e) => e.role === 'caller' || e.role === 'calling_manager');
  const calls = db.calls.filter((c) => c.entity === 'lead' && inRange(c.at, range));
  const prevFu = (callId: string, leadId: string, at: string) => db.calls.find((c) => c.entityId === leadId && c.at < at && c.id !== callId && c.nextFollowUp && c.nextFollowUp <= at.slice(0, 10));
  const rows = callers.map((e) => {
    const assigned = db.leads.filter((l) => l.assignedTo === e.id);
    const mine = calls.filter((c) => c.by === e.id);
    const connected = mine.filter((c) => PICKED_UP.includes(c.outcome)).length;
    const converted = assigned.filter((l) => l.status === 'Converted').length;
    return {
      id: e.id, name: e.name, assigned: assigned.length, attempted: mine.length, connected,
      pending: assigned.filter((l) => !l.lastCallAt && !['Converted', 'Lost'].includes(l.status)).length,
      followups: mine.filter((c) => prevFu(c.id, c.entityId, c.at)).length,
      hot: assigned.filter((l) => l.status === 'Hot' || l.status === 'Converted').length, converted,
      conv: assigned.length ? (converted / assigned.length) * 100 : 0, connectRate: mine.length ? (connected / mine.length) * 100 : 0,
    };
  });
  const bySource = LEAD_SOURCES.map((s) => {
    const ls = db.leads.filter((l) => l.source === s);
    const conv = ls.filter((l) => l.status === 'Converted').length;
    return { source: s, leads: ls.length, contacted: ls.filter((l) => l.lastCallAt).length, hot: ls.filter((l) => l.status === 'Hot').length, conv, rate: ls.length ? (conv / ls.length) * 100 : 0 };
  }).filter((x) => x.leads);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Caller performance" sub="Call activity in the selected period; conversions on all assigned leads. Ranked by conversion, not call volume." />
        <Table rows={[...rows].sort((a, b) => b.conv - a.conv)} rowKey={(r) => r.id} empty={<Empty title="No callers yet" body="Add employees with the Caller role." />} cols={[
          { key: 'n', label: 'Caller', render: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'a', label: 'Assigned', render: (r) => r.assigned, sort: (r) => r.assigned },
          { key: 't', label: 'Calls', render: (r) => r.attempted, sort: (r) => r.attempted },
          { key: 'c', label: 'Connected', render: (r) => <>{r.connected} <span className="text-muted">({r.connectRate.toFixed(0)}%)</span></>, sort: (r) => r.connected },
          { key: 'p', label: 'Not yet called', render: (r) => r.pending, sort: (r) => r.pending },
          { key: 'f', label: 'Follow-ups done', render: (r) => r.followups, sort: (r) => r.followups },
          { key: 'h', label: 'Hot generated', render: (r) => r.hot, sort: (r) => r.hot },
          { key: 'v', label: 'Converted', render: (r) => <span className="text-ok font-medium">{r.converted}</span>, sort: (r) => r.converted },
          { key: 'r', label: 'Conversion', render: (r) => `${r.conv.toFixed(1)}%`, sort: (r) => r.conv },
        ]} />
      </Card>
      <Card>
        <CardHeader title="Source performance" />
        <Table rows={bySource} rowKey={(r) => r.source} empty={<Empty title="No leads yet" />} cols={[
          { key: 's', label: 'Source', render: (r) => <span className="font-medium">{r.source}</span> }, { key: 'l', label: 'Leads', render: (r) => r.leads, sort: (r) => r.leads },
          { key: 'c', label: 'Contacted', render: (r) => r.contacted }, { key: 'h', label: 'Hot now', render: (r) => r.hot },
          { key: 'v', label: 'Converted', render: (r) => r.conv, sort: (r) => r.conv }, { key: 'r', label: 'Conversion', render: (r) => `${r.rate.toFixed(1)}%`, sort: (r) => r.rate },
        ]} />
      </Card>
    </div>
  );
}

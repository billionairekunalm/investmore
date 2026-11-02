import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Button, Card, CardHeader, Empty, Field, Modal, PageHeader, SearchInput, Select, Table, Tabs, useRun, useUI, cx } from '../ui/kit';
import { CallButton, useCall } from '../ui/shell';
import { LeadModal } from '../ui/modals';
import { AdmissionForm } from './Admissions';
import { callingQueue, checkImport, guessMapping, IMPORT_FIELDS, roundRobin, TIER_LABELS, type ImportCheck, type ImportField } from '../domain/leads';
import { LEAD_SOURCES, type Lead } from '../domain/types';
import { addDays, fmtDate, fmtDateTime, fmtPhone, inRange, todayIST } from '../domain/util';
import { downloadCSV, readSheet } from '../lib/export';
import { useRange } from '../ui/shell';

type View = 'pipeline' | 'list' | 'calling' | 'calendar' | 'import' | 'performance';

export default function Leads() {
  const db = S.useDB();
  const me = S.useMe()!;
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('view') as View) || 'calling';
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

  // the day at a glance (same rules as the calling list)
  const today = todayIST();
  const queue = callingQueue(leads, today);
  const myCallsToday = db.calls.filter((c) => c.entity === 'lead' && c.at.slice(0, 10) === today && (isManager || c.by === me.id)).length;
  const glance: [string, number, string][] = [
    ['Follow-ups due', queue.filter((l) => l.tier <= 2).length, 'text-bad'],
    ['Hot leads', queue.filter((l) => l.tier === 3).length, 'text-warn'],
    ['New, not called', queue.filter((l) => l.tier === 4).length, 'text-navy'],
    ['Calls made today', myCallsToday, 'text-accent'],
  ];

  const tabs: { id: View; label: string; count?: number }[] = [
    { id: 'calling', label: "Today's calls", count: queue.filter((l) => l.tier <= 4).length },
    { id: 'calendar', label: 'Calendar' },
    { id: 'list', label: isManager ? 'All leads' : 'My leads', count: leads.length },
    ...(isManager ? [{ id: 'pipeline' as View, label: 'Board' }] : []),
    ...(S.allowed('leads', 'create', db) && isManager ? [{ id: 'import' as View, label: 'Import' }] : []),
    ...(isManager ? [{ id: 'performance' as View, label: 'Team' }] : []),
  ];
  const filters = (
    <div className="flex flex-wrap gap-2 mb-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search name or mobile" className="w-full sm:w-72" />
      {isManager && <Select value={fCaller} onChange={(e) => setFCaller(e.target.value)} placeholder="All callers" options={callers.map((c) => ({ value: c.id, label: c.name }))} className="w-40" />}
      {view === 'list' && <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} placeholder="All statuses" options={db.settings.leadStatuses} className="w-36" />}
      {view === 'list' && isManager && <Select value={fSource} onChange={(e) => setFSource(e.target.value)} placeholder="All sources" options={LEAD_SOURCES} className="w-36" />}
    </div>
  );

  return (
    <>
      <PageHeader title="Leads" sub={`${leads.length} leads${me.role === 'caller' ? ' assigned to you' : ''}`}
        actions={S.allowed('leads', 'create', db) && <Button variant="primary" onClick={() => setAdding(true)}>+ New lead</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {glance.map(([k, v, tone]) => (
          <div key={k} className="rounded-2xl border border-line bg-white px-4 py-3 shadow-[0_1px_3px_rgba(15,35,65,.05)]">
            <div className="text-[12px] font-medium text-muted">{k}</div><div className={cx('text-[26px] font-bold tabular leading-tight', tone)}>{v}</div>
          </div>
        ))}
      </div>
      <Tabs tabs={tabs} value={view} onChange={setView} />
      {view === 'calling' && <>{filters}<CallingQueue leads={filtered} onOpen={(id) => { sp.set('lead', id); setSp(sp); }} /></>}
      {view === 'calendar' && <>{filters}<FollowUpCalendar leads={filtered} onOpen={(id) => { sp.set('lead', id); setSp(sp); }} /></>}
      {view === 'pipeline' && <>{filters}<Pipeline leads={filtered} onOpen={(id) => { sp.set('lead', id); setSp(sp); }} /></>}
      {view === 'list' && <>{filters}<LeadList leads={filtered} onOpen={(id) => { sp.set('lead', id); setSp(sp); }} /></>}
      {view === 'import' && <ImportLeads />}
      {view === 'performance' && <Performance />}
      <LeadModal open={adding || !!edit} leadId={edit ?? undefined} onClose={() => { setAdding(false); setEdit(null); }} />
      {openId && <LeadDetail id={openId} onClose={() => { sp.delete('lead'); setSp(sp); }} onEdit={() => setEdit(openId)} />}
    </>
  );
}

// ------------------------------------------------------------------ today's calls (caller-first)
const ago = (iso?: string) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : m < 2880 ? 'yesterday' : `${Math.round(m / 1440)} days ago`;
};
const STATUS_DOT: Record<string, string> = { Hot: '#dc2626', Warm: '#ea7a2b', 'Call Later': '#2563eb', Connected: '#0d9488', New: '#7c3aed', 'Not Contacted': '#a1a1aa', Cold: '#64748b' };
const lastCallOf = (db: ReturnType<typeof S.getDB>, id: string) => db.calls.find((c) => c.entity === 'lead' && c.entityId === id); // newest first

/** One lead, laid out for a caller: who, how to reach, what happened last time, what's next — and a big Call button. */
function LeadCard({ l, onOpen }: { l: Lead & { tier?: number }; onOpen: () => void }) {
  const db = S.useDB();
  const { log } = useCall();
  const today = todayIST();
  const last = lastCallOf(db, l.id);
  const overdue = l.nextFollowUp && l.nextFollowUp < today;
  const initials = l.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const target = { entity: 'lead' as const, id: l.id, name: l.name, phone: l.phone };
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5 hover:bg-surface/60">
      <button onClick={onOpen} className="flex items-start gap-3 text-left min-w-0 flex-1">
        <span className="size-11 shrink-0 rounded-full grid place-items-center text-white font-semibold text-[14px]" style={{ background: STATUS_DOT[l.status] ?? '#0a8f30' }}>{initials}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-[15px] text-ink">{l.name}</span>
            <Badge>{l.status}</Badge>
          </span>
          <span className="block text-[13.5px] font-medium tabular text-zinc-700 mt-0.5">{fmtPhone(l.phone)} <span className="text-zinc-400 font-normal">· {l.source}{l.campaign ? ` / ${l.campaign}` : ''}</span></span>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[12.5px]">
            <span className="text-zinc-500">{last ? <>Last: <b className="font-medium text-zinc-700">{last.outcome}</b> · {ago(last.at)}</> : 'Never called'}</span>
            {l.nextFollowUp && <span className={overdue ? 'text-bad font-semibold' : l.nextFollowUp === today ? 'text-warn font-semibold' : 'text-zinc-500'}>↻ {overdue ? `Follow-up was ${fmtDate(l.nextFollowUp)}` : l.nextFollowUp === today ? 'Follow-up today' : `Follow-up ${fmtDate(l.nextFollowUp)}`}</span>}
          </span>
          {l.notes && <span className="block mt-1 text-[12.5px] text-zinc-500 italic truncate">“{l.notes}”</span>}
        </span>
      </button>
      <div className="flex gap-2 sm:shrink-0 pl-14 sm:pl-0">
        <CallButton size="md" target={target} />
        <Button onClick={() => log(target)}>Log</Button>
      </div>
    </div>
  );
}

function CallingQueue({ leads, onOpen }: { leads: Lead[]; onOpen: (id: string) => void }) {
  const db = S.useDB();
  const today = todayIST();
  const q = callingQueue(leads, today);
  const [showOther, setShowOther] = useState(false);
  const [session, setSession] = useState(false);
  const groups: [string, string, (Lead & { tier: number })[]][] = [
    ['Follow-ups due', 'Call these first — they were promised a call back', q.filter((l) => l.tier <= 2)],
    ['Hot leads', 'Very interested — close them', q.filter((l) => l.tier === 3)],
    ['New leads', 'Never called yet', q.filter((l) => l.tier === 4)],
  ];
  const other = q.filter((l) => l.tier === 5);
  const toCall = q.filter((l) => l.tier <= 4 && (l.lastCallAt ?? '').slice(0, 10) !== today);
  return (
    <>
      {q.length > 0 && (
        <div className="mb-4 rounded-2xl border border-accent/20 bg-[linear-gradient(135deg,#f0faf2,#ffffff)] p-4 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <div className="font-semibold text-ink text-[15px]">{toCall.length ? `${toCall.length} lead${toCall.length === 1 ? '' : 's'} to call now` : 'All priority calls done for today 🎉'}</div>
            <div className="text-[12.5px] text-muted">One lead at a time: call, save the result, and the next one comes up.</div>
          </div>
          <Button variant="primary" className="h-11 px-5 text-[15px]" disabled={!toCall.length} onClick={() => setSession(true)}>▶ Start calling</Button>
        </div>
      )}
      {!q.length ? <Card><Empty title="No one to call" body="New and imported leads appear here automatically." /></Card> : (
        <div className="space-y-4">
          {groups.filter(([, , list]) => list.length).map(([title, sub, list]) => (
            <Card key={title} className="overflow-hidden">
              <div className="flex items-baseline gap-2 px-4 pt-3.5 pb-2 border-b border-line">
                <h3 className="font-semibold text-navy">{title}</h3><span className="text-[12.5px] text-muted tabular">{list.length}</span>
                <span className="ml-auto text-[12px] text-muted hidden sm:block">{sub}</span>
              </div>
              <div className="divide-y divide-line">{list.map((l) => <LeadCard key={l.id} l={l} onOpen={() => onOpen(l.id)} />)}</div>
            </Card>
          ))}
          {other.length > 0 && (
            <Card className="overflow-hidden">
              <button onClick={() => setShowOther(!showOther)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-surface/60">
                <h3 className="font-semibold text-navy">Other open leads</h3><span className="text-[12.5px] text-muted tabular">{other.length}</span>
                <span className="ml-auto text-[13px] font-medium text-accent">{showOther ? 'Hide' : 'Show'}</span>
              </button>
              {showOther && <div className="divide-y divide-line border-t border-line">{other.map((l) => <LeadCard key={l.id} l={l} onOpen={() => onOpen(l.id)} />)}</div>}
            </Card>
          )}
        </div>
      )}
      {session && <CallSession onClose={() => setSession(false)} onOpen={onOpen} />}
    </>
  );
}

/** "Start calling": one lead at a time. Saving the result moves to the next lead not yet called today. */
function CallSession({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const db = S.useDB();
  const { log } = useCall();
  const today = todayIST();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [done, setDone] = useState(0);
  const list = callingQueue(S.visibleLeads(db), today).filter((l) => l.tier <= 4 && (l.lastCallAt ?? '').slice(0, 10) !== today && !skipped.includes(l.id));
  const l = list[0];
  const [seen, setSeen] = useState<string | undefined>(l?.id);
  if (l && seen !== l.id) { if (seen) setDone((n) => n + 1); setSeen(l.id); } // previous lead got its result saved
  const calls = l ? db.calls.filter((c) => c.entity === 'lead' && c.entityId === l.id).slice(0, 3) : [];
  const target = l && { entity: 'lead' as const, id: l.id, name: l.name, phone: l.phone };
  return (
    <Modal open onClose={onClose} title={<span>Calling session <span className="text-muted font-normal text-[13px]">· {done} done · {list.length} left</span></span>}
      footer={l ? <>
        <Button variant="ghost" className="mr-auto" onClick={() => { setSkipped([...skipped, l.id]); setSeen(undefined); }}>Skip →</Button>
        <Button onClick={() => { onClose(); onOpen(l.id); }}>Full details</Button>
        <Button variant="primary" onClick={() => log(target!)}>Save result</Button>
      </> : <Button variant="primary" onClick={onClose}>Done</Button>}>
      {!l ? <Empty title="That's everyone for now 🎉" body={`${done} call${done === 1 ? '' : 's'} saved in this session.`} /> : (
        <div className="space-y-4">
          <div className="text-center">
            <span className="inline-block"><Badge>{TIER_LABELS[l.tier]}</Badge></span>
            <div className="mt-2 text-[24px] font-bold text-navy leading-tight">{l.name}</div>
            <a href={`tel:+91${l.phone}`} className="block mt-1 text-[22px] font-semibold tabular text-accent">{fmtPhone(l.phone)}</a>
            <div className="mt-1 text-[13px] text-muted">{l.status} · {l.source}{l.campaign ? ` / ${l.campaign}` : ''}{l.interest ? ` · ${l.interest}` : ''}</div>
          </div>
          <div className="flex justify-center"><CallButton size="md" label="Call now" target={target!} /></div>
          {l.notes && <div className="rounded-xl bg-surface border border-line p-3 text-[13px] text-zinc-700"><div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">Last note</div>{l.notes}</div>}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">Earlier calls</div>
            {!calls.length ? <p className="text-[13px] text-muted">First call to this lead.</p> : (
              <ul className="space-y-1.5">{calls.map((c) => <li key={c.id} className="flex items-center gap-2 text-[13px]"><Badge>{c.outcome}</Badge><span className="text-muted">{ago(c.at)} · {S.empName(c.by, db)}</span>{c.notes && <span className="text-zinc-600 truncate">— {c.notes}</span>}</li>)}</ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ follow-up calendar
/** Who to call on which day: follow-up dates of open leads on a month calendar; tap a day for its call list. */
function FollowUpCalendar({ leads, onOpen }: { leads: Lead[]; onOpen: (id: string) => void }) {
  const today = todayIST();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState(today);
  const open = leads.filter((l) => l.nextFollowUp && !['Converted', 'Lost'].includes(l.status));
  const byDay = new Map<string, Lead[]>();
  for (const l of open) byDay.set(l.nextFollowUp!, [...(byDay.get(l.nextFollowUp!) ?? []), l]);
  const missed = open.filter((l) => l.nextFollowUp! < today);
  const first = `${month}-01`;
  const start = addDays(first, -((new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7)); // Monday on/before the 1st
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const weeks = days[35].slice(0, 7) === month ? 6 : 5;
  const shift = (n: number) => { const [y, m] = month.split('-').map(Number); setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)); };
  const label = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${first}T00:00:00Z`));
  const list = day === 'missed' ? missed : byDay.get(day) ?? [];
  const dayName = day === 'missed' ? 'Missed follow-ups' : day === today ? 'Today' : new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line">
          <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => shift(-1)}>‹</Button>
          <Button size="sm" onClick={() => { setMonth(today.slice(0, 7)); setDay(today); }}>Today</Button>
          <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => shift(1)}>›</Button>
          <h3 className="font-semibold text-navy text-[15px] mr-auto">{label}</h3>
          {missed.length > 0 && <button onClick={() => setDay('missed')} className={cx('h-8 px-3 rounded-full text-[12.5px] font-semibold border', day === 'missed' ? 'bg-bad text-white border-bad' : 'bg-bad-soft text-bad border-bad/20')}>{missed.length} missed</button>}
        </div>
        <div className="grid grid-cols-7 bg-surface/60 border-b border-line">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="px-1.5 py-1.5 text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted text-center sm:text-left">{d}</div>)}</div>
        <div className="grid grid-cols-7">
          {days.slice(0, weeks * 7).map((d) => {
            const items = byDay.get(d) ?? [], other = d.slice(0, 7) !== month, past = d < today, sel = d === day;
            return (
              <button key={d} onClick={() => setDay(d)} aria-pressed={sel}
                className={cx('min-h-16 sm:min-h-24 border-b border-r border-line p-1 sm:p-1.5 text-left align-top transition-colors', other && 'bg-zinc-50/70', sel ? 'bg-accent-soft ring-2 ring-inset ring-accent/40' : 'hover:bg-surface')}>
                <span className={cx('inline-grid place-items-center size-6 rounded-full text-[12px] tabular', d === today ? 'bg-accent text-white font-bold' : other ? 'text-zinc-400' : 'text-zinc-700')}>{+d.slice(8)}</span>
                {items.length > 0 && <>
                  <span className={cx('mt-0.5 block w-fit rounded-md px-1.5 text-[11px] font-bold tabular', past ? 'bg-bad-soft text-bad' : d === today ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent')}>{items.length} call{items.length === 1 ? '' : 's'}</span>
                  <span className="hidden sm:block mt-0.5 space-y-0.5">{items.slice(0, 2).map((l) => <span key={l.id} className="block truncate text-[11px] text-zinc-600">{l.name}</span>)}{items.length > 2 && <span className="block text-[10.5px] text-muted">+{items.length - 2} more</span>}</span>
                </>}
              </button>
            );
          })}
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="flex items-baseline gap-2 px-4 pt-3.5 pb-2 border-b border-line">
          <h3 className="font-semibold text-navy">{dayName}</h3><span className="text-[12.5px] text-muted tabular">{list.length} to call</span>
        </div>
        {!list.length ? <Empty title="No follow-ups on this day" body="Pick another day on the calendar." /> : <div className="divide-y divide-line">{list.map((l) => <LeadCard key={l.id} l={l} onOpen={() => onOpen(l.id)} />)}</div>}
      </Card>
    </div>
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
          { key: 'name', label: 'Lead', sort: (l) => l.name, render: (l) => <div className="leading-tight"><div className="font-medium">{l.name}</div><div className="text-[12px] text-muted tabular">{fmtPhone(l.phone)}</div></div> },
          { key: 'status', label: 'Status', render: (l) => <Badge>{l.status}</Badge>, sort: (l) => l.status },
          { key: 'src', label: 'Source', render: (l) => <span className="text-zinc-600">{l.source}</span>, sort: (l) => l.source },
          { key: 'last', label: 'Last call', sort: (l) => l.lastCallAt ?? '', render: (l) => { const c = lastCallOf(db, l.id); return c ? <div className="leading-tight"><div>{c.outcome}</div><div className="text-[12px] text-muted">{ago(c.at)}</div></div> : <span className="text-muted">Never</span>; } },
          { key: 'next', label: 'Follow-up', render: (l) => <span className={l.nextFollowUp && l.nextFollowUp < todayIST() ? 'text-bad font-medium' : ''}>{l.nextFollowUp ? fmtDate(l.nextFollowUp) : '—'}</span>, sort: (l) => l.nextFollowUp ?? '9' },
          ...(me.role !== 'caller' ? [{ key: 'who', label: 'Caller', render: (l: Lead) => S.empName(l.assignedTo, db) }] : []),
          { key: 'call', label: '', className: 'text-right', render: (l) => <span onClick={(e) => e.stopPropagation()}><CallButton target={{ entity: 'lead', id: l.id, name: l.name, phone: l.phone }} /></span> },
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
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-accent/20 bg-[linear-gradient(135deg,#f0faf2,#ffffff)] p-4">
          <div className="mr-auto"><a href={`tel:+91${l.phone}`} className="text-[22px] font-bold tabular text-accent">{fmtPhone(l.phone)}</a>
            <div className="text-[12.5px] text-muted">{calls[0] ? `Last: ${calls[0].outcome} · ${ago(calls[0].at)}` : 'Never called'}{l.nextFollowUp ? ` · Follow-up ${fmtDate(l.nextFollowUp)}` : ''}</div></div>
          {l.status !== 'Converted' && <CallButton size="md" label="Call now" target={{ entity: 'lead', id, name: l.name, phone: l.phone }} />}
        </div>
        <div className="grid sm:grid-cols-3 gap-4 mb-5">
          <Info k="Email" v={l.email || '—'} />
          <Info k="Source" v={`${l.source}${l.campaign ? ` · ${l.campaign}` : ''}`} />
          <Info k="Assigned caller" v={S.empName(l.assignedTo, db)} />
          <Info k="Interest" v={l.interest} />
          <Info k="Created" v={fmtDateTime(l.createdAt)} />
          <Info k="Status" v={l.status === 'Converted' ? <Badge>Converted</Badge> : (
            <Select value={l.status} onChange={(e) => (e.target.value === 'Converted' ? setConvert(true) : run(() => S.setLeadStatus(id, e.target.value), 'Status updated'))} options={db.settings.leadStatuses} className="h-8" />
          )} />
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

import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea, useRun, Money } from './kit';
import * as S from '../store/store';
import { financeFor } from '../domain/finance';
import { invoiceWhatsApp } from '../lib/invoice';
import { FIXED_CATEGORIES, LEAD_SOURCES, NEEDS_DATE, PAY_METHODS, VARIABLE_CATEGORIES, type CallOutcome, type PayMethod } from '../domain/types';
import { addDays, fmtDate, fmtINR, parseRupees, todayIST, uid, fmtPhone } from '../domain/util';

export function PaymentModal({ open, onClose, studentId }: { open: boolean; onClose: () => void; studentId?: string }) {
  const db = S.useDB();
  const run = useRun();
  const today = todayIST();
  const key = useMemo(() => uid(), [open]); // one idempotency key per opened form
  const [sid, setSid] = useState(studentId ?? '');
  const [q, setQ] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('Cash');
  const [reference, setRef] = useState('');
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [verified, setVerified] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null); // saved payment id → success screen with the invoice
  const f = sid ? financeFor(db, sid, today) : null;
  useEffect(() => { if (open) { setSid(studentId ?? ''); setDate(today); setNotes(''); setRef(''); setMethod('Cash'); setVerified(true); setDone(null); } }, [open, studentId]);
  useEffect(() => { setAmount(f?.next ? String(f.next.remaining / 100) : ''); }, [sid, open]);
  const matches = q.length > 1 ? db.students.filter((s) => s.status !== 'Refunded' && (s.name.toLowerCase().includes(q.toLowerCase()) || s.phone.includes(q) || s.code.toLowerCase().includes(q.toLowerCase()))).slice(0, 6) : [];
  const paise = parseRupees(amount);
  const student = db.students.find((s) => s.id === sid);

  const submit = () => {
    if (paise === null) return;
    setBusy(true);
    const id = run(() => S.recordPayment({ key, studentId: sid, amount: paise, date, method, reference, notes, verified }), verified ? 'Payment recorded' : 'Payment saved — awaiting verification');
    setBusy(false);
    if (id) setDone(id);
  };

  const paid = done ? db.payments.find((x) => x.id === done) : undefined;
  if (paid && student) {
    const wa = invoiceWhatsApp(db, paid);
    return (
      <Modal open={open} onClose={onClose} title="Payment recorded"
        footer={<><Button onClick={onClose}>Done</Button><a href={`/receipt/${paid.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center h-9 px-3.5 rounded-lg bg-accent text-white font-medium hover:bg-accent-hover shadow-sm">View invoice</a></>}>
        <div className="text-center py-2">
          <div className="mx-auto size-12 rounded-full bg-accent-soft text-accent grid place-items-center"><svg viewBox="0 0 16 16" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 8.5 6 12l7.5-8" /></svg></div>
          <div className="mt-3 text-[24px] font-bold tabular">{fmtINR(paid.amount)}</div>
          <div className="text-muted">received from {student.name} · {paid.method}</div>
          <div className="mt-4 inline-flex flex-col rounded-xl border border-line bg-surface px-5 py-3 text-[13px]">
            <span className="text-muted text-xs">Invoice no.</span><b className="tabular">{paid.receiptNo}</b>
          </div>
          {!paid.verified && <p className="mt-3 text-xs text-warn">Saved as unverified — the invoice is marked provisional until an accountant verifies it.</p>}
          <div className="mt-4"><a href={wa} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-accent hover:underline">Send invoice on WhatsApp →</a></div>
          <p className="mt-1 text-xs text-muted">Balance due now: {fmtINR(f?.outstanding ?? 0)}</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Record payment"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!sid || paise === null || paise <= 0} onClick={submit}>Save payment</Button></>}>
      <div className="space-y-4">
        {!studentId && (
          <Field label="Student" required>
            {student ? (
              <div className="flex items-center justify-between rounded-lg border border-line px-3 h-9"><span>{student.name} · {student.code}</span><button className="text-accent text-xs" onClick={() => setSid('')}>Change</button></div>
            ) : (
              <div className="relative">
                <Input autoFocus placeholder="Search name, mobile or student ID" value={q} onChange={(e) => setQ(e.target.value)} />
                {!!matches.length && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-white shadow-lg">
                    {matches.map((s) => <button key={s.id} onClick={() => { setSid(s.id); setQ(''); }} className="block w-full text-left px-3 py-2 hover:bg-surface">{s.name} <span className="text-muted">· {s.code} · {fmtPhone(s.phone)}</span></button>)}
                  </div>
                )}
              </div>
            )}
          </Field>
        )}
        {f && (
          <div className="grid grid-cols-3 gap-3 rounded-lg bg-surface border border-line p-3 text-[12.5px]">
            <div><div className="text-muted">Total fee</div><Money v={f.total} className="font-medium" /></div>
            <div><div className="text-muted">Paid</div><Money v={f.paid} className="font-medium text-ok" /></div>
            <div><div className="text-muted">Balance due</div><Money v={f.outstanding} className="font-medium" /></div>
            {f.next && <div className="col-span-3 text-muted">Next: {f.next.label} — {fmtINR(f.next.remaining)} due {fmtDate(f.next.dueDate)}</div>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)" required error={amount && paise === null ? 'Enter a valid amount' : undefined}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Payment date" required hint="Date money was actually received"><Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Method"><Select value={method} onChange={(e) => { const m = e.target.value as PayMethod; setMethod(m); setVerified(m !== 'Online Gateway'); }} options={PAY_METHODS} /></Field>
          <Field label="Reference / UTR" required={method !== 'Cash'}><Input value={reference} onChange={(e) => setRef(e.target.value)} placeholder={method === 'Cash' ? 'Optional' : 'UTR / txn no.'} /></Field>
        </div>
        <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Checkbox checked={verified} onChange={(e) => setVerified(e.target.checked)} label={<span>Money has been received <span className="text-muted block text-xs">Unchecked payments are not counted in collections until an accountant verifies them.</span></span>} />
      </div>
    </Modal>
  );
}

const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "Mon, 2 Nov" — quick-date buttons always show the real date, so "Tomorrow" is never ambiguous around midnight. */
const dayLabel = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));
const relLabel = (d: string, today: string) => {
  const n = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
};
// what each outcome asks for next
const DATE_LABEL: Partial<Record<CallOutcome, string>> = { 'Promised to Pay': 'Promised payment date', 'Needs More Time': 'Will pay by', 'Call Later': 'Call back on' };
const NO_DATE: CallOutcome[] = ['Wrong Number', 'Already Paid'];
const SUGGEST_TOMORROW: CallOutcome[] = ['Not Answered', 'Busy', 'Call Later'];
const NOTE_HINT: Partial<Record<CallOutcome, string>> = {
  'Promised to Pay': 'e.g. Will pay ₹3,000 by UPI on Monday', 'Already Paid': 'e.g. Says paid ₹1,500 by UPI on 30 Oct — ref ending 4821',
  'Needs More Time': 'e.g. Salary on the 5th, will clear the balance then', 'Not Interested': 'e.g. Fees too high right now', Interested: 'e.g. Wants the weekend batch',
};

export function CallOutcomeModal({ target, onClose }: { target: { entity: 'lead' | 'student'; id: string; name: string; phone: string } | null; onClose: () => void }) {
  const db = S.useDB();
  const run = useRun();
  const [outcome, setOutcome] = useState<CallOutcome | ''>('');
  const [notes, setNotes] = useState('');
  const [fu, setFu] = useState('');
  useEffect(() => { setOutcome(''); setNotes(''); setFu(''); }, [target]);
  const today = todayIST();
  const fee = target?.entity === 'student';
  const f = fee && target ? financeFor(db, target.id, today) : null;
  const overdue = f ? f.lines.filter((l) => l.status === 'Overdue').reduce((t, l) => t + l.remaining, 0) : 0;
  const lead = !fee && target ? db.leads.find((l) => l.id === target.id) : undefined;
  const reached: CallOutcome[] = fee ? ['Promised to Pay', 'Already Paid', 'Needs More Time', 'Call Later'] : ['Connected', 'Interested', 'Not Interested', 'Call Later'];
  const notReached: CallOutcome[] = ['Not Answered', 'Busy', 'Wrong Number'];
  const needsDate = !!outcome && NEEDS_DATE.includes(outcome);
  const showDate = !!outcome && !NO_DATE.includes(outcome);
  const pick = (o: CallOutcome) => {
    setOutcome(o);
    if (NO_DATE.includes(o)) setFu('');
    else if (!fu && SUGGEST_TOMORROW.includes(o)) setFu(addDays(today, 1));
  };
  const save = () => {
    if (!target || !outcome) return;
    let ok = false;
    run(() => { S.logCall(target.entity, target.id, outcome, notes, showDate && fu ? fu : undefined); ok = true; }, 'Call saved');
    if (ok) onClose();
  };
  const quick: [string, number][] = [['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]];
  const optBtn = (o: CallOutcome, tone: 'reach' | 'miss') => (
    <button key={o} type="button" onClick={() => pick(o)} aria-pressed={outcome === o}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${outcome === o
        ? (tone === 'reach' ? 'border-accent bg-accent-soft text-accent ring-2 ring-accent/15' : 'border-zinc-400 bg-zinc-100 text-ink ring-2 ring-zinc-300/40')
        : 'border-line bg-white text-zinc-700 hover:border-zinc-300 hover:bg-surface'}`}>
      <span className={`size-2 rounded-full shrink-0 ${outcome === o ? (tone === 'reach' ? 'bg-accent' : 'bg-zinc-500') : 'bg-zinc-300'}`} />{o}
    </button>
  );

  return (
    <Modal open={!!target} onClose={onClose} title={<span>Log call · <span className="text-navy">{target?.name}</span></span>}
      footer={<>
        <span className="mr-auto text-xs text-muted hidden sm:block">{!outcome ? 'Choose what happened on the call' : needsDate && !fu ? `Pick the ${DATE_LABEL[outcome]?.toLowerCase()}` : ''}</span>
        <Button onClick={onClose}>Not now</Button>
        <Button variant="primary" disabled={!outcome || (needsDate && !fu)} onClick={save}>Save call</Button>
      </>}>
      <div className="space-y-5">
        {/* who / why */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-[12.5px]">
          <span className="font-medium tabular text-zinc-700">{target && fmtPhone(target.phone)}</span>
          <span className="text-zinc-300">•</span>
          {fee && f ? <>
            <span className="text-zinc-600">Fee follow-up</span>
            <span className="text-zinc-300">•</span>
            <span><b className="text-warn tabular">{fmtINR(f.outstanding)}</b> <span className="text-muted">due</span></span>
            {overdue > 0 && <span className="rounded-md bg-bad-soft text-bad px-1.5 py-0.5 text-[11.5px] font-semibold">{fmtINR(overdue)} overdue</span>}
            {f.next && <span className="text-muted">· next {fmtINR(f.next.remaining)} on {fmtDate(f.next.dueDate)}</span>}
          </> : <span className="text-zinc-600">Lead{lead ? ` · ${lead.status}` : ''}</span>}
        </div>

        {/* outcome */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">{fee ? 'Spoke with the student' : 'Spoke with the lead'}</div>
          <div className="grid grid-cols-2 gap-2">{reached.map((o) => optBtn(o, 'reach'))}</div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mt-4 mb-2">Couldn't talk</div>
          <div className="grid grid-cols-3 gap-2">{notReached.map((o) => optBtn(o, 'miss'))}</div>
        </div>

        {outcome === 'Already Paid' && (
          <p className="rounded-lg border border-info/20 bg-info-soft px-3 py-2.5 text-[12.5px] text-zinc-700">
            Check the payment in Fees / Collections. If it isn't there yet, record it (or verify a pending one) so the balance updates.
          </p>
        )}

        {/* date */}
        {showDate && (
          <div>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <span className="text-[12.5px] font-medium text-zinc-800">{DATE_LABEL[outcome as CallOutcome] ?? 'Next follow-up'}{needsDate ? <span className="text-bad"> *</span> : <span className="text-muted font-normal"> (optional)</span>}</span>
              {fu && <span className="text-[12px] text-accent font-medium">{dayLabel(fu)} · {relLabel(fu, today)}</span>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {quick.map(([l, n]) => {
                const d = addDays(today, n);
                return (
                  <button key={l} type="button" onClick={() => setFu(d)} aria-pressed={fu === d}
                    className={`rounded-lg border px-2 py-1.5 text-center transition-colors ${fu === d ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white hover:bg-surface'}`}>
                    <div className="text-[12.5px] font-semibold">{l}</div><div className={`text-[11px] ${fu === d ? 'text-accent/80' : 'text-muted'}`}>{dayLabel(d)}</div>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input type="date" min={today} value={fu} onChange={(e) => setFu(e.target.value)} className="w-44" aria-label="Pick another date" />
              <span className="text-xs text-muted">or pick another date</span>
              {fu && !needsDate && <button type="button" onClick={() => setFu('')} className="ml-auto text-xs text-muted hover:text-ink">Clear</button>}
            </div>
          </div>
        )}

        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={(outcome && NOTE_HINT[outcome]) || 'What did they say?'} /></Field>
      </div>
    </Modal>
  );
}

export function LeadModal({ open, onClose, leadId }: { open: boolean; onClose: () => void; leadId?: string }) {
  const db = S.useDB();
  const run = useRun();
  const me = S.useMe();
  const lead = db.leads.find((l) => l.id === leadId);
  const blank = { name: '', phone: '', email: '', source: 'Manual', campaign: '', assignedTo: '', interest: 'Medium' as const, notes: '' };
  const [f, setF] = useState<typeof blank>(blank);
  useEffect(() => { if (open) setF(lead ? { name: lead.name, phone: lead.phone, email: lead.email, source: lead.source, campaign: lead.campaign, assignedTo: lead.assignedTo, interest: lead.interest as any, notes: lead.notes } : blank); }, [open, leadId]);
  const callers = db.employees.filter((e) => e.active && (e.role === 'caller' || e.role === 'calling_manager'));
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = () => { let ok = false; run(() => { S.saveLead({ ...f, id: leadId, interest: f.interest as any }); ok = true; }, lead ? 'Lead updated' : 'Lead added'); if (ok) onClose(); };
  return (
    <Modal open={open} onClose={onClose} title={lead ? `Edit ${lead.name}` : 'New lead'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name || !f.phone} onClick={save}>{lead ? 'Save' : 'Add lead'}</Button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name" required><Input autoFocus value={f.name} onChange={set('name')} /></Field>
        <Field label="Mobile" required><Input inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="10-digit mobile" /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Source"><Select value={f.source} onChange={set('source')} options={LEAD_SOURCES} /></Field>
        <Field label="Campaign"><Input value={f.campaign} onChange={set('campaign')} /></Field>
        <Field label="Interest"><Select value={f.interest} onChange={set('interest')} options={['Low', 'Medium', 'High']} /></Field>
        {me?.role !== 'caller' && <Field label="Assign to" className="sm:col-span-2"><Select value={f.assignedTo} onChange={set('assignedTo')} placeholder="Unassigned" options={callers.map((c) => ({ value: c.id, label: c.name }))} /></Field>}
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

export function ExpenseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const run = useRun();
  const today = todayIST();
  const [f, setF] = useState({ category: '', description: '', amount: '', date: today, method: 'Bank Transfer' as PayMethod, notes: '', recurring: false, day: '1' });
  const [receipt, setReceipt] = useState<{ name: string; data: string } | undefined>();
  useEffect(() => { if (open) { setF({ category: '', description: '', amount: '', date: today, method: 'Bank Transfer', notes: '', recurring: false, day: '1' }); setReceipt(undefined); } }, [open]);
  const paise = parseRupees(f.amount);
  const kind = FIXED_CATEGORIES.includes(f.category) ? 'fixed' : 'variable';
  const onFile = (file?: File) => {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) return run(() => { throw new S.AppError('Receipt must be under 3 MB.'); });
    if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(file.type)) return run(() => { throw new S.AppError('Receipt must be a PNG, JPG, WEBP or PDF.'); });
    const r = new FileReader(); r.onload = () => setReceipt({ name: file.name, data: String(r.result) }); r.readAsDataURL(file);
  };
  const save = () => {
    if (paise === null) return;
    let ok = false;
    run(() => {
      S.addExpense({ category: f.category, kind, description: f.description, amount: paise, date: f.date, method: f.method, notes: f.notes, receipt });
      if (f.recurring) S.saveRecurring({ category: f.category, description: f.description, amount: paise, dayOfMonth: Number(f.day), active: true, startMonth: addMonth(f.date.slice(0, 7)) });
      ok = true;
    }, 'Expense added');
    if (ok) onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add expense"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.category || !f.description || paise === null} onClick={save}>Save expense</Button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Category" required>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="w-full h-9 rounded-lg border border-line bg-white px-3">
            <option value="">Select…</option>
            <optgroup label="Fixed">{FIXED_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</optgroup>
            <optgroup label="Variable">{VARIABLE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</optgroup>
          </select>
        </Field>
        <Field label="Amount (₹)" required><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Description" required className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Date"><Input type="date" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Paid via"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PayMethod })} options={PAY_METHODS} /></Field>
        <Field label="Receipt" className="sm:col-span-2" hint={receipt?.name ?? 'PNG, JPG or PDF up to 3 MB'}><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => onFile(e.target.files?.[0])} className="text-[13px]" /></Field>
        <Field label="Notes" className="sm:col-span-2"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <Checkbox checked={f.recurring} onChange={(e) => setF({ ...f, recurring: e.target.checked })} label="Repeat every month" />
          {f.recurring && <span className="flex items-center gap-2 text-muted">on day <Input className="w-16" type="number" min={1} max={28} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /> (from next month)</span>}
        </div>
      </div>
    </Modal>
  );
}
const addMonth = (ym: string) => { let [y, m] = ym.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}`; };

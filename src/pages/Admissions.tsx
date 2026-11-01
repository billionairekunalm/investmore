import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Button, Card, Checkbox, Field, Input, Select, cx, useRun, useUI, Money } from '../ui/kit';
import { buildSchedule } from '../domain/fees';
import { GENDERS, LEAD_SOURCES, PAY_METHODS, type Gender, type IdDocument, type PayMethod } from '../domain/types';
import { fmtDate, fmtINR, normalizePhone, nowISO, parseRupees, todayIST, uid } from '../domain/util';
import { extractId, mask, resizeImage } from '../lib/ocr';
import { mergeFields, parseAadhaar, PasswordNeeded, readSide, type AadhaarFields, type Conf, type ReadResult } from '../lib/aadhaar';

const ICON = {
  user: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 14a5.5 5.5 0 0 1 11 0',
  book: 'M2 3h4.5A1.5 1.5 0 0 1 8 4.5V14a1.5 1.5 0 0 0-1.5-1.5H2zM14 3H9.5A1.5 1.5 0 0 0 8 4.5V14a1.5 1.5 0 0 1 1.5-1.5H14z',
  rupee: 'M4.5 2.5h7M4.5 5.5h7M7 2.5c2.5 0 3 1.5 3 3s-1.2 3-3.5 3H4.5l5 5',
  shield: 'M8 1.5 2.5 3.5v4c0 3.5 2.4 6 5.5 7 3.1-1 5.5-3.5 5.5-7v-4zM5.8 8l1.5 1.5 3-3',
  camera: 'M2 5h2.5L6 3h4l1.5 2H14v8H2zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  lock: 'M4 7h8v7H4zM5.5 7V5a2.5 2.5 0 0 1 5 0v2',
  scan: 'M2 5V3a1 1 0 0 1 1-1h2M11 2h2a1 1 0 0 1 1 1v2M14 11v2a1 1 0 0 1-1 1h-2M5 14H3a1 1 0 0 1-1-1v-2M2 8h12',
  upload: 'M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2',
  file: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3',
  check: 'M2.5 8.5 6 12l7.5-8',
  alert: 'M8 2 1.5 13.5h13zM8 6.5v3M8 11.5h.01',
};
const Ic = ({ d, className = 'size-4' }: { d: string; className?: string }) => (
  <svg viewBox="0 0 16 16" className={cx('shrink-0', className)} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

export default function Admissions() {
  const nav = useNavigate();
  return (
    <div className="mx-auto max-w-[1100px]">
      <Link to="/students" className="text-[12.5px] text-muted hover:text-ink">← Students</Link>
      <h1 className="text-[22px] font-bold tracking-tight mt-1">New admission</h1>
      <p className="text-muted mt-0.5 mb-5">Creates the student, fee plan and instalment schedule in one step.</p>
      <AdmissionForm page onDone={(id) => nav(id ? `/students/${id}` : '/students')} />
    </div>
  );
}

/** `page` = the full-page layout (action bar clear of the phone tab bar). Without it the form fits the Convert-lead modal. */
export function AdmissionForm({ leadId, onDone, page }: { leadId?: string; onDone: (studentId?: string) => void; page?: boolean }) {
  const db = S.useDB();
  const me = S.useMe()!;
  const run = useRun();
  const lead = db.leads.find((l) => l.id === leadId);
  const today = todayIST();
  const [key] = useState(uid);
  const course0 = db.courses[0];
  const [f, setF] = useState({
    name: lead?.name ?? '', phone: lead?.phone ?? '', altPhone: '', email: lead?.email ?? '', address: '', city: '', state: '', pin: '', dob: '', gender: '' as Gender,
    courseId: course0?.id ?? '', batchId: '', admissionDate: today, source: lead?.source ?? 'Walk-in', campaign: lead?.campaign ?? '', counsellorId: lead?.assignedTo || me.id,
    booking: String((course0?.bookingDefault ?? 100000) / 100), bookingPaidNow: true, method: 'Cash' as PayMethod, reference: '',
  });
  const [photo, setPhoto] = useState<string>();
  const [idDoc, setIdDoc] = useState<IdDocument>();
  const [busy, setBusy] = useState(false);
  // fields filled from the Aadhaar scan → green tint; 'low' adds a "please check" note. Editing a field clears its mark.
  const [auto, setAuto] = useState<Partial<Record<keyof typeof f, Conf>>>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); if (auto[k]) setAuto(({ [k]: _, ...rest }) => rest); };
  const tint = (k: keyof typeof f) => (auto[k] ? 'border-accent/50! bg-accent-soft/60!' : undefined);
  const check = (k: keyof typeof f) => auto[k] === 'low' && <span className="mt-1 flex items-center gap-1 text-xs text-warn"><Ic d={ICON.alert} className="size-3.5" />Couldn't read clearly — please check</span>;
  const fill = (r: AadhaarFields) => {
    const map = { name: r.name, dob: r.dob, gender: r.gender, address: r.address, city: r.city, state: r.state, pin: r.pin };
    const next = { ...f }, marks: typeof auto = {};
    for (const [k, v] of Object.entries(map)) if (v) { (next as unknown as Record<string, string>)[k] = v.value; marks[k as keyof typeof f] = v.conf; }
    setF(next); setAuto(marks);
    if (r.maskedNumber) setIdDoc({ type: 'Aadhaar', maskedNumber: r.maskedNumber.value, nameOnDoc: r.name?.value || f.name, consentAt: nowISO(), capturedBy: me.id, imageRetained: false });
  };

  const course = db.courses.find((c) => c.id === f.courseId);
  const batches = db.batches.filter((b) => b.courseId === f.courseId && (b.status === 'upcoming' || b.status === 'running'));
  const batch = db.batches.find((b) => b.id === f.batchId);
  const booking = parseRupees(f.booking);
  const policy = db.settings.bookingPolicy;
  const preview = useMemo(() => {
    if (!course || booking === null || !policy) return null;
    try {
      const start = db.settings.startEvent === 'batch_start' && batch ? batch.startDate : f.admissionDate;
      return buildSchedule({ booking, instalments: course.instalments, policy, admissionDate: f.admissionDate, startDate: start, gapDays: db.settings.instalmentGapDays });
    } catch (e) { return { error: (e as Error).message }; }
  }, [course, booking, policy, f.admissionDate, batch, db.settings]);
  const phoneOk = normalizePhone(f.phone);
  const dups = phoneOk || f.email ? S.findDuplicates(db, f.phone, f.email) : [];
  const counsellors = db.employees.filter((e) => e.active && e.role !== 'teacher');
  const total = preview && 'total' in preview ? preview.total : null;
  const paidNow = f.bookingPaidNow && booking ? booking : 0;

  const submit = () => {
    if (booking === null) return;
    setBusy(true);
    const input: S.AdmissionInput = {
      key, name: f.name, phone: f.phone, altPhone: f.altPhone, email: f.email, address: f.address, city: f.city, state: f.state, pin: f.pin, photo, dob: f.dob, gender: f.gender,
      courseId: f.courseId, batchId: f.batchId, admissionDate: f.admissionDate, source: f.source, campaign: f.campaign, counsellorId: f.counsellorId,
      bookingAmount: booking, bookingPaid: f.bookingPaidNow && booking > 0 ? { method: f.method, reference: f.reference } : null, idDoc,
    };
    const id = run(() => (leadId ? S.convertLead(leadId, input) : S.admitStudent(input)), leadId ? 'Lead converted — student created' : 'Student admitted');
    setBusy(false);
    if (id) onDone(id);
  };

  if (!policy) return (
    <div className="rounded-xl border border-warn/30 bg-warn-soft p-4">
      <div className="font-medium text-warn">Booking-amount policy not set</div>
      <p className="mt-1 text-zinc-700">Before the first admission, an administrator must choose whether the booking amount is <b>additional</b> to the ₹7,500 instalments or <b>credited</b> against the course fee.</p>
      {S.allowed('settings', 'edit', db) ? <Link to="/settings?tab=fees" className="inline-block mt-3 font-medium text-accent">Open fee settings →</Link> : <p className="mt-2 text-muted">Ask an administrator to set it.</p>}
    </div>
  );

  // what still blocks "Complete admission" — same conditions as before, now spelled out
  const missing = [!f.name && 'full name', !phoneOk && 'a valid mobile', booking === null && 'a valid booking amount', !f.courseId && 'a course'].filter(Boolean) as string[];
  const blocked = missing.length > 0 || dups.length > 0;
  const g2 = 'grid sm:grid-cols-2 gap-x-4 gap-y-3.5';

  const form = (
    <Card className={cx('overflow-hidden', page && 'shadow-[0_1px_3px_rgba(0,0,0,.04)]')}>
      {S.allowed('sensitive', 'create', db) && (
        <FormSection icon={ICON.scan} title="Aadhaar Smart Autofill" optional sub="Upload the student's Aadhaar card to fill name, date of birth, gender and address automatically.">
          <AadhaarAutofill onFill={fill} />
        </FormSection>
      )}
      <FormSection icon={ICON.user} title="Student details" sub="Contact details are used for receipts and payment reminders.">
        <div className={g2}>
          <Field label="Full name" required><Input value={f.name} onChange={set('name')} autoFocus={!lead} placeholder="As it should appear on the certificate" className={tint('name')} />{check('name')}</Field>
          <Field label="Mobile number" required error={f.phone && !phoneOk ? 'Enter a valid 10-digit Indian mobile' : undefined}>
            <Input inputMode="tel" value={f.phone} onChange={set('phone')} disabled={!!lead} placeholder="10-digit mobile" />
          </Field>
          <Field label="Date of birth"><Input type="date" max={today} value={f.dob} onChange={set('dob')} className={tint('dob')} />{check('dob')}</Field>
          <Field label="Gender"><Select value={f.gender} onChange={set('gender')} placeholder="Select" options={GENDERS} className={tint('gender')} />{check('gender')}</Field>
          <Field label="Alternate mobile"><Input inputMode="tel" value={f.altPhone} onChange={set('altPhone')} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
          <div className="sm:col-span-2">
            <span className="mb-1 block text-[12.5px] font-medium text-zinc-700">Photo</span>
            <div className="flex items-center gap-3">
              {photo ? <img src={photo} className="size-12 rounded-full object-cover ring-2 ring-white shadow" alt="" />
                : <span className="size-12 rounded-full bg-surface border border-dashed border-zinc-300 grid place-items-center text-zinc-400"><Ic d={ICON.camera} className="size-5" /></span>}
              <label className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-zinc-300 bg-white font-medium cursor-pointer hover:bg-surface whitespace-nowrap">
                {photo ? 'Change photo' : 'Upload photo'}
                <input type="file" accept="image/*" capture="user" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setPhoto(await resizeImage(file)); e.target.value = ''; }} />
              </label>
              {photo && <button type="button" onClick={() => setPhoto(undefined)} className="text-[12.5px] text-muted hover:text-bad">Remove</button>}
              <span className="text-xs text-muted hidden sm:inline">Optional · opens the camera on phones</span>
            </div>
          </div>
          <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={set('address')} placeholder="House / street / area" className={tint('address')} />{check('address')}</Field>
          <Field label="City"><Input value={f.city} onChange={set('city')} className={tint('city')} />{check('city')}</Field>
          <div className="grid grid-cols-2 gap-x-4">
            <Field label="State"><Input value={f.state} onChange={set('state')} className={tint('state')} />{check('state')}</Field>
            <Field label="PIN code" error={f.pin && !/^\d{6}$/.test(f.pin) ? '6 digits' : undefined}><Input inputMode="numeric" maxLength={6} value={f.pin} onChange={set('pin')} className={tint('pin')} />{check('pin')}</Field>
          </div>
        </div>
        {dups.length > 0 && (
          <div className="mt-4 rounded-lg border border-bad/20 bg-bad-soft px-3 py-2.5 text-[13px]">
            <b className="text-bad">Possible duplicate.</b> {dups.map((d) => <Link key={d.id} to={`/students/${d.id}`} className="underline ml-1">{d.name} ({d.code}, {d.phone})</Link>)} already uses this mobile number or email. Admission will be blocked.
          </div>
        )}
      </FormSection>

      <FormSection icon={ICON.book} title="Course details">
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3.5">
          <Field label="Course" required><Select value={f.courseId} onChange={(e) => setF({ ...f, courseId: e.target.value, batchId: '', booking: String((db.courses.find((c) => c.id === e.target.value)?.bookingDefault ?? 0) / 100) })} options={db.courses.map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Batch" hint={!batches.length ? 'No open batches — create one in Batches' : undefined}>
            <Select value={f.batchId} onChange={set('batchId')} placeholder="Assign later" options={batches.map((b) => ({ value: b.id, label: `${b.name} · ${b.timing} (${db.students.filter((s) => s.batchId === b.id && s.status === 'Active').length}/${b.capacity})` }))} />
          </Field>
          <Field label="Admission date" required><Input type="date" max={today} value={f.admissionDate} onChange={set('admissionDate')} /></Field>
          <Field label="Lead source"><Select value={f.source} onChange={set('source')} options={LEAD_SOURCES} disabled={!!lead} /></Field>
          <Field label="Campaign"><Input value={f.campaign} onChange={set('campaign')} disabled={!!lead} /></Field>
          <Field label="Counsellor"><Select value={f.counsellorId} onChange={set('counsellorId')} options={counsellors.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        </div>
      </FormSection>

      <FormSection icon={ICON.rupee} title="Fee details" sub={`Booking policy: ${policy === 'additional' ? 'booking is additional to the instalments' : 'booking is credited against the course fee'}.`}>
        <div className={g2}>
          <div>
            <span className="mb-1 block text-[12.5px] font-medium text-zinc-700">Total course fee</span>
            <div className="h-9 rounded-lg bg-accent-soft/60 border border-accent/15 px-3 flex items-center font-bold text-accent tabular">{total !== null ? fmtINR(total) : '—'}</div>
            <span className="mt-1 block text-xs text-muted">Calculated from the course instalments</span>
          </div>
          <Field label="Booking amount (₹)" error={booking === null ? 'Enter a valid amount' : undefined}><Input inputMode="decimal" value={f.booking} onChange={set('booking')} /></Field>
          <div className="sm:col-span-2 rounded-lg border border-line bg-surface/60 px-3 py-2.5">
            <Checkbox checked={f.bookingPaidNow} onChange={(e) => setF({ ...f, bookingPaidNow: e.target.checked })} label={<span><b className="font-medium">Booking amount received now</b><span className="text-muted"> — records the payment and issues a receipt</span></span>} />
          </div>
          {f.bookingPaidNow && <>
            <Field label="Payment method"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PayMethod })} options={PAY_METHODS.filter((m) => m !== 'Online Gateway')} /></Field>
            <Field label="Reference / UTR" required={f.method !== 'Cash'}><Input value={f.reference} onChange={set('reference')} placeholder={f.method === 'Cash' ? 'Optional for cash' : 'Transaction / UTR number'} /></Field>
          </>}
        </div>
        {preview && 'error' in preview && <p className="mt-3 text-bad">{preview.error}</p>}
        {preview && 'lines' in preview && (
          <div className="mt-4 rounded-lg border border-line overflow-hidden">
            <table className="w-full text-[13px]">
              <thead><tr className="bg-surface text-[11px] uppercase tracking-wider text-muted"><th className="text-left font-semibold px-3 py-2">Instalment</th><th className="text-left font-semibold px-3 py-2">Due date</th><th className="text-right font-semibold px-3 py-2">Amount</th></tr></thead>
              <tbody>
                {preview.lines.map((l) => (
                  <tr key={l.seq} className="border-t border-line">
                    <td className="px-3 py-2 font-medium">{l.label}{l.seq === 0 && paidNow > 0 && <span className="ml-2"><Badge tone="green">Received now</Badge></span>}</td>
                    <td className="px-3 py-2 text-zinc-600 tabular">{fmtDate(l.dueDate)}</td>
                    <td className="px-3 py-2 text-right"><Money v={l.amount} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-line bg-surface/60"><td className="px-3 py-2 font-semibold" colSpan={2}>Total</td><td className="px-3 py-2 text-right"><Money v={preview.total} className="font-bold" /></td></tr></tfoot>
            </table>
          </div>
        )}
      </FormSection>

      <FormSection icon={ICON.shield} title="Identity document" optional>
        <IdCapture value={idDoc} onChange={setIdDoc} studentName={f.name} />
      </FormSection>
    </Card>
  );

  const actions = (
    // sticky: stays in view while scrolling; on the page it sits above the phone tab bar
    <div className={cx('sticky z-20 mt-4', page ? 'bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-4' : 'bottom-0 -mx-1')}>
      <div className="rounded-xl border border-line bg-white px-3 sm:px-4 py-3 shadow-[0_-2px_16px_-6px_rgba(0,0,0,.12),0_4px_12px_-6px_rgba(0,0,0,.08)] flex items-center gap-3">
        <div className="min-w-0 flex-1 leading-tight hidden sm:block">
          {blocked
            ? <span className="block truncate text-[12.5px] text-muted">{dups.length ? 'Resolve the duplicate to continue' : `Add ${missing.join(', ')} to continue`}</span>
            : <><span className="text-[11px] uppercase tracking-wider font-semibold text-muted">Total course fee</span><div className="font-bold text-[16px] tabular">{total !== null ? fmtINR(total) : '—'}{paidNow > 0 && <span className="ml-2 text-[12px] font-medium text-accent">{fmtINR(paidNow)} received now</span>}</div></>}
        </div>
        <div className="flex gap-2 w-full sm:w-auto shrink-0">
          <Button onClick={() => onDone()} className="h-10">Cancel</Button>
          <Button variant="primary" loading={busy} disabled={blocked} onClick={submit} className="h-10 px-5 flex-1 sm:flex-none text-[14px]">
            {leadId ? 'Convert & admit' : 'Complete admission'}{total !== null ? ` · ${fmtINR(total)}` : ''}
          </Button>
        </div>
      </div>
    </div>
  );

  return <div>{form}{actions}</div>;
}

type Side = 'front' | 'back';
const isPdf = (f?: File) => !!f && (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
const LABELS: Record<string, string> = { name: 'Name', dob: 'Date of birth', gender: 'Gender', maskedNumber: 'Aadhaar no.', address: 'Address', city: 'City', state: 'State', pin: 'PIN code' };

/** Front/back upload → on-device read → parsed fields handed to the form. Never submits anything. */
function AadhaarAutofill({ onFill }: { onFill: (r: AadhaarFields) => void }) {
  const { toast } = useUI();
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<Partial<Record<Side, File>>>({});
  const [pw, setPw] = useState<Partial<Record<Side, string>>>({});
  const [needPw, setNeedPw] = useState<Side | null>(null);
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'scanning'; side: Side } | { kind: 'done'; r: AadhaarFields } | { kind: 'failed'; msg: string }>({ kind: 'idle' });

  const take = (side: Side) => (file?: File) => {
    if (!file) return setFiles(({ [side]: _, ...rest }) => rest);
    const ok = /^image\/(jpe?g|png)$/.test(file.type) || isPdf(file);
    if (!ok) return toast('Use a JPG, PNG or PDF file.', 'bad');
    if (file.size > 10 * 1024 * 1024) return toast('That file is over 10 MB — try a smaller photo.', 'bad');
    setFiles((x) => ({ ...x, [side]: file }));
    if (needPw === side) setNeedPw(null);
    setState({ kind: 'idle' });
  };
  // an e-Aadhaar PDF holds both sides, so it can be scanned on its own
  const ready = consent && !!files.front && (!!files.back || isPdf(files.front));
  const scanning = state.kind === 'scanning';

  const scan = async () => {
    const read = async (side: Side) => {
      setState({ kind: 'scanning', side });
      try { return await readSide(files[side]!, pw[side] || undefined); }
      catch (e) {
        if (e instanceof PasswordNeeded) { setNeedPw(side); throw new Error(pw[side] ? 'That PDF password is not correct.' : 'This PDF is password-protected. Enter its password below the upload and scan again.'); }
        throw e;
      }
    };
    try {
      const fr = await read('front');
      const br: ReadResult = files.back ? await read('back') : { texts: [''], quality: 100 };
      // pair each OCR pass of the front with the same pass of the back, then merge: QR beats OCR, clear beats unclear
      const passes = Array.from({ length: Math.max(fr.texts.length, br.texts.length) }, (_, i) =>
        parseAadhaar(fr.texts[i] ?? fr.texts[0], br.texts[i] ?? br.texts[0], { front: fr.quality, back: br.quality }));
      const r = mergeFields(fr.qr, br.qr, ...passes);
      if (!Object.keys(r).some((k) => k !== 'yearOfBirth' && k !== 'fromQr')) return setState({ kind: 'failed', msg: "We couldn't read any details from these files. Try a clearer, well-lit photo — or enter the details manually below." });
      setNeedPw(null);
      onFill(r);
      setState({ kind: 'done', r });
    } catch (e) {
      const msg = (e as Error).message;
      setState({ kind: 'failed', msg: /password/i.test(msg) ? msg : 'Scanning failed on this device. You can still enter the details manually below.' });
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line bg-surface/60 px-3 py-2.5">
        <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} label="The student has given informed consent to read their Aadhaar for identity records (DPDP Act)." />
      </div>
      <div className={cx('grid sm:grid-cols-2 gap-3', !consent && 'opacity-50')} aria-disabled={!consent}>
        {(['front', 'back'] as Side[]).map((side) => (
          <UploadBox key={side} side={side} file={files[side]} onFile={take(side)} disabled={!consent || scanning}
            password={needPw === side ? pw[side] ?? '' : undefined} onPassword={(v) => setPw((x) => ({ ...x, [side]: v }))} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!ready} loading={scanning} onClick={scan} className="h-10 px-4">
          {!scanning && <Ic d={ICON.scan} />}{scanning ? `Reading ${state.side} side…` : 'Scan Aadhaar & Autofill Form'}
        </Button>
        <span className="text-xs text-muted">{!consent ? 'Tick consent to upload.' : !files.front ? 'Upload the front side to begin.' : !ready ? 'Add the back side (or upload the e-Aadhaar PDF).' : 'Nothing is submitted — you review every field first.'}</span>
      </div>

      {state.kind === 'failed' && (
        <div className="rounded-lg border border-bad/20 bg-bad-soft px-3 py-2.5 text-[13px] text-bad flex items-start gap-2"><Ic d={ICON.alert} className="size-4 mt-px" />{state.msg}</div>
      )}
      {state.kind === 'done' && (
        <div className="rounded-lg border border-accent/25 bg-accent-soft px-3 py-3 text-[13px]" role="status">
          <div className="flex flex-wrap items-center gap-2 font-semibold text-accent"><Ic d={ICON.check} />Aadhaar details extracted successfully.
            {state.r.fromQr && <span className="inline-flex items-center gap-1 rounded-full bg-accent text-white text-[11px] font-semibold px-2 py-0.5"><Ic d={ICON.shield} className="size-3" />Read from the Aadhaar QR code</span>}</div>
          <p className="text-zinc-600 mt-1">{state.r.fromQr ? 'Details were read from the secure QR code printed by UIDAI, so they match the Aadhaar record exactly. ' : 'Read from the printed text (the QR code could not be read — a sharper photo of the QR side gives exact data). '}Filled fields are highlighted in green below — you can edit anything.</p>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {Object.entries(LABELS).map(([k, l]) => {
              const v = state.r[k as keyof AadhaarFields] as { conf: Conf } | undefined;
              return (
                <span key={k} className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-medium border',
                  !v ? 'bg-white text-zinc-500 border-line' : v.conf === 'high' ? 'bg-white text-accent border-accent/30' : 'bg-warn-soft text-warn border-warn/30')}>
                  {!v ? `${l}: not found` : v.conf === 'high' ? <><Ic d={ICON.check} className="size-3" />{l}</> : `${l}: please check`}
                </span>
              );
            })}
          </div>
          {state.r.yearOfBirth && <p className="text-xs text-zinc-600 mt-2">Only the year of birth ({state.r.yearOfBirth}) is printed on this card — enter the full date if you know it.</p>}
        </div>
      )}
      <p className="flex items-start gap-1.5 text-[11.5px] text-muted leading-snug"><Ic d={ICON.lock} className="size-3.5 mt-px" />Read on this device only. The card images are never saved or uploaded, and only the last 4 digits of the Aadhaar number are kept.</p>
    </div>
  );
}

function UploadBox({ side, file, onFile, disabled, password, onPassword }: { side: Side; file?: File; onFile: (f?: File) => void; disabled: boolean; password?: string; onPassword: (v: string) => void }) {
  const [over, setOver] = useState(false);
  const url = useMemo(() => (file && !isPdf(file) ? URL.createObjectURL(file) : undefined), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const title = side === 'front' ? 'Aadhaar front side' : 'Aadhaar back side';
  const picker = (camera: boolean, children: ReactNode, cls: string) => (
    <label className={cx(cls, disabled && 'pointer-events-none')}>
      {children}
      <input type="file" className="sr-only" disabled={disabled} accept={camera ? 'image/*' : 'image/jpeg,image/png,application/pdf,.pdf'} capture={camera ? 'environment' : undefined}
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
    </label>
  );
  const btn = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-zinc-300 bg-white text-[12.5px] font-medium cursor-pointer hover:bg-surface';
  return (
    <div onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) onFile(e.dataTransfer.files[0]); }}
      className={cx('rounded-xl border-2 border-dashed p-3 min-h-[156px] flex flex-col transition-colors', over ? 'border-accent bg-accent-soft/50' : file ? 'border-accent/40 bg-white' : 'border-zinc-300 bg-surface/50')}>
      <div className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">{title}</div>
      {file ? (
        <div className="flex-1 flex items-center gap-3">
          {url ? <img src={url} alt={`${title} preview`} className="h-20 w-32 object-cover rounded-lg border border-line bg-white" />
            : <span className="h-20 w-32 rounded-lg border border-line bg-white grid place-items-center text-bad"><Ic d={ICON.file} className="size-8" /></span>}
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{file.name}</div>
            <div className="text-xs text-muted">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
            <div className="flex gap-2 mt-2">
              {picker(false, 'Replace', btn)}
              <button type="button" disabled={disabled} onClick={() => onFile(undefined)} className="text-[12.5px] text-muted hover:text-bad px-1">Remove</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 py-1">
          <span className="size-9 rounded-full bg-white border border-line grid place-items-center text-zinc-500"><Ic d={ICON.upload} /></span>
          <div className="text-[12.5px] text-zinc-600">Drag &amp; drop here, or</div>
          <div className="flex flex-wrap justify-center gap-2">
            {picker(false, <><Ic d={ICON.file} className="size-3.5" />Choose file</>, btn)}
            {picker(true, <><Ic d={ICON.camera} className="size-3.5" />Use camera</>, btn)}
          </div>
          <div className="text-[11px] text-muted">JPG, PNG or PDF · up to 10 MB</div>
        </div>
      )}
      {password !== undefined && (
        <div className="mt-2">
          <Input type="password" value={password} onChange={(e) => onPassword(e.target.value)} placeholder="PDF password" autoComplete="off" />
          <span className="mt-1 block text-[11px] text-muted">e-Aadhaar password: first 4 letters of the name in CAPITALS + year of birth, e.g. ROHA1998</span>
        </div>
      )}
    </div>
  );
}

function FormSection({ icon, title, sub, optional, children }: { icon: string; title: string; sub?: string; optional?: boolean; children: ReactNode }) {
  return (
    <section className="px-4 sm:px-6 py-5 border-b border-line last:border-0">
      <div className="flex items-start gap-3 mb-4">
        <span className="size-8 rounded-lg bg-accent-soft text-accent grid place-items-center shrink-0"><Ic d={icon} /></span>
        <div className="min-w-0">
          <h3 className="font-semibold text-[14.5px] leading-8 -mb-1">{title}{optional && <span className="ml-2 align-middle rounded-full bg-zinc-100 px-2 py-0.5 text-[10.5px] font-medium text-zinc-500">Optional</span>}</h3>
          {sub && <p className="text-[12.5px] text-muted">{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Consent-first ID capture. Stores only doc type + masked number + name, never the image or full number. */
export function IdCapture({ value, onChange, studentName }: { value?: IdDocument; onChange: (d?: IdDocument) => void; studentName: string }) {
  const db = S.useDB();
  const me = S.useMe()!;
  const { toast } = useUI();
  const [consent, setConsent] = useState(false);
  const [type, setType] = useState<IdDocument['type']>('Aadhaar');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ masked: string; name: string } | null>(null);
  if (!S.allowed('sensitive', 'create', db)) return <p className="text-muted">Your role cannot capture identity documents.</p>;
  if (value) return (
    <div className="flex items-center justify-between rounded-lg border border-line p-3">
      <div><Badge tone="green">Captured</Badge> <span className="ml-2">{value.type} · {value.maskedNumber} · {value.nameOnDoc}</span></div>
      <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>Remove</Button>
    </div>
  );
  const scan = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await extractId(file, type);
      setDraft({ masked: r.maskedNumber, name: r.nameOnDoc || studentName });
      if (!r.maskedNumber) toast('Could not read the ID number — enter the last 4 digits manually.', 'bad');
    } catch { toast('OCR failed — you can enter the details manually.', 'bad'); setDraft({ masked: '', name: studentName }); }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line bg-surface/60 px-3 py-2.5">
        <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} label="The student has given informed consent to capture this document for identity records (DPDP Act)." />
      </div>
      {consent && (
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3 items-end">
          <Field label="Document type"><Select value={type} onChange={(e) => setType(e.target.value as IdDocument['type'])} options={['Aadhaar', 'PAN', 'Driving Licence', 'Passport', 'Voter ID', 'Other']} /></Field>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-line bg-white font-medium cursor-pointer hover:bg-surface">
              <Ic d={ICON.camera} />{busy ? 'Reading…' : 'Upload / capture'}
              <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(e) => { scan(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <Button variant="ghost" onClick={() => setDraft({ masked: '', name: studentName })}>Enter manually</Button>
          </div>
        </div>
      )}
      {consent && draft && (
        <div className="rounded-lg bg-surface border border-line p-3 space-y-3">
          <div className="font-medium">Confirm extracted details</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name on document"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Document number (masked)" hint="Type the last 4 characters or the full number — only the last 4 are kept">
              <Input value={draft.masked} onChange={(e) => setDraft({ ...draft, masked: e.target.value.toUpperCase() })} onBlur={() => setDraft({ ...draft, masked: draft.masked.length > 4 && !draft.masked.startsWith('X') ? mask(draft.masked) : draft.masked.length === 4 ? `XXXXXXXX${draft.masked}` : draft.masked })} />
            </Field>
          </div>
          <Button variant="primary" size="sm" disabled={draft.masked.replace(/X/g, '').length < 4 || !draft.name} onClick={() => {
            onChange({ type, maskedNumber: mask(draft.masked) || draft.masked, nameOnDoc: draft.name, consentAt: nowISO(), capturedBy: me.id, imageRetained: false });
            setDraft(null);
          }}>Confirm document</Button>
        </div>
      )}
      <p className="flex items-start gap-1.5 text-[11.5px] text-muted leading-snug"><Ic d={ICON.lock} className="size-3.5 mt-px" />Aadhaar is not required — any listed document works. Only the document type, last 4 characters and name are kept; the photo and full number are discarded right after reading. A photo of a card is not treated as verified Aadhaar.</p>
    </div>
  );
}

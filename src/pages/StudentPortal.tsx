import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as S from '../store/store';
import { loadPortal, sb } from '../store/cloud';
import { enablePush, pushState, refreshPush, type PushState } from '../lib/push';
import { TABLES, fromRow } from '../store/schema';
import { studentFinance } from '../domain/fees';
import type { Batch, BatchVideo, ClassMark, ClassSession, Course, Enrolment, Instalment, Payment, Student } from '../domain/types';
import { AttendanceTab, CertsTab, CoursesTab, IdCardTab, Ic, TAB_ICONS, type PortalTab } from './PortalTabs';
import { InvoiceDoc } from './Receipt';
import type { Settings } from '../domain/types';
import { daysBetween, fmtDate, fmtDateTime, fmtINR, fmtPhone, fmtTime, nowIST, todayIST } from '../domain/util';
import { Badge, Button, Card, Empty, Modal, cx } from '../ui/kit';

type Portal = {
  student: Student; course?: Course; batch?: Batch; teacher?: string; instalments: Instalment[]; payments: Payment[];
  enrolments: Enrolment[]; attendance: { date: string; present: boolean }[]; certificates: { id: string; issued_at: string; status: string }[]; academy?: string;
  classes: ClassSession[]; marks: ClassMark[]; videos: BatchVideo[]; youtubeChannel?: string;
  invoiceSettings?: Pick<Settings, 'invoice' | 'gstRateBp' | 'academyName'>; staffNames: Record<string, string>;
};
// QR scans open /attend?t=…; a reminder opens /?class=…  (both survive the sign-in page, which keeps the URL)
const params = new URLSearchParams(location.search);
const attendToken = location.pathname === '/attend' ? params.get('t') : null;
const focusClass = params.get('class');
const spec = (table: string) => TABLES.find((t) => t.table === table)!;
const conv = <T,>(table: string, row: unknown) => (row ? (fromRow(spec(table), row as Record<string, unknown>) as T) : undefined);

/** Dashboard for a signed-in student: only their own records (served by my_portal() in the database). */
export default function StudentPortal() {
  const [data, setData] = useState<Portal | null | 'missing'>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    setErr(null);
    loadPortal().then((p) => {
      if (!p) return setData('missing');
      setData({
        student: conv<Student>('students', p.student)!, course: conv<Course>('courses', p.course), batch: conv<Batch>('batches', p.batch),
        teacher: (p.teacher as string) ?? undefined,
        instalments: (p.instalments as unknown[]).map((r) => conv<Instalment>('instalments', r)!),
        payments: (p.payments as unknown[]).map((r) => conv<Payment>('payments', r)!),
        enrolments: (p.enrolments as unknown[]).map((r) => conv<Enrolment>('enrolments', r)!),
        attendance: p.attendance as Portal['attendance'], certificates: p.certificates as Portal['certificates'], academy: (p.academy as string) ?? undefined,
        classes: ((p.classes as unknown[]) ?? []).map((r) => conv<ClassSession>('class_sessions', r)!),
        marks: ((p.marks as unknown[]) ?? []).map((r) => conv<ClassMark>('class_marks', r)!),
        videos: ((p.videos as unknown[]) ?? []).map((r) => conv<BatchVideo>('batch_videos', r)!),
        youtubeChannel: (p.youtubeChannel as string) || undefined,
        invoiceSettings: (p.invoiceSettings as Portal['invoiceSettings']) ?? undefined,
        staffNames: (p.staffNames as Record<string, string>) ?? {},
      });
    }).catch((e) => setErr((e as Error).message));
  };
  useEffect(load, []);
  useEffect(() => { void refreshPush(); }, []); // keeps this device's reminder registration fresh
  const [token, setToken] = useState<string | null>(attendToken); // from a scanned classroom QR
  const [sheet, setSheet] = useState(!!attendToken); // the Attendance screen
  const [invoiceId, setInvoiceId] = useState<string | null>(null); // a fee invoice opened from My payments
  const [win, setWin] = useState({ beforeMins: 15, afterMins: 15 });
  useEffect(() => { void sb!.rpc('attendance_window').then(({ data }) => data && setWin(data as typeof win)); }, []);

  // which main tab is open (remembered on this device); a scanned QR opens Attendance
  const [tab, setTabState] = useState<PortalTab>(() => { if (attendToken || focusClass) return attendToken ? 'attendance' : 'courses'; try { return (localStorage.getItem('portalTab') as PortalTab) || 'id'; } catch { return 'id'; } });
  const setTab = (t: PortalTab) => { setTabState(t); try { localStorage.setItem('portalTab', t); } catch { /* */ } };

  const top = (
    <header className="sticky top-0 z-20 bg-white/85 backdrop-blur border-b border-emerald-900/5">
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-2.5">
        <span className="size-8 rounded-xl bg-white border border-emerald-900/10 grid place-items-center overflow-hidden"><img src="/logo-mark.png" alt="" className="w-[85%]" /></span>
        <div className="leading-tight"><div className="font-bold tracking-[0.14em] text-[13px] text-ink">INVEST<span className="text-accent">MORE</span></div><div className="text-[9.5px] tracking-[0.25em] text-zinc-500">TRAINING ACADEMY</div></div>
        <button onClick={() => S.logout()} className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[13px] font-medium text-zinc-600 hover:bg-zinc-100" aria-label="Sign out">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></svg>Sign out
        </button>
      </div>
    </header>
  );
  if (err) return <div className="min-h-full bg-[#f4faf5]">{top}<div className="max-w-4xl mx-auto p-4"><Card><Empty title="Couldn't load your details" body={err} action={<Button onClick={load}>Try again</Button>} /></Card></div></div>;
  if (data === null) return <div className="min-h-full bg-[#f4faf5]">{top}<p className="text-center text-muted py-16">Loading…</p></div>;
  if (data === 'missing') return <div className="min-h-full bg-[#f4faf5]">{top}<div className="max-w-4xl mx-auto p-4"><Card><Empty title="No student record found for this login" body="Please contact the academy office." /></Card></div></div>;

  const { student: s, course, batch } = data;
  const today = todayIST();
  const f = studentFinance(s, data.instalments, data.payments, today);
  const overdue = f.lines.filter((l) => l.status === 'Overdue').reduce((t, l) => t + l.remaining, 0);
  const reversed = new Set(data.payments.filter((p) => p.kind === 'reversal').map((p) => p.reversesId));
  const pays = data.payments.filter((p) => p.kind !== 'reversal');
  const present = data.attendance.filter((a) => a.present).length;
  const attPct = data.attendance.length ? Math.round((present / data.attendance.length) * 100) : null;
  const paidPct = f.total ? Math.min(100, Math.round((f.paid / f.total) * 100)) : 0;
  const cert = data.certificates.find((c) => c.status === 'Issued');
  const initials = s.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  const core = { ...data, academy: data.academy };
  const TABS: [PortalTab, string][] = [['id', 'ID Card'], ['attendance', 'Attendance'], ['courses', 'Courses'], ['certs', 'Certificates']];
  const hour = +nowIST().slice(11, 13);

  const openInv = invoiceId ? data.payments.find((x) => x.id === invoiceId) : undefined;
  const settings = data.invoiceSettings && { ...data.invoiceSettings, invoice: { address: '', phone: '', email: '', gstin: '', note: '', ...(data.invoiceSettings.invoice as Partial<Settings['invoice']> | null) }, academyName: data.invoiceSettings.academyName || 'InvestMore' };
  if (openInv && settings) return (
    <InvoiceDoc p={openInv} s={s} payments={data.payments} instalments={data.instalments} course={course} batch={batch} settings={settings} receivedBy={data.staffNames[openInv.receivedBy]}
      toolbar={<>
        <button onClick={() => setInvoiceId(null)} className="inline-flex items-center gap-1 h-10 px-3 rounded-full text-[14px] font-medium text-zinc-700 hover:bg-white">← Back</button>
        <Button variant="primary" className="h-10 px-4" onClick={() => window.print()}>⬇ Download PDF</Button>
      </>} />
  );

  return (
    <div className="min-h-full pb-36 bg-[linear-gradient(180deg,#e8f6ec_0px,#f4faf5_260px,#f7f8f7_520px)]">
      {top}
      <main className="max-w-3xl mx-auto px-4 pt-5 space-y-4">
        {/* greeting */}
        <div className="flex items-center gap-3.5">
          {s.photo ? <img src={s.photo} alt="" className="size-14 rounded-2xl object-cover ring-2 ring-white shadow-md" />
            : <span className="size-14 rounded-2xl bg-[linear-gradient(135deg,#035a1d,#16b04a)] text-white grid place-items-center text-lg font-bold shadow-md">{initials}</span>}
          <div className="min-w-0">
            <div className="text-[13px] text-zinc-500">{hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'},</div>
            <h1 className="text-[22px] font-bold text-ink leading-tight truncate">{s.name.split(' ')[0]} 👋</h1>
          </div>
          <span className="ml-auto shrink-0"><Badge>{s.status}</Badge></span>
        </div>


        {tab === 'id' && <IdCardTab p={core} />}
        {tab === 'attendance' && <AttendanceTab p={core} markButton={<AttendanceButton classes={data.classes} marks={data.marks} batch={batch?.name} win={win} onOpen={() => setSheet(true)} />} />}
        {tab === 'courses' && <CoursesTab p={core} schedule={<MyClasses classes={data.classes} marks={data.marks} batch={batch?.name} onAttendance={() => { setTab('attendance'); setSheet(true); }} />} />}
        {tab === 'certs' && <CertsTab p={core} />}
        <AttendanceSheet open={sheet} token={token} setToken={setToken} classes={data.classes} marks={data.marks} onDone={load}
          onClose={() => { setSheet(false); setToken(null); if (location.pathname !== '/') history.replaceState(null, '', '/'); }} />

        {/* below the tabs: as before */}
        <InstallApp />
        <Reminders />
        <Card className="overflow-hidden rounded-3xl">
          <h2 className="px-4 pt-4 pb-2 font-bold text-[16px] text-ink">My fees</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border-t border-line">
            <Cell label="Total fee" value={fmtINR(f.total)} />
            <Cell label="Paid" value={<span className="text-accent">{fmtINR(f.paid)}</span>} foot={<span className="flex items-center gap-2"><span className="flex-1 max-w-24 h-1.5 rounded-full bg-zinc-200 overflow-hidden"><span className="block h-full bg-accent rounded-full" style={{ width: `${paidPct}%` }} /></span><b className="text-accent">{paidPct}%</b></span>} />
            <Cell label="Balance due" value={<span className={f.outstanding ? (overdue ? 'text-bad' : 'text-warn') : 'text-accent'}>{fmtINR(f.outstanding)}</span>} foot={overdue ? <span className="text-bad font-medium">{fmtINR(overdue)} overdue</span> : f.outstanding ? 'Nothing overdue' : 'Fully paid'} />
            <Cell label="Next payment" value={f.next ? fmtINR(f.next.remaining) : '—'} foot={f.next ? dueText(f.next.dueDate, today) : 'Nothing due'} />
          </div>
        </Card>

        <div>
          {/* schedule */}
          <Card className="rounded-3xl">
            <Head title="Fee schedule" />
            {!f.lines.length ? <Empty title="No fee plan yet" /> : (
              <ul className="divide-y divide-line">
                {f.lines.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={cx('size-2.5 rounded-full shrink-0', l.status === 'Paid' ? 'bg-accent' : l.status === 'Overdue' ? 'bg-bad' : l.status === 'Due Soon' || l.status === 'Partially Paid' ? 'bg-warn' : 'bg-zinc-300')} />
                    <div className="flex-1 min-w-0"><div className="font-medium">{l.label}</div><div className="text-[12px] text-muted">Due {fmtDate(l.dueDate)}{l.paid > 0 && l.remaining > 0 && ` · ${fmtINR(l.remaining)} left`}</div></div>
                    <div className="text-right"><div className="font-semibold tabular">{fmtINR(l.amount)}</div><Badge>{l.status}</Badge></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* payments */}
        <Card className="rounded-3xl">
          <Head title="My payments" />
          {!pays.length ? <Empty title="No payments yet" /> : (
            <ul className="divide-y divide-line">
              {pays.map((p) => {
                const st = p.kind === 'refund' ? 'Refund' : reversed.has(p.id) ? 'Cancelled' : p.verified ? 'Received' : 'Being confirmed';
                return (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0"><div className="font-medium">{fmtDate(p.date)} · {p.method}</div><div className="text-[12px] text-muted">{p.receiptNo ? `Receipt ${p.receiptNo}` : p.kind === 'refund' ? 'Refund' : ''}</div></div>
                    <div className="text-right"><div className={cx('font-semibold tabular', st === 'Cancelled' && 'line-through text-muted')}>{p.kind === 'refund' ? '−' : ''}{fmtINR(p.amount)}</div>
                      <Badge tone={st === 'Received' ? 'green' : st === 'Being confirmed' ? 'orange' : st === 'Refund' ? 'blue' : 'gray'}>{st}</Badge></div>
                    {p.kind === 'payment' && p.receiptNo && settings && (
                      <button onClick={() => { setInvoiceId(p.id); scrollTo(0, 0); }} className="shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-full bg-emerald-50 text-emerald-800 text-[12.5px] font-semibold border border-emerald-600/20 hover:bg-emerald-100">🧾 Invoice</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <p className="text-center text-[12px] text-muted">Questions about your fees? Contact the academy office.</p>
      </main>

      {/* the four main tabs, at the bottom like a phone app */}
      <nav aria-label="Student app" className="fixed bottom-0 inset-x-0 z-30 px-3 pt-2 pointer-events-none print:hidden" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}>
        <div className="pointer-events-auto mx-auto max-w-md grid grid-cols-4 gap-1 rounded-[24px] bg-white/95 backdrop-blur-md border border-emerald-900/10 p-1.5 shadow-[0_12px_32px_-10px_rgba(4,60,25,.45)]">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => { setTab(id); scrollTo({ top: 0, behavior: 'smooth' }); }} aria-current={tab === id ? 'page' : undefined}
              className={cx('flex flex-col items-center justify-center gap-1 rounded-[18px] py-2 px-0.5 text-[11.5px] font-semibold leading-tight text-center transition-all',
                tab === id ? 'bg-[linear-gradient(135deg,#046b23,#0e9f3d)] text-white shadow-[0_8px_16px_-8px_rgba(4,107,35,.9)]' : 'text-zinc-500 active:bg-emerald-50')}>
              <Ic d={TAB_ICONS[id]} className="size-6" />
              <span className="truncate max-w-full">{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

const dueText = (d: string, today: string) => { const n = daysBetween(today, d); return n < 0 ? <span className="text-bad font-medium">{fmtDate(d)} · {-n} days late</span> : n === 0 ? <span className="text-warn font-medium">Due today</span> : `${fmtDate(d)} · in ${n} days`; };
const Head = ({ title }: { title: string }) => <h2 className="px-4 pt-4 pb-2 font-semibold text-[15px] text-navy">{title}</h2>;
const Row = ({ k, v }: { k: string; v: ReactNode }) => <div className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="font-medium text-right">{v}</dd></div>;
function Cell({ label, value, foot }: { label: string; value: ReactNode; foot?: ReactNode }) {
  return (
    <div className="bg-surface px-4 py-3.5 min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-[19px] font-bold tabular text-navy leading-tight">{value}</div>
      {foot && <div className="mt-1 text-[11.5px] text-muted">{foot}</div>}
    </div>
  );
}

function MyClasses({ classes, marks, batch, onAttendance }: { classes: ClassSession[]; marks: ClassMark[]; batch?: string; onAttendance: () => void }) {
  const now = nowIST();
  const upcoming = classes.filter((c) => c.status === 'scheduled' && `${c.date}T${c.endTime}` > now).slice(0, 2); // only the next 2 classes
  const focus = focusClass ? classes.find((c) => c.id === focusClass) : undefined;
  useEffect(() => { if (focus) document.getElementById(`class-${focus.id}`)?.scrollIntoView({ block: 'center' }); }, [focus?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = focus && !upcoming.some((c) => c.id === focus.id) ? [focus, ...upcoming] : upcoming;
  if (!list.length) return null;
  return (
    <Card className="rounded-2xl">
      <div className="flex items-center justify-between pr-4"><Head title="Upcoming classes" /><Button size="sm" onClick={onAttendance}>✋ Attendance</Button></div>
      <ul className="divide-y divide-line">
        {list.map((c) => {
          const m = marks.find((x) => x.classId === c.id), live = `${c.date}T${c.startTime}` <= now && `${c.date}T${c.endTime}` > now;
          return (
            <li key={c.id} id={`class-${c.id}`} className={cx('flex items-center gap-3 px-4 py-3', c.id === focusClass && 'bg-accent-soft/70')}>
              <div className="w-14 shrink-0 text-center rounded-lg bg-surface border border-line py-1"><div className="text-[10.5px] font-semibold uppercase text-muted">{new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(new Date(`${c.date}T00:00:00Z`))}</div><div className="text-[18px] font-bold text-navy leading-none">{+c.date.slice(8)}</div></div>
              <div className="flex-1 min-w-0"><div className={cx('font-semibold', c.status === 'cancelled' && 'line-through text-muted')}>{batch ?? 'Class'}</div><div className="text-[12.5px] text-muted">{fmtTime(c.startTime)} – {fmtTime(c.endTime)}{c.notes ? ` · ${c.notes}` : ''}</div></div>
              {c.status === 'cancelled' ? <Badge tone="gray">Cancelled</Badge> : m?.status === 'present' ? <Badge tone="green">Present</Badge> : live ? <Badge tone="orange">On now</Badge> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Explains reminders first; the browser permission popup only appears when the student presses the button. */
function Reminders() {
  const [st, setSt] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  useEffect(() => { void pushState().then(setSt); }, []);
  // nothing to show once reminders are on (they keep working); the card only asks to turn them on
  if (!st || st === 'unsupported' || st === 'not-configured' || (st === 'on' && !msg)) return null;
  const on = async () => { setBusy(true); setMsg(null); try { await enablePush(); setSt('on'); setMsg({ tone: 'ok', text: 'Reminders are on for this device.' }); } catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }); setSt(await pushState()); } setBusy(false); };
  return (
    <Card className="rounded-2xl p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="size-10 rounded-full bg-accent-soft text-accent grid place-items-center text-[18px]">🔔</span>
        <div className="flex-1 min-w-[200px]">
          <div className="font-semibold text-ink">Class reminders</div>
          <div className="text-[12.5px] text-muted">{st === 'on' ? 'On for this device. You get a reminder 1 day before, at 8 AM on the day, and 30 minutes before each class.' : st === 'blocked' ? 'Notifications are blocked for this site. Allow them in your browser settings to get class reminders.' : 'Never miss a class: get a reminder 1 day before, on the morning of the class, and 30 minutes before it starts.'}</div>
        </div>
        {st === 'off' && <Button variant="primary" loading={busy} onClick={on}>Turn on reminders</Button>}
      </div>
      {msg && <p className={cx('mt-2 text-[12.5px]', msg.tone === 'ok' ? 'text-accent' : 'text-bad')}>{msg.text}</p>}
    </Card>
  );
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
/** Puts the portal on the phone's home screen like an app (needed on iPhone for notifications). Hidden once installed. */
function InstallApp() {
  const w = window as unknown as { installPrompt?: InstallEvent };
  const installed = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const [prompt, setPrompt] = useState<InstallEvent | undefined>(w.installPrompt);
  const [done, setDone] = useState(false);
  useEffect(() => { const f = () => setPrompt(w.installPrompt); addEventListener('installready', f); return () => removeEventListener('installready', f); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (installed || done || (!prompt && !ios)) return null;
  return (
    <Card className="rounded-2xl p-4">
      <div className="flex flex-wrap items-center gap-3">
        <img src="/icon-192.png" alt="" className="size-10 rounded-xl border border-line" />
        <div className="flex-1 min-w-[200px]">
          <div className="font-semibold text-ink">Install the InvestMore app</div>
          <div className="text-[12.5px] text-muted">{ios ? 'Tap the Share button (square with arrow) below, then "Add to Home Screen". Open the app from your home screen and turn on reminders there.' : 'Add it to your home screen: opens like an app and gets class reminders even when closed.'}</div>
        </div>
        {prompt && <Button variant="primary" onClick={async () => { await prompt.prompt(); const r = await prompt.userChoice; if (r.outcome === 'accepted') setDone(true); w.installPrompt = undefined; setPrompt(undefined); }}>Install app</Button>}
      </div>
    </Card>
  );
}

/** Camera scanner for the classroom QR (works inside the installed app too). Only our /attend links are accepted. */
function QrScanner({ open, onClose, onToken }: { open: boolean; onClose: () => void; onToken: (t: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return;
    setErr('');
    let stream: MediaStream | undefined, stop = false;
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    void (async () => {
      try {
        const { default: jsQR } = await import('jsqr');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stop) return stream.getTracks().forEach((t) => t.stop());
        const v = video.current!; v.srcObject = stream; await v.play();
        const look = () => {
          if (stop) return;
          if (v.videoWidth) {
            const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
            canvas.width = Math.round(v.videoWidth * k); canvas.height = Math.round(v.videoHeight * k);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            if (code?.data) {
              try {
                const u = new URL(code.data);
                const t = u.pathname === '/attend' ? u.searchParams.get('t') : null;
                if (t) { stop = true; onToken(t); return; }
              } catch { /* not a link */ }
              setErr('This is not the classroom attendance QR code.');
            }
          }
          setTimeout(look, 250);
        };
        look();
      } catch (e) {
        setErr((e as Error).name === 'NotAllowedError' ? 'Camera permission is blocked. Allow the camera for this app in your phone settings, or scan the QR with your phone camera.' : 'Could not open the camera on this device.');
      }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} title="Scan classroom QR">
      <div className="relative overflow-hidden rounded-xl bg-black aspect-square">
        <video ref={video} playsInline muted className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-[18%] rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,.35)]" />
      </div>
      <p className={cx('mt-3 text-center text-[13px]', err ? 'text-bad' : 'text-muted')}>{err || 'Point the camera at the QR code in the classroom.'}</p>
    </Modal>
  );
}

const openNow = (classes: ClassSession[], win: { beforeMins: number; afterMins: number }) => {
  const now = Date.now(), at = (d: string, t: string) => Date.parse(`${d}T${t}:00+05:30`);
  return classes.find((c) => c.status === 'scheduled' && now >= at(c.date, c.startTime) - win.beforeMins * 60000 && now <= at(c.date, c.endTime) + win.afterMins * 60000);
};

/** Big Attendance button at the top; turns green with "your class is on" while attendance is open and not yet marked. */
function AttendanceButton({ classes, marks, batch, win, onOpen }: { classes: ClassSession[]; marks: ClassMark[]; batch?: string; win: { beforeMins: number; afterMins: number }; onOpen: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  const live = openNow(classes, win);
  const done = live && marks.some((m) => m.classId === live.id && m.status === 'present');
  return (
    <button onClick={onOpen} className={cx('w-full rounded-2xl p-4 flex items-center gap-4 text-left shadow-sm transition-transform active:scale-[.99]',
      live && !done ? 'bg-accent text-white ring-4 ring-accent/25 animate-[pulse_2.5s_ease-in-out_infinite]' : 'bg-white border border-line')}>
      <span className={cx('size-12 rounded-xl grid place-items-center text-[24px] shrink-0', live && !done ? 'bg-white/20' : 'bg-accent-soft')}>✋</span>
      <span className="flex-1 min-w-0">
        <span className={cx('block font-bold text-[17px]', live && !done ? 'text-white' : 'text-navy')}>Attendance</span>
        <span className={cx('block text-[13px]', live && !done ? 'text-white/90' : 'text-muted')}>
          {live ? (done ? `Marked present for today's class` : `Your ${batch ?? ''} class is on now (${fmtTime(live.startTime)} – ${fmtTime(live.endTime)}) — tap to mark attendance`) : 'See your class details and mark attendance'}
        </span>
      </span>
      <span className={cx('text-[22px]', live && !done ? 'text-white' : 'text-zinc-400')}>›</span>
    </button>
  );
}

type Lookup = { ok: boolean; reason?: string; open?: boolean; noQrAllowed?: boolean; classId?: string; date?: string; start?: string; end?: string; notes?: string;
  batch?: string; course?: string; teacher?: string; already?: boolean; at?: string; method?: string };
/** The student's Attendance screen: today's / next class details, mark attendance (scan QR or, if allowed, directly), and their record. */
function AttendanceSheet({ open, token, setToken, classes, marks, onDone, onClose }: {
  open: boolean; token: string | null; setToken: (t: string | null) => void; classes: ClassSession[]; marks: ClassMark[]; onDone: () => void; onClose: () => void;
}) {
  const [info, setInfo] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState<{ at: string; method: string } | null>(null);
  const check = () => { setInfo(null); setMsg(''); void sb!.rpc('attend_lookup', { p_token: token }).then(({ data, error }) => setInfo(error ? { ok: false, reason: error.message } : (data as Lookup))); };
  useEffect(() => { if (open) { setDone(null); check(); } }, [open, token]); // eslint-disable-line react-hooks/exhaustive-deps
  const mark = async (withQr: boolean) => {
    setBusy(true); setMsg('');
    const { data, error } = await sb!.rpc('attend_mark', { p_token: withQr ? token : null });
    setBusy(false);
    const r = data as (Lookup & { method?: string }) | null;
    if (error || !r?.ok) return setMsg(error?.message ?? r?.reason ?? 'Could not mark attendance.');
    setDone({ at: r.at!, method: r.method ?? (withQr ? 'qr' : 'app') }); onDone();
  };
  // my record (classes held so far)
  const now = nowIST();
  const held = classes.filter((c) => c.status === 'scheduled' && `${c.date}T${c.startTime}` <= now);
  const stateOf = (c: ClassSession) => { const m = marks.find((x) => x.classId === c.id); return m ? m.status : `${c.date}T${c.endTime}` <= now ? 'absent' : 'none'; };
  const presentN = held.filter((c) => stateOf(c) === 'present').length;
  const present = done || info?.already;
  const how = (m?: string) => (m === 'qr' ? 'by QR scan' : m === 'app' ? 'in the app' : m === 'manual' ? 'by the office' : '');

  return (
    <Modal open={open} onClose={onClose} title="Attendance">
      {!info ? <p className="py-8 text-center text-muted">Checking your class…</p> : (
        <div className="space-y-4">
          {info.classId && (
            <div className="rounded-xl border border-line overflow-hidden">
              <div className={cx('px-4 py-2 text-[12px] font-semibold uppercase tracking-wider', info.open ? 'bg-accent text-white' : 'bg-surface text-muted')}>{info.open ? 'Class on now' : 'Next class'}</div>
              <dl className="p-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
                <dt className="text-muted">Course</dt><dd className="font-semibold">{info.course ?? '—'}</dd>
                <dt className="text-muted">Batch</dt><dd className="font-semibold">{info.batch}</dd>
                <dt className="text-muted">Date</dt><dd className="font-semibold">{fmtDate(info.date!)}</dd>
                <dt className="text-muted">Time</dt><dd className="font-semibold">{fmtTime(info.start!)} – {fmtTime(info.end!)}</dd>
                {info.teacher && <><dt className="text-muted">Teacher</dt><dd className="font-semibold">{info.teacher}</dd></>}
                {info.notes && <><dt className="text-muted">Topic</dt><dd className="font-semibold">{info.notes}</dd></>}
              </dl>
            </div>
          )}

          {present ? (
            <div className="text-center rounded-xl bg-emerald-50 border border-emerald-200 p-4">
              <div className="mx-auto size-14 rounded-full bg-emerald-500 text-white grid place-items-center text-[28px]">✓</div>
              <div className="mt-2 text-[18px] font-bold text-emerald-700">{done ? 'You are marked present!' : 'Already marked present'}</div>
              <div className="text-[12.5px] text-zinc-600">{fmtDateTime(done?.at ?? info.at ?? '')} {how(done?.method ?? info.method)}</div>
            </div>
          ) : info.ok && info.open ? (
            <div className="space-y-2">
              {token ? (
                <Button variant="primary" className="w-full h-12 text-[16px]" loading={busy} onClick={() => mark(true)}>✓ Mark my attendance</Button>
              ) : <>
                <Button variant="primary" className="w-full h-12 text-[16px]" onClick={() => setScan(true)}>📷 Scan classroom QR</Button>
                {info.noQrAllowed && <Button className="w-full h-11" loading={busy} onClick={() => mark(false)}>Can't scan? Mark without QR</Button>}
              </>}
              {token && <p className="text-center text-[12px] text-emerald-700">QR code scanned ✓</p>}
            </div>
          ) : (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-[13px] text-amber-900">{info.reason}</div>
          )}
          {msg && <p className="rounded-lg bg-bad-soft text-bad px-3 py-2 text-[13px]">{msg}</p>}

          <div>
            <div className="flex items-baseline justify-between"><span className="font-semibold text-navy">My attendance</span>
              <span className="text-[13px] text-zinc-600 tabular">{presentN} of {held.length} classes{held.length ? ` · ${Math.round((presentN / held.length) * 100)}%` : ''}</span></div>
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {!held.length ? <li className="px-3 py-3 text-[13px] text-muted">No classes held yet.</li> : [...held].reverse().slice(0, 8).map((c) => {
                const st = stateOf(c);
                return <li key={c.id} className="flex items-center gap-2.5 px-3 py-2 text-[13px]"><span className={cx('size-2.5 rounded-full', st === 'present' ? 'bg-emerald-500' : st === 'absent' ? 'bg-red-500' : 'bg-zinc-300')} /><span className="flex-1">{fmtDate(c.date)} · {fmtTime(c.startTime)}</span><span className={cx('font-medium', st === 'present' ? 'text-emerald-700' : st === 'absent' ? 'text-red-600' : 'text-muted')}>{st === 'present' ? 'Present' : st === 'absent' ? 'Absent' : 'Not marked'}</span></li>;
              })}
            </ul>
          </div>
        </div>
      )}
      <QrScanner open={scan} onClose={() => setScan(false)} onToken={(t) => { setScan(false); setToken(t); }} />
    </Modal>
  );
}

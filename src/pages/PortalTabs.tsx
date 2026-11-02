import { useEffect, useState, type ReactNode } from 'react';
import { sb } from '../store/cloud';
import { certificatePdf, saveBlob } from '../lib/certpdf';
import type { Batch, BatchVideo, CertificateTemplate, ClassMark, ClassSession, Course, Student } from '../domain/types';
import { fmtDate, fmtDateTime, fmtPhone, fmtTime, nowIST } from '../domain/util';
import { Button, Modal, cx } from '../ui/kit';

/* The student app's four main tabs: ID card · Attendance · Courses · Certificates & kits. Brand green throughout. */

export type PortalCore = {
  student: Student; course?: Course; batch?: Batch; teacher?: string; academy?: string;
  classes: ClassSession[]; marks: ClassMark[]; videos: BatchVideo[]; youtubeChannel?: string;
  certificates: { id: string; issued_at: string; status: string }[];
};
export type PortalTab = 'id' | 'attendance' | 'courses' | 'certs';

export const TAB_ICONS: Record<PortalTab, string> = {
  id: 'M3 5h18v14H3zM7 15c.6-1.6 1.8-2.4 3-2.4s2.4.8 3 2.4M10 11a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6ZM15 9h3M15 12h3',
  attendance: 'M8 3v3M16 3v3M3 8h18M4 5h16v15H4zM9 14l2 2 4-4',
  courses: 'M3 6l9-3 9 3-9 3zM7 8v5c1.5 1.5 3 2 5 2s3.5-.5 5-2V8M21 6v6',
  certs: 'M12 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM8.5 13.5 7 21l5-2.5 5 2.5-1.5-7.5',
};
export const Ic = ({ d, className = 'size-5' }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
const initialsOf = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const Panel = ({ title, right, children, className }: { title?: string; right?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={cx('rounded-3xl bg-white border border-emerald-900/5 shadow-[0_8px_24px_-16px_rgba(4,80,30,.35)]', className)}>
    {title && <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-1"><h3 className="font-bold text-[16px] text-ink">{title}</h3>{right}</div>}
    {children}
  </section>
);

/* ------------------------------------------------ ID card ------------------------------------------------ */
export function IdCardTab({ p }: { p: PortalCore }) {
  const s = p.student;
  const [qr, setQr] = useState('');
  useEffect(() => { void import('qrcode').then((Q) => Q.toDataURL(s.code, { width: 240, margin: 1, color: { dark: '#04391a', light: '#ffffff' } })).then(setQr); }, [s.code]);
  const rows: [string, ReactNode][] = [
    ['Full name', s.name], ['Student ID', <span className="tabular">{s.code}</span>], ['Mobile', fmtPhone(s.phone)], ['Email', s.email || '—'],
    ['Date of birth', s.dob ? fmtDate(s.dob) : '—'], ['Gender', s.gender || '—'],
    ['Address', [s.address, s.city, s.state, s.pin].filter(Boolean).join(', ') || '—'],
    ['Course', p.course?.name ?? '—'], ['Batch', p.batch ? `${p.batch.name} · ${p.batch.timing}` : 'Not assigned yet'], ['Teacher', p.teacher ?? '—'],
    ['Admission date', fmtDate(s.admissionDate)], ['Status', s.status],
  ];
  return (
    <div className="space-y-4">
      {/* the card */}
      <div className="relative overflow-hidden rounded-[28px] p-5 sm:p-6 text-white shadow-[0_18px_40px_-18px_rgba(2,90,30,.75)] bg-[linear-gradient(135deg,#035a1d_0%,#058a2e_55%,#16b04a_100%)]">
        <span className="absolute -top-16 -right-14 size-56 rounded-full bg-white/10" aria-hidden />
        <span className="absolute -bottom-24 -left-10 size-56 rounded-full bg-black/10" aria-hidden />
        <div className="relative flex items-center gap-2.5">
          <span className="size-9 rounded-xl bg-white grid place-items-center overflow-hidden"><img src="/logo-mark.png" alt="" className="w-[85%]" /></span>
          <div className="leading-tight"><div className="font-bold tracking-[0.16em] text-[13px]">INVESTMORE</div><div className="text-[10px] tracking-[0.28em] text-white/75">TRAINING ACADEMY</div></div>
          <span className="ml-auto rounded-full bg-white/15 border border-white/20 px-2.5 py-1 text-[10.5px] font-semibold tracking-wider">STUDENT ID</span>
        </div>
        <div className="relative mt-5 flex items-center gap-4">
          {s.photo ? <img src={s.photo} alt="" className="size-24 rounded-2xl object-cover ring-4 ring-white/80 shadow-lg" />
            : <span className="size-24 rounded-2xl bg-white/20 ring-4 ring-white/60 grid place-items-center text-3xl font-bold">{initialsOf(s.name)}</span>}
          <div className="min-w-0">
            <div className="text-[22px] font-bold leading-tight truncate">{s.name}</div>
            <div className="mt-1 inline-flex items-center rounded-lg bg-white text-[#035a1d] px-2 py-0.5 text-[13px] font-bold tabular tracking-wide">{s.code}</div>
            <div className="mt-1.5 text-[13px] text-white/85 truncate">{p.course?.name ?? 'Course'}</div>
          </div>
        </div>
        <div className="relative mt-5 flex items-end gap-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] flex-1 min-w-0">
            <div><dt className="text-white/65">Batch</dt><dd className="font-semibold truncate">{p.batch?.name ?? '—'}</dd></div>
            <div><dt className="text-white/65">Mobile</dt><dd className="font-semibold tabular">{fmtPhone(s.phone)}</dd></div>
            <div><dt className="text-white/65">Joined</dt><dd className="font-semibold tabular">{fmtDate(s.admissionDate)}</dd></div>
            <div><dt className="text-white/65">Valid till</dt><dd className="font-semibold tabular">{p.batch ? fmtDate(p.batch.endDate) : '—'}</dd></div>
          </dl>
          {qr && <img src={qr} alt={`QR code for ${s.code}`} className="size-20 rounded-xl bg-white p-1.5 shrink-0" />}
        </div>
      </div>

      <Panel title="Personal details">
        <dl className="px-5 pb-4 pt-1 divide-y divide-zinc-100">
          {rows.map(([k, v]) => <div key={k} className="flex items-start justify-between gap-4 py-2.5 text-[13.5px]"><dt className="text-zinc-500 shrink-0">{k}</dt><dd className="font-semibold text-ink text-right">{v}</dd></div>)}
        </dl>
      </Panel>
      <p className="text-center text-[12px] text-zinc-500">Something wrong? Ask the academy office to correct it.</p>
    </div>
  );
}

/* ------------------------------------------------ attendance ------------------------------------------------ */
export function AttendanceTab({ p, markButton }: { p: PortalCore; markButton: ReactNode }) {
  const now = nowIST();
  const held = p.classes.filter((c) => c.status === 'scheduled' && `${c.date}T${c.startTime}` <= now);
  const stateOf = (c: ClassSession) => { const m = p.marks.find((x) => x.classId === c.id); return m ? m.status : `${c.date}T${c.endTime}` <= now ? 'absent' : 'none'; };
  const present = held.filter((c) => stateOf(c) === 'present').length;
  const absent = held.filter((c) => stateOf(c) === 'absent').length;
  const pct = held.length ? Math.round((present / held.length) * 100) : 0;
  const R = 42, C = 2 * Math.PI * R;
  const last = [...held].slice(-10);
  return (
    <div className="space-y-4">
      {markButton}
      <Panel className="p-5">
        <div className="flex items-center gap-5">
          <div className="relative size-28 shrink-0">
            <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
              <circle cx="50" cy="50" r={R} fill="none" stroke="#e7f5ea" strokeWidth="11" />
              <circle cx="50" cy="50" r={R} fill="none" stroke="#058a2e" strokeWidth="11" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center"><div><div className="text-[24px] font-bold text-ink leading-none tabular">{held.length ? `${pct}%` : '—'}</div><div className="text-[10.5px] text-zinc-500 mt-1">attendance</div></div></div>
          </div>
          <div className="grid grid-cols-3 gap-2 flex-1">
            <Stat label="Classes" value={held.length} />
            <Stat label="Present" value={present} tone="text-emerald-600" />
            <Stat label="Absent" value={absent} tone="text-red-500" />
          </div>
        </div>
        {last.length > 0 && (
          <div className="mt-4">
            <div className="text-[11.5px] text-zinc-500 mb-1.5">Last {last.length} classes</div>
            <div className="flex gap-1.5">{last.map((c) => { const st = stateOf(c); return <span key={c.id} title={`${fmtDate(c.date)}: ${st}`} className={cx('h-7 flex-1 rounded-md', st === 'present' ? 'bg-emerald-500' : st === 'absent' ? 'bg-red-400' : 'bg-zinc-200')} />; })}</div>
          </div>
        )}
        {held.length > 0 && pct < 75 && <p className="mt-3 rounded-xl bg-amber-50 text-amber-800 text-[12.5px] px-3 py-2">Your attendance is below 75%. Try not to miss the next classes.</p>}
      </Panel>
      <Panel title="Class history">
        {!held.length ? <p className="px-5 pb-5 pt-1 text-[13px] text-zinc-500">No classes held yet.</p> : (
          <ul className="px-3 pb-3">
            {[...held].reverse().map((c) => {
              const st = stateOf(c), m = p.marks.find((x) => x.classId === c.id);
              return (
                <li key={c.id} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-zinc-50">
                  <span className={cx('size-10 rounded-xl grid place-items-center text-[16px] font-bold shrink-0', st === 'present' ? 'bg-emerald-100 text-emerald-700' : st === 'absent' ? 'bg-red-100 text-red-600' : 'bg-zinc-100 text-zinc-500')}>{st === 'present' ? '✓' : st === 'absent' ? '✕' : '•'}</span>
                  <div className="flex-1 min-w-0"><div className="font-semibold text-[14px]">{fmtDate(c.date)}</div><div className="text-[12px] text-zinc-500">{fmtTime(c.startTime)} – {fmtTime(c.endTime)}{c.notes ? ` · ${c.notes}` : ''}</div></div>
                  <div className="text-right"><div className={cx('text-[13px] font-semibold', st === 'present' ? 'text-emerald-700' : st === 'absent' ? 'text-red-600' : 'text-zinc-500')}>{st === 'present' ? 'Present' : st === 'absent' ? 'Absent' : 'Not marked'}</div>
                    {m?.status === 'present' && <div className="text-[11px] text-zinc-400">{fmtDateTime(m.at).split(',').pop()?.trim()}</div>}</div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
const Stat = ({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) => (
  <div className="rounded-2xl bg-zinc-50 px-2 py-3 text-center"><div className={cx('text-[22px] font-bold tabular leading-none', tone ?? 'text-ink')}>{value}</div><div className="text-[11px] text-zinc-500 mt-1">{label}</div></div>
);

/* ------------------------------------------------ courses ------------------------------------------------ */
export function CoursesTab({ p, schedule }: { p: PortalCore; schedule: ReactNode }) {
  const [play, setPlay] = useState<BatchVideo | null>(null);
  const [q, setQ] = useState('');
  const [allOpen, setAllOpen] = useState(false); // the full lecture list
  const t = q.trim().toLowerCase();
  const all = [...p.videos].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
  const num = (v: BatchVideo) => all.length - all.indexOf(v);                       // Lecture 1 = the first one added
  const vids = all.filter((v) => !t || v.title.toLowerCase().includes(t) || v.notes.toLowerCase().includes(t));
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-[28px] p-5 text-white bg-[linear-gradient(135deg,#04391a_0%,#06702a_60%,#0d9b3c_100%)] shadow-[0_18px_40px_-20px_rgba(2,90,30,.8)]">
        <span className="absolute -right-10 -top-10 size-40 rounded-full bg-white/10" aria-hidden />
        <div className="relative">
          <div className="text-[11px] font-semibold tracking-[0.2em] text-white/70">MY COURSE</div>
          <div className="mt-1 text-[22px] font-bold leading-tight">{p.course?.name ?? 'Course'}</div>
          {p.course?.description && <p className="mt-1 text-[13px] text-white/80 line-clamp-2">{p.course.description}</p>}
          <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
            {p.batch && <Chip>{p.batch.name}</Chip>}
            {p.batch && <Chip>{p.batch.schedule} · {p.batch.timing}</Chip>}
            {p.course && <Chip>{p.course.durationWeeks} weeks</Chip>}
            {p.teacher && <Chip>Teacher: {p.teacher}</Chip>}
          </div>
        </div>
      </div>

      {schedule}
      <Panel title="Lectures" right={p.youtubeChannel && <a href={p.youtubeChannel} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-red-600 text-white text-[12px] font-semibold px-3 py-1.5 hover:bg-red-700">▶ YouTube channel</a>}>
        {!p.videos.length ? <p className="px-5 pb-5 pt-1 text-[13px] text-zinc-500">Your class recordings will appear here.</p> : (
          <div className="p-4 grid sm:grid-cols-2 gap-3">
            {all.slice(0, 3).map((v, i) => (
              <button key={v.id} onClick={() => setPlay(v)} className="text-left rounded-2xl overflow-hidden border border-zinc-100 bg-white hover:shadow-md transition-shadow group">
                <span className="relative block aspect-video bg-black">
                  <img src={`https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`} alt="" className="size-full object-cover" loading="lazy" />
                  <span className="absolute inset-0 grid place-items-center"><span className="size-12 rounded-full bg-white/90 text-emerald-700 grid place-items-center text-[18px] shadow-lg group-hover:scale-110 transition-transform">▶</span></span>
                  <span className="absolute top-2 left-2 rounded-lg bg-emerald-700 text-white text-[11px] font-bold px-2 py-0.5">Lecture {num(v)}</span>
                  {i === 0 && <span className="absolute top-2 right-2 rounded-lg bg-amber-400 text-amber-950 text-[11px] font-bold px-2 py-0.5">New</span>}
                </span>
                <span className="block p-3"><span className="block font-semibold text-[14px] text-ink leading-snug line-clamp-2">{v.title}</span>
                  <span className="block mt-0.5 text-[12px] text-zinc-500">{fmtDate(v.createdAt.slice(0, 10))}{v.notes ? ` · ${v.notes}` : ''}</span></span>
              </button>
            ))}
          </div>
        )}
        {all.length > 3 && (
          <div className="px-4 pb-4 -mt-1">
            <button onClick={() => { setQ(''); setAllOpen(true); }} className="w-full h-11 rounded-2xl border-2 border-emerald-600/20 bg-emerald-50 text-emerald-800 font-semibold text-[14px] hover:bg-emerald-100 transition-colors">
              See all {all.length} lectures →
            </button>
          </div>
        )}
      </Panel>
      <Modal open={allOpen} onClose={() => setAllOpen(false)} title={`All lectures (${all.length})`}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lectures" className="w-full h-11 rounded-2xl bg-zinc-100 px-4 text-[14px] outline-none focus:ring-2 focus:ring-emerald-500/40" />
        <ul className="mt-3 space-y-2">
          {vids.map((v) => (
            <li key={v.id}>
              <button onClick={() => setPlay(v)} className="w-full flex items-center gap-3 rounded-2xl p-2 text-left hover:bg-emerald-50 transition-colors">
                <span className="relative w-28 shrink-0 aspect-video rounded-xl overflow-hidden bg-black">
                  <img src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`} alt="" className="size-full object-cover" loading="lazy" />
                  <span className="absolute inset-0 grid place-items-center"><span className="size-7 rounded-full bg-white/90 text-emerald-700 grid place-items-center text-[11px]">▶</span></span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-bold text-emerald-700">Lecture {num(v)}</span>
                  <span className="block font-semibold text-[14px] text-ink leading-snug line-clamp-2">{v.title}</span>
                  <span className="block text-[12px] text-zinc-500">{fmtDate(v.createdAt.slice(0, 10))}</span>
                </span>
              </button>
            </li>
          ))}
          {!vids.length && <li className="text-center text-[13px] text-zinc-500 py-6">No lecture matches "{q}".</li>}
        </ul>
      </Modal>
      <Modal open={!!play} onClose={() => setPlay(null)} title={play?.title ?? 'Lecture'} wide>
        {play && <>
          <div className="aspect-video rounded-xl overflow-hidden bg-black"><iframe src={`https://www.youtube-nocookie.com/embed/${play.videoId}?rel=0&modestbranding=1&autoplay=1&playsinline=1`} title={play.title} className="size-full" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>
          {play.notes && <p className="mt-3 text-[13.5px] text-zinc-700">{play.notes}</p>}
        </>}
      </Modal>
    </div>
  );
}
const Chip = ({ children }: { children: ReactNode }) => <span className="rounded-full bg-white/15 border border-white/20 px-2.5 py-1 font-medium">{children}</span>;

/* ------------------------------------------------ certificates & kits ------------------------------------------------ */
export function CertsTab({ p }: { p: PortalCore }) {
  const s = p.student;
  const cert = p.certificates.find((c) => c.status === 'Issued');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const download = async () => {
    if (!cert) return;
    setBusy(true); setErr('');
    try {
      const { data, error } = await sb!.rpc('my_certificate', { p_id: cert.id });
      if (error || !data) throw new Error(error?.message ?? 'Certificate not found.');
      const d = data as { cert: { id: string; data: { name: string; course: string; date: string; batch: string } }; template: CertificateTemplate };
      saveBlob(await certificatePdf(d.template, d.cert, s.photo), `${d.cert.id}.pdf`);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <div className={cx('p-5 flex items-center gap-4', cert ? 'bg-[linear-gradient(135deg,#fff8e1,#fff)]' : '')}>
          <span className={cx('size-16 rounded-2xl grid place-items-center shrink-0', cert ? 'bg-amber-400 text-amber-950' : 'bg-zinc-100 text-zinc-400')}><Ic d={TAB_ICONS.certs} className="size-8" /></span>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[17px] text-ink">Course certificate</div>
            <div className="text-[13px] text-zinc-600">{cert ? `Issued on ${fmtDate(cert.issued_at.slice(0, 10))} · ${cert.id}` : s.status === 'Completed' ? 'You have completed the course — your certificate is being prepared.' : 'You get your certificate when you complete the course.'}</div>
          </div>
        </div>
        {cert && <div className="px-5 pb-5"><Button variant="primary" className="w-full h-12 text-[15px]" loading={busy} onClick={download}>⬇ Download certificate (PDF)</Button>{err && <p className="mt-2 text-[12.5px] text-red-600">{err}</p>}</div>}
      </Panel>
      <Panel className="p-5">
        <div className="flex items-center gap-4">
          <span className={cx('size-16 rounded-2xl grid place-items-center shrink-0', s.kitReceivedAt ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-600')}>
            <Ic d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9" className="size-8" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[17px] text-ink">Course kit</div>
            <div className={cx('text-[13px] font-medium', s.kitReceivedAt ? 'text-emerald-700' : 'text-orange-700')}>{s.kitReceivedAt ? `✓ Received on ${fmtDate(s.kitReceivedAt.slice(0, 10))}` : 'Not received yet — collect it from the academy office.'}</div>
          </div>
        </div>
      </Panel>
      <KitGallery />
    </div>
  );
}

const KIT: [string, string][] = [
  ['trading-kit', 'Trading kit'], ['id-card', 'Live trading ID card'], ['laptop-bag', 'Laptop bag'], ['t-shirt', 'Black T-shirt'],
  ['candlesticks', 'Candlesticks pattern book'], ['chart-patterns', 'Chart patterns sheet'], ['notes', 'Hard copy notes'], ['diary', 'Diary'],
  ['pen', 'Pen'], ['water-bottle', 'Water bottle'], ['certificate', 'Course certificate'], ['trophy', 'Achiever trophy'],
];

/** What's in the kit: tap any item to see it big; swipe or use arrows to move between items. */
function KitGallery() {
  const [open, setOpen] = useState<number | null>(null);
  const [x0, setX0] = useState<number | null>(null);
  const go = (n: number) => setOpen((i) => (i === null ? i : (i + n + KIT.length) % KIT.length));
  useEffect(() => {
    if (open === null) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [open]);
  return (
    <Panel className="overflow-hidden bg-[radial-gradient(120%_80%_at_50%_0%,#123a1c,#07120a_70%)] border-transparent">
      <div className="px-5 pt-5 pb-3">
        <div className="text-[11px] font-semibold uppercase tracking-[.18em] text-[#7CFC4E]">Inside your kit</div>
        <div className="font-bold text-[18px] text-white">{KIT.length} items for your trading journey</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 px-4 pb-5">
        {KIT.map(([f, name], i) => (
          <button key={f} onClick={() => setOpen(i)} style={{ animationDelay: `${i * 60}ms` }}
            className="kit-rise group relative aspect-square overflow-hidden rounded-2xl bg-black ring-1 ring-white/10 hover:ring-[#7CFC4E]/60 transition-[box-shadow] shadow-[0_8px_24px_rgba(0,0,0,.35)] focus-visible:outline-2 focus-visible:outline-[#7CFC4E]">
            <img src={`/kit/${f}-sm.webp`} alt={name} loading="lazy" className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06] group-active:scale-[.98]" />
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-3 pt-8 pb-2.5 text-left text-[12.5px] font-semibold text-white">{name}</span>
          </button>
        ))}
      </div>
      {open !== null && (
        <div className="kit-fade fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-sm" onClick={() => setOpen(null)}
          onTouchStart={(e) => setX0(e.touches[0].clientX)} onTouchEnd={(e) => { if (x0 !== null && Math.abs(e.changedTouches[0].clientX - x0) > 50) go(e.changedTouches[0].clientX < x0 ? 1 : -1); setX0(null); }}>
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="text-[13px] tabular text-white/60">{open + 1} / {KIT.length}</span>
            <button aria-label="Close" className="size-10 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 text-[20px]">✕</button>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center px-3">
            <img key={open} src={`/kit/${KIT[open][0]}.webp`} alt={KIT[open][1]} onClick={(e) => e.stopPropagation()} className="kit-zoom max-h-full max-w-full rounded-2xl object-contain shadow-[0_20px_60px_rgba(124,252,78,.15)]" />
          </div>
          <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <button aria-label="Previous" onClick={() => go(-1)} className="size-12 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white text-[22px]">‹</button>
            <span className="text-center font-semibold text-white text-[16px]">{KIT[open][1]}</span>
            <button aria-label="Next" onClick={() => go(1)} className="size-12 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white text-[22px]">›</button>
          </div>
        </div>
      )}
    </Panel>
  );
}

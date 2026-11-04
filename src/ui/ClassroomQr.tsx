import { useEffect, useState } from 'react';
import { sb } from '../store/cloud';
import * as S from '../store/store';
import { attendUrl, qrOnly, qrPoster } from '../lib/qrPoster';
import { Button, Card, Field, Input, Modal, cx, useRun, useUI } from './kit';
import { addDays, batchTimes, fmtDate, fmtTime, todayIST } from '../domain/util';
import type { Batch } from '../domain/types';

/**
 * The permanent classroom attendance QR. One code for the whole academy, valid until someone makes a new one.
 * Print the poster once and stick it on the wall: students scan it with the phone camera, the student app opens
 * (they sign in once and stay signed in) and they tap "Mark my attendance" for the class their batch has right now.
 */
function QrCard({ canEdit = true }: { canEdit?: boolean }) {
  const db = S.useDB();
  const { ask, toast } = useUI();
  const [token, setToken] = useState<string | null>(null);
  const [qr, setQr] = useState('');
  const [poster, setPoster] = useState('');
  const url = token ? attendUrl(token) : '';

  const load = async (regen = false) => {
    const { data, error } = await sb!.rpc('classroom_qr_token', { p_regenerate: regen });
    if (error) return toast(error.message, 'bad');
    setToken(String(data));
  };
  useEffect(() => { if (sb) void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!url) return;
    let live = true;
    void qrOnly(url).then((v) => live && setQr(v));
    void qrPoster(url, db.settings.academyName).then((v) => live && setPoster(v));
    return () => { live = false; };
  }, [url, db.settings.academyName]);

  const print = () => {
    const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print the poster.', 'bad');
    w.document.write(`<!doctype html><title>Attendance QR poster</title><style>@page{size:A4;margin:0}body{margin:0}img{width:100%;display:block}</style><img src="${poster}"><script>onload=()=>setTimeout(()=>print(),300)<\/script>`);
    w.document.close();
  };
  const btn = 'inline-flex items-center justify-center gap-1.5 rounded-full font-medium h-10 px-4 border border-line bg-white hover:border-zinc-300 transition-colors';

  if (!sb) return <Card className="p-5"><div className="font-semibold">Classroom QR code</div><p className="text-[13px] text-muted mt-1">The permanent QR needs the online database, so it isn’t available in offline mode.</p></Card>;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto min-w-0"><div className="font-semibold text-[15px]">Classroom QR code <span className="ml-1 rounded-full bg-lime px-2 py-0.5 text-[11px] font-bold align-middle">Permanent</span></div>
          <p className="text-[13px] text-muted mt-0.5 max-w-xl">Print it once and paste it on the classroom wall. Students scan it with their phone camera, the student app opens, and they tap <b>Mark my attendance</b>. It never expires.</p></div>
      </div>
      <div className="mt-4 grid sm:grid-cols-[auto_1fr] gap-5 items-start">
        <div className="rounded-3xl border-4 border-lime p-2 bg-white w-fit">{qr ? <img src={qr} alt="Classroom attendance QR code" className="size-48 sm:size-56" /> : <div className="size-48 sm:size-56 grid place-items-center text-muted">Loading…</div>}</div>
        <div className="space-y-3 min-w-0">
          <div className="flex flex-wrap gap-2">
            <a href={poster} download="attendance-qr-poster.png" className={cx(btn, '!bg-ink !text-white !border-ink hover:!bg-zinc-800', !poster && 'pointer-events-none opacity-50')}>⤓ Download poster (A4)</a>
            <Button disabled={!poster} onClick={print}>🖨 Print poster</Button>
            <a href={qr} download="attendance-qr.png" className={cx(btn, !qr && 'pointer-events-none opacity-50')}>QR only (PNG)</a>
          </div>
          <div className="rounded-xl bg-surface px-3 py-2 text-[12px] text-muted break-all"><span className="font-semibold text-ink">Link inside the QR:</span> {url || '…'}
            {url && <button className="ml-2 font-semibold text-accent hover:underline" onClick={() => { void navigator.clipboard?.writeText(url); toast('Link copied'); }}>Copy</button>}</div>
          <ul className="text-[12.5px] text-zinc-600 space-y-1 list-disc pl-4">
            <li>Students sign in <b>once</b> with their Student ID and stay signed in on that phone.</li>
            <li>A student can mark only for <b>their own batch’s class</b>, only during the attendance window, and only once per class.</li>
            <li>Anyone with a photo of the code could try to scan it from outside, so the time window and batch checks are what keep it fair.</li>
          </ul>
          {canEdit && <Button variant="danger" onClick={async () => {
            if (await ask({ title: 'Make a new QR code?', message: 'The printed poster on the wall stops working straight away. You must print and paste the new one. Only do this if the code has leaked.', confirm: 'Make new code', danger: true })) {
              setQr(''); setPoster(''); await load(true); toast('New QR code made — print the new poster', 'ok');
            }
          }}>Make a new code…</Button>}
        </div>
      </div>
    </Card>
  );
}

/** The QR page: the QR itself, and whether every running batch actually has a class for students to mark. */
export default function ClassroomQr({ canEdit = true }: { canEdit?: boolean }) {
  return <div className="space-y-4"><QrCard canEdit={canEdit} /><Readiness canEdit={canEdit} /></div>;
}

// ------------------------------------------------------------------ is attendance ready?
const DAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
/** A guess from the batch's "schedule" text (e.g. "Mon–Fri", "Sat & Sun") that staff can change. */
const guessDays = (t: string) => (/sat.*sun|weekend/i.test(t) ? [6, 0] : /mon.*sat/i.test(t) ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);

function Readiness({ canEdit }: { canEdit: boolean }) {
  const db = S.useDB();
  const [sched, setSched] = useState<Batch | null>(null);
  const [bulkOk, setBulkOk] = useState<boolean | null>(null);
  const today = todayIST();
  const canCreate = canEdit && S.allowed('batches', 'create', db);
  useEffect(() => { if (!sb) return setBulkOk(true); void sb.rpc('bulk_schedule_ready').then(({ data, error }) => setBulkOk(!error && data === true)); }, []);
  const rows = db.batches.filter((b) => b.status === 'running').map((b) => {
    const mine = db.classes.filter((c) => c.batchId === b.id && c.status === 'scheduled').sort((x, y) => `${x.date}${x.startTime}`.localeCompare(`${y.date}${y.startTime}`));
    return { b, now: mine.find((c) => c.date === today), next: mine.find((c) => c.date > today), n: db.students.filter((s) => s.batchId === b.id && !['Dropped', 'Refunded'].includes(s.status)).length };
  });
  const missing = rows.filter((r) => !r.now).length;
  return (
    <Card className="p-5">
      <div className="font-semibold text-[15px]">Is attendance ready for today?</div>
      <p className="text-[13px] text-muted mt-0.5 max-w-xl">A student can mark attendance only if their batch has a <b>class scheduled</b>. If a batch has none, scanning the QR says “attendance is closed”. {missing ? <b className="text-warn">{missing} running batch{missing === 1 ? ' has' : 'es have'} no class today.</b> : rows.length ? <b className="text-accent">Every running batch has a class today.</b> : null}</p>
      {!rows.length ? <p className="mt-3 text-[13px] text-muted">No running batches yet.</p> : (
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
          {rows.map(({ b, now, next, n }) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className={cx('size-2.5 rounded-full shrink-0', now ? 'bg-accent' : next ? 'bg-warn' : 'bg-bad')} />
              <div className="min-w-0 mr-auto"><div className="font-medium">{b.name} <span className="text-muted font-normal text-[12.5px]">· {n} student{n === 1 ? '' : 's'}</span></div>
                <div className={cx('text-[12.5px]', now ? 'text-accent' : next ? 'text-warn' : 'text-bad')}>
                  {now ? `Class today ${fmtTime(now.startTime)} – ${fmtTime(now.endTime)}` : next ? `No class today · next on ${fmtDate(next.date)}` : 'No classes scheduled — students cannot mark attendance'}</div></div>
              {canCreate && <Button size="sm" variant={now ? 'secondary' : 'primary'} onClick={() => setSched(b)}>{now || next ? 'Add more classes…' : 'Schedule classes…'}</Button>}
            </li>
          ))}
        </ul>
      )}
      {sched && <ScheduleModal batch={sched} bulkOk={bulkOk === true} onClose={() => setSched(null)} />}
    </Card>
  );
}

/** Pick the weekdays and times once; every matching day until the batch ends gets a class. */
function ScheduleModal({ batch, bulkOk, onClose }: { batch: Batch; bulkOk: boolean; onClose: () => void }) {
  const db = S.useDB();
  const run = useRun();
  const { toast } = useUI();
  const today = todayIST();
  const [st0, en0] = batchTimes(batch.timing);
  const limit = bulkOk ? addDays(today, 365) : addDays(today, 2); // without migration 0022 every class would push an announcement
  const [f, setF] = useState({ days: guessDays(batch.schedule), start: st0, end: en0, from: today, to: bulkOk ? (batch.endDate && batch.endDate >= today ? batch.endDate : addDays(today, 90)) : addDays(today, 2) });
  const to = f.to > limit ? limit : f.to;
  const dates = f.from && to >= f.from ? S.classDays(f.from, to, f.days) : [];
  const skip = dates.filter((d) => db.classes.some((x) => x.batchId === batch.id && x.date === d && x.status === 'scheduled' && x.startTime < f.end && f.start < x.endTime)).length;
  const make = dates.length - skip;
  const ok = make > 0 && !!f.start && !!f.end && f.end > f.start;
  const go = () => {
    const r = run(() => S.scheduleClasses(batch.id, { days: f.days, startTime: f.start, endTime: f.end, from: f.from, to }));
    if (r) { toast(`${r.made} class${r.made === 1 ? '' : 'es'} scheduled`); onClose(); }
  };
  return (
    <Modal open onClose={onClose} title={`Schedule classes — ${batch.name}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={go}>{make ? `Schedule ${make} class${make === 1 ? '' : 'es'}` : 'Schedule'}</Button></>}>
      <div className="space-y-4">
        <Field label="Class days">
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map(([n, l]) => <button key={n} type="button" aria-pressed={f.days.includes(n)} onClick={() => setF((p) => ({ ...p, days: p.days.includes(n) ? p.days.filter((x) => x !== n) : [...p.days, n] }))}
              className={cx('h-9 px-3.5 rounded-full text-[13px] font-semibold transition-colors', f.days.includes(n) ? 'bg-ink text-white' : 'bg-surface text-zinc-600 hover:text-ink')}>{l}</button>)}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts"><Input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
          <Field label="Ends"><Input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
          <Field label="From"><Input type="date" value={f.from} min={today} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="Until"><Input type="date" value={to} max={limit} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        </div>
        <div className="rounded-xl bg-surface px-4 py-3 text-[13px]">
          {make ? <><b>{make}</b> class{make === 1 ? '' : 'es'} will be added{skip ? <> · {skip} day{skip === 1 ? '' : 's'} already {skip === 1 ? 'has' : 'have'} a class</> : null}.</> : <span className="text-warn">{skip ? 'Those days already have a class.' : 'Pick at least one day inside the dates.'}</span>}
          <div className="text-[12px] text-muted mt-1">Holiday? Open that day in the batch’s class calendar and cancel the class.</div>
        </div>
        {!bulkOk && <p className="rounded-xl bg-warn-soft text-warn px-3 py-2 text-[12.5px]">Scheduling many classes at once needs one small database update (<b>0022</b>) so students don’t get a notification for every class. Until it is installed, this is limited to the next 3 days.</p>}
      </div>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { sb } from '../store/cloud';
import * as S from '../store/store';
import { attendUrl, qrOnly, qrPoster } from '../lib/qrPoster';
import { Button, Card, cx, useUI } from './kit';

/**
 * The permanent classroom attendance QR. One code for the whole academy, valid until someone makes a new one.
 * Print the poster once and stick it on the wall: students scan it with the phone camera, the student app opens
 * (they sign in once and stay signed in) and they tap "Mark my attendance" for the class their batch has right now.
 */
export default function ClassroomQr({ canEdit = true }: { canEdit?: boolean }) {
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

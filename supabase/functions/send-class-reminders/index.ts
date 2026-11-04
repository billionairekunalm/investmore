// Sends due class and fee reminders through Firebase Cloud Messaging (HTTP v1).
// Runs every minute (pg_cron → pg_net, see migration 0013). Secrets (Supabase → Edge Functions → Secrets):
//   FIREBASE_SERVICE_ACCOUNT  the Firebase service-account JSON (private — never in the app or the repo)
//   CRON_SECRET               shared with the cron job, so nobody else can trigger sends
//   SITE_URL                  e.g. https://investmore.vercel.app (where a tapped reminder opens)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

type Job = {
  id: number; kind: string; attempts: number; class_id: string | null; student_id: string; student: string | null; course: string | null;
  batch: string | null; date: string | null; start_time: string | null; end_time: string | null; tokens: string[];
  title: string | null; body: string | null; // ready-made text (fee reminders)
};
const MAX_ATTEMPTS = 5;

const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b)))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

let cached: { token: string; exp: number } | null = null;
/** OAuth access token for FCM from the service account (signed JWT, RS256). */
async function accessToken(sa: { client_email: string; private_key: string }) {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))}`;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Google token: ${j.error_description ?? j.error ?? res.status}`);
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

const time12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const day = (d: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
/** Friendly, personal reminder text: greets the student by first name and says what, when and where. */
function message(j: Job) {
  if (j.title && j.body) return { title: j.title, body: j.body };
  const hi = `Hi ${(j.student ?? '').trim().split(/\s+/)[0] || 'there'}`;
  const what = j.course ? `${j.course} class` : 'class';
  const batch = j.batch ? ` (${j.batch})` : '';
  const at = j.start_time ? time12(j.start_time) : '';
  const till = j.end_time ? ` – ${time12(j.end_time)}` : '';
  switch (j.kind) {
    case 'day_before': return {
      title: `📅 ${hi}, your class is tomorrow`,
      body: `Your ${what}${batch} is scheduled for tomorrow, ${day(j.date!)}, at ${at}${till}. See you there! — InvestMore Training Academy`,
    };
    case 'morning': return {
      title: `☀️ Good morning, ${hi.slice(3)}!`,
      body: `Your ${what}${batch} is scheduled for today at ${at}${till}. Get ready for a great session! — InvestMore Training Academy`,
    };
    case 'soon': return {
      title: `⏰ ${hi}, your class starts in 30 minutes`,
      body: `Your ${what}${batch} begins at ${at}. Please reach on time and scan the classroom QR code to mark your attendance.`,
    };
    case 'scheduled': return {
      title: `📚 ${hi}, a new class is scheduled`,
      body: `Your ${what}${batch} is on ${day(j.date!)} at ${at}${till}. We'll remind you before it starts. — InvestMore Training Academy`,
    };
    case 'rescheduled': return {
      title: `🔁 ${hi}, your class time has changed`,
      body: `Your ${what}${batch} is now on ${day(j.date!)} at ${at}${till}. Please note the new time. — InvestMore Training Academy`,
    };
    case 'cancelled': return {
      title: `❌ ${hi}, a class has been cancelled`,
      body: `Your ${what}${batch} on ${day(j.date!)} at ${at} is cancelled. We'll let you know the next class. — InvestMore Training Academy`,
    };
    default: return {
      title: `🔔 ${hi}, notifications are on!`,
      body: 'You will get your InvestMore reminders here: classes (a day before, that morning and 30 minutes before) and fee due dates.',
    };
  }
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('Forbidden', { status: 403 });
  const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
  if (!raw) return Response.json({ error: 'FIREBASE_SERVICE_ACCOUNT secret is not set' }, { status: 500 });
  const sa = JSON.parse(raw);
  const site = (Deno.env.get('SITE_URL') ?? 'https://investmore.vercel.app').replace(/\/$/, '');
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data, error } = await db.rpc('claim_due_jobs', { p_limit: 200 });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const jobs = (data ?? []) as Job[];
  if (!jobs.length) return Response.json({ sent: 0 });
  const bearer = await accessToken(sa);
  const result = { sent: 0, failed: 0, noDevice: 0 };

  for (const j of jobs) {
    if (!j.tokens.length) {
      await db.from('notification_jobs').update({ status: 'no_device', error: 'Student has not turned on reminders' }).eq('id', j.id);
      result.noDevice++; continue;
    }
    const { title, body } = message(j);
    const link = j.class_id ? `${site}/?class=${encodeURIComponent(j.class_id)}` : `${site}/`;
    let ok = 0, lastErr = '', retry = false;
    for (const token of j.tokens) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: {
          token, notification: { title, body }, data: { link, classId: j.class_id ?? '' },
          webpush: {
            // high urgency: delivered straight away even when the phone is asleep and the app is closed (like chat apps);
            // TTL: if the phone is offline, keep trying until the reminder would be pointless
            headers: { Urgency: 'high', TTL: String(j.kind === 'soon' ? 1800 : j.kind === 'test' ? 600 : j.kind.startsWith('fee_') ? 12 * 3600 : 6 * 3600) },
            fcm_options: { link },
            notification: { icon: `${site}/icon-512.png`, badge: `${site}/icon-192.png`, tag: `im-${j.id}`, renotify: true, vibrate: [200, 100, 200] },
          },
        } }),
      });
      if (res.ok) { ok++; continue; }
      const e = await res.json().catch(() => ({}));
      const code = e?.error?.details?.find((d: { errorCode?: string }) => d.errorCode)?.errorCode ?? e?.error?.status ?? String(res.status);
      lastErr = `${code}: ${e?.error?.message ?? ''}`.slice(0, 300);
      if (code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT' || res.status === 404) await db.from('push_tokens').delete().eq('token', token); // dead device
      else if (res.status === 429 || res.status >= 500) retry = true; // temporary
    }
    if (ok) { await db.from('notification_jobs').update({ status: 'sent', sent_at: new Date().toISOString(), error: null }).eq('id', j.id); result.sent++; }
    else if (retry && j.attempts < MAX_ATTEMPTS) await db.from('notification_jobs').update({ status: 'pending', next_try_at: new Date(Date.now() + j.attempts * 2 * 60_000).toISOString(), error: lastErr }).eq('id', j.id);
    else { await db.from('notification_jobs').update({ status: 'failed', error: lastErr }).eq('id', j.id); result.failed++; }
  }
  return Response.json(result);
});

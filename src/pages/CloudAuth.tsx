import { useState, type ReactNode } from 'react';
import * as S from '../store/store';
import { sb, sendReset, signIn, signUp } from '../store/cloud';
import { Button, Card, Field, Input, cx, useRun } from '../ui/kit';
import { ROLES } from '../domain/types';

/** Staff sign-in for the Supabase-backed app: email + password, first-run setup, and the "not linked" state. */
export default function CloudAuth() {
  const cloud = S.useCloud();
  return (
    <div className="min-h-full grid place-items-center bg-surface p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/logo-full.png" alt="InvestMore" className="mx-auto w-56 mix-blend-multiply" />
          <div className="text-xs text-muted mt-2">Academy management</div>
        </div>
        <Card className="p-6 shadow-[0_8px_30px_-12px_rgba(15,35,65,.2)]">
          {cloud.phase === 'recovery' ? <NewPassword /> :
            cloud.phase === 'setup' ? <FirstRun /> :
              cloud.phase === 'not-staff' ? <NotStaff email={cloud.email} /> :
                <SignInForm error={cloud.phase === 'error' ? cloud.error : undefined} />}
        </Card>
        <p className="text-center text-[11.5px] text-muted mt-4 flex items-center justify-center gap-1.5">
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 7h8v7H4zM5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>
          Data is stored securely in the academy's Supabase database.
        </p>
      </div>
    </div>
  );
}

const Title = ({ children, sub }: { children: ReactNode; sub?: ReactNode }) => (
  <div className="mb-5"><h1 className="font-bold text-[17px] text-navy">{children}</h1>{sub && <p className="text-muted mt-1 text-[13px]">{sub}</p>}</div>
);
const Msg = ({ tone, children }: { tone: 'bad' | 'ok'; children: ReactNode }) => (
  <p className={cx('rounded-lg px-3 py-2 text-[12.5px]', tone === 'bad' ? 'bg-bad-soft text-bad' : 'bg-accent-soft text-accent')}>{children}</p>
);

function SignInForm({ error }: { error?: string }) {
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'bad' | 'ok'; text: string } | null>(error ? { tone: 'bad', text: error } : null);
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      if (mode === 'reset') { await sendReset(email); setMsg({ tone: 'ok', text: 'Check your email for a link to set a new password.' }); }
      else if (mode === 'up') {
        if (pw !== pw2) throw new Error('The two passwords do not match.');
        const r = await signUp(email, pw);
        if (r === 'confirm-email') setMsg({ tone: 'ok', text: `We sent a confirmation link to ${email.trim()}. Open it, then sign in here.` });
        else await S.enterCloud(email.trim());
      } else { await signIn(email, pw); await S.enterCloud(email.trim()); }
    } catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }); }
    setBusy(false);
  };
  const ready = validEmail && (mode === 'reset' || (pw.length >= 8 && (mode === 'in' || pw2.length >= 8)));
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) void go(); }} className="space-y-3.5">
      <Title sub={mode === 'in' ? 'Sign in with your staff email.' : mode === 'up' ? 'Use the email your admin added for you in Employees. The first person to sign up sets up the academy.' : 'We will email you a reset link.'}>
        {mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create your account' : 'Reset password'}
      </Title>
      <Field label="Email"><Input type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      {mode !== 'reset' && <Field label="Password" hint={mode === 'up' ? 'At least 8 characters' : undefined}><Input type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} /></Field>}
      {mode === 'up' && <Field label="Confirm password"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>}
      {msg && <Msg tone={msg.tone}>{msg.text}</Msg>}
      <Button type="submit" variant="primary" className="w-full h-10" loading={busy} disabled={!ready}>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</Button>
      <div className="flex justify-between text-[12.5px] pt-1">
        {mode === 'in' ? <>
          <button type="button" className="text-accent font-medium hover:underline" onClick={() => { setMode('up'); setMsg(null); }}>Create an account</button>
          <button type="button" className="text-muted hover:text-ink" onClick={() => { setMode('reset'); setMsg(null); }}>Forgot password?</button>
        </> : <button type="button" className="text-accent font-medium hover:underline" onClick={() => { setMode('in'); setMsg(null); }}>← Back to sign in</button>}
      </div>
    </form>
  );
}

function NewPassword() {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const cloud = S.useCloud();
  return (
    <form className="space-y-3.5" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMsg(null);
      const { error } = await sb!.auth.updateUser({ password: pw });
      if (error) { setMsg(error.message); setBusy(false); return; }
      if (cloud.email) await S.enterCloud(cloud.email);
      setBusy(false);
    }}>
      <Title sub={cloud.email ?? undefined}>Set a new password</Title>
      <Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      {msg && <Msg tone="bad">{msg}</Msg>}
      <Button type="submit" variant="primary" className="w-full h-10" loading={busy} disabled={pw.length < 8}>Save password</Button>
    </form>
  );
}

function FirstRun() {
  const cloud = S.useCloud();
  const run = useRun();
  const device = cloud.deviceData;
  const admins = device?.employees.filter((e) => e.role === 'super_admin' && e.active) ?? [];
  const [mode, setMode] = useState<'fresh' | 'move'>(admins.length ? 'move' : 'fresh');
  const [f, setF] = useState({ name: '', phone: '' });
  const [admin, setAdmin] = useState(admins[0]?.id ?? '');
  return (
    <div className="space-y-4">
      <Title sub={<>Signed in as <b className="text-ink">{cloud.email}</b>. You will be the Super Admin.</>}>Set up your academy</Title>
      {admins.length > 0 && (
        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-zinc-100 border border-line text-[12.5px] font-medium">
          {([['move', 'Move this browser\'s data'], ['fresh', 'Start fresh']] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setMode(v)} className={cx('h-8 rounded-md', mode === v ? 'bg-white shadow-sm text-navy' : 'text-zinc-500')}>{l}</button>
          ))}
        </div>
      )}
      {mode === 'move' && device ? (
        <>
          <p className="text-[12.5px] text-zinc-600">This browser already has <b>{device.students.length}</b> students, <b>{device.payments.length}</b> payments and <b>{device.leads.length}</b> leads. They will be uploaded to Supabase once.</p>
          <Field label="Which Super Admin are you?">
            <div className="space-y-1.5">
              {admins.map((e) => (
                <label key={e.id} className={cx('flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer', admin === e.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface')}>
                  <input type="radio" name="admin" checked={admin === e.id} onChange={() => setAdmin(e.id)} className="accent-[var(--color-accent)]" />
                  <span className="flex-1"><span className="font-medium">{e.name}</span><span className="block text-xs text-muted">{ROLES.find((r) => r.id === e.role)?.label}</span></span>
                </label>
              ))}
            </div>
          </Field>
          <Button variant="primary" className="w-full h-10" disabled={!admin} onClick={() => run(() => S.moveDeviceDataToCloud(admin), 'Uploading this browser\'s data to Supabase')}>Upload and continue</Button>
        </>
      ) : (
        <>
          <Field label="Your name" required><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Mobile" required><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Button variant="primary" className="w-full h-10" disabled={!f.name.trim() || !f.phone} onClick={() => run(() => S.createFirstAdmin(f.name.trim(), f.phone, cloud.email ?? ''))}>Create academy</Button>
        </>
      )}
      <button type="button" onClick={() => S.logout()} className="w-full text-center text-[12.5px] text-muted hover:text-ink">Sign out</button>
    </div>
  );
}

function NotStaff({ email }: { email: string | null }) {
  return (
    <div className="space-y-4">
      <Title sub={<>You are signed in as <b className="text-ink">{email}</b>, but this email isn't linked to an active employee.</>}>Ask your admin to add you</Title>
      <p className="text-[12.5px] text-zinc-600">An admin needs to add you in <b>Employees</b> with exactly this email address (or reactivate your account). Then sign in again.</p>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => email && S.enterCloud(email)}>Try again</Button>
        <Button variant="primary" className="flex-1" onClick={() => S.logout()}>Sign out</Button>
      </div>
    </div>
  );
}

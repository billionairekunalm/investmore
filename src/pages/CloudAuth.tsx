import { useEffect, useState, type ReactNode } from 'react';
import * as S from '../store/store';
import { hasEmployees, loginIdOf, sb, setupAdmin, signInWithId } from '../store/cloud';
import { Button, Card, Field, Input, cx, useRun } from '../ui/kit';
import { ROLES } from '../domain/types';

/** One login page for everyone: admin/staff and students sign in with their login ID + password. */
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
                <SignInOrSetup error={cloud.phase === 'error' ? cloud.error : undefined} />}
        </Card>
      </div>
    </div>
  );
}

const Title = ({ children, sub }: { children: ReactNode; sub?: ReactNode }) => (
  <div className="mb-5"><h1 className="font-bold text-[18px] text-navy">{children}</h1>{sub && <p className="text-muted mt-1 text-[13px]">{sub}</p>}</div>
);
const Msg = ({ tone, children }: { tone: 'bad' | 'ok'; children: ReactNode }) => (
  <p className={cx('rounded-lg px-3 py-2 text-[12.5px]', tone === 'bad' ? 'bg-bad-soft text-bad' : 'bg-accent-soft text-accent')}>{children}</p>
);

/** Shows first-run admin setup until the academy exists, then the normal sign-in. */
function SignInOrSetup({ error }: { error?: string }) {
  const [first, setFirst] = useState<boolean | null>(null);
  useEffect(() => { hasEmployees().then((h) => setFirst(!h)).catch(() => setFirst(false)); }, []);
  if (first === null) return <p className="text-muted text-center py-6">Loading…</p>;
  return first ? <CreateAdmin onDone={() => setFirst(false)} /> : <SignInForm error={error} />;
}

function SignInForm({ error }: { error?: string }) {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'bad' | 'ok'; text: string } | null>(error ? { tone: 'bad', text: error } : null);
  const go = async () => {
    setBusy(true); setMsg(null);
    try { const email = await signInWithId(id, pw); await S.enterCloud(email); }
    catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }); }
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (id.trim() && pw) void go(); }} className="space-y-3.5">
      <Title sub="Admin, staff and students sign in here.">Sign in</Title>
      <Field label="Login ID"><Input autoComplete="username" autoCapitalize="none" autoFocus value={id} onChange={(e) => setId(e.target.value)} placeholder="Student ID or admin ID" /></Field>
      <Field label="Password"><Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      {msg && <Msg tone={msg.tone}>{msg.text}</Msg>}
      <Button type="submit" variant="primary" className="w-full h-10" loading={busy} disabled={!id.trim() || !pw}>Sign in</Button>
      <p className="text-center text-[12px] text-muted">Forgot your password? Ask the academy office to reset it.</p>
    </form>
  );
}

function CreateAdmin({ onDone }: { onDone: () => void }) {
  const [id, setId] = useState('investmore');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      if (pw !== pw2) throw new Error('The two passwords do not match.');
      const email = await setupAdmin(id, pw);
      await S.enterCloud(email);
    } catch (e) {
      const m = (e as Error).message;
      if (/already set up/i.test(m)) onDone(); else setMsg(m);
    }
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void go(); }} className="space-y-3.5">
      <Title sub="First time only. This becomes the main admin login.">Create admin login</Title>
      <Field label="Admin login ID"><Input autoComplete="username" autoCapitalize="none" value={id} onChange={(e) => setId(e.target.value)} /></Field>
      <Field label="Password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Field label="Confirm password"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
      {msg && <Msg tone="bad">{msg}</Msg>}
      <Button type="submit" variant="primary" className="w-full h-10" loading={busy} disabled={id.trim().length < 3 || pw.length < 8 || !pw2}>Create admin login</Button>
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
      <Title sub={loginIdOf(cloud.email)}>Set a new password</Title>
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
      <Title sub={<>Signed in as <b className="text-ink">{loginIdOf(cloud.email)}</b> (Super Admin).</>}>Set up your academy</Title>
      {admins.length > 0 && (
        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-zinc-100 border border-line text-[12.5px] font-medium">
          {([['move', 'Use this browser\'s data'], ['fresh', 'Start fresh']] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setMode(v)} className={cx('h-8 rounded-md', mode === v ? 'bg-white shadow-sm text-navy' : 'text-zinc-500')}>{l}</button>
          ))}
        </div>
      )}
      {mode === 'move' && device ? (
        <>
          <p className="text-[12.5px] text-zinc-600"><b>{device.students.length}</b> students, <b>{device.payments.length}</b> payments and <b>{device.leads.length}</b> leads will be uploaded once.</p>
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
          <Button variant="primary" className="w-full h-10" disabled={!admin} onClick={() => run(() => S.moveDeviceDataToCloud(admin), 'Uploading this browser\'s data')}>Upload and continue</Button>
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
      <Title sub={<>Signed in as <b className="text-ink">{loginIdOf(email)}</b>, but this login isn't linked to an active staff account.</>}>No access</Title>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => email && S.enterCloud(email)}>Try again</Button>
        <Button variant="primary" className="flex-1" onClick={() => S.logout()}>Sign out</Button>
      </div>
    </div>
  );
}

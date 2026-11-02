import { useEffect, useState, type ReactNode } from 'react';
import * as S from '../store/store';
import { hasEmployees, loginIdOf, sb, setupAdmin, signInWithId, studentSignup } from '../store/cloud';
import { Button, Field, Input, cx, useRun } from '../ui/kit';
import { ROLES } from '../domain/types';

type Who = 'student' | 'staff' | 'admin';
const WHO: { id: Who; label: string; icon: string; field: string; placeholder: string; hint: string }[] = [
  { id: 'student', label: 'Student', icon: 'M12 3 2 8l10 5 10-5-10-5Zm-6 7.5V15c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5', field: 'Student ID', placeholder: 'e.g. IMNOV0001', hint: 'Your student ID is on your fee receipt.' },
  { id: 'staff', label: 'Staff', icon: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm13 9v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8', field: 'Staff login ID', placeholder: 'e.g. rahul', hint: 'Given to you by your admin.' },
  { id: 'admin', label: 'Admin', icon: 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm-3 10 2 2 4-4', field: 'Admin login ID', placeholder: 'e.g. investmore', hint: 'The main academy login.' },
];
const Icon = ({ d, className = 'size-4' }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);

/**
 * One login page for everyone. Students sign in with their student ID; admin and staff with the login ID
 * the admin gave them, and each staff member then sees only what their role allows.
 * There is no open sign-up: the academy creates every login (first run: the admin creates their own).
 */
export default function CloudAuth() {
  const cloud = S.useCloud();
  return (
    <div className="min-h-full grid place-items-center bg-white p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/logo-full.png" alt="InvestMore" className="mx-auto w-56 mix-blend-multiply" />
          <div className="text-xs text-muted mt-2">Academy management</div>
        </div>
        <div className="rounded-xl bg-white border border-line p-5">
          {cloud.phase === 'recovery' ? <NewPassword /> :
            cloud.phase === 'setup' ? <FirstRun /> :
              cloud.phase === 'not-staff' ? <NotStaff email={cloud.email} /> :
                <SignInOrSetup error={cloud.phase === 'error' ? cloud.error : undefined} />}
        </div>
      </div>
    </div>
  );
}

const Title = ({ children, sub }: { children: ReactNode; sub?: ReactNode }) => (
  <div className="mb-4"><h1 className="font-semibold text-[15px]">{children}</h1>{sub && <p className="text-muted mt-1">{sub}</p>}</div>
);
const Msg = ({ tone, children }: { tone: 'bad' | 'ok'; children: ReactNode }) => (
  <p role="alert" className={cx('rounded-lg px-3 py-2 text-[12.5px]', tone === 'bad' ? 'bg-bad-soft text-bad' : 'bg-accent-soft text-accent')}>{children}</p>
);

/** Always the normal sign-in; before the academy exists, the first Admin sign-in creates the admin login. */
function SignInOrSetup({ error }: { error?: string }) {
  const [first, setFirst] = useState<boolean | null>(null);
  const [signup, setSignup] = useState(false);
  useEffect(() => { hasEmployees().then((h) => setFirst(!h)).catch(() => setFirst(false)); }, []);
  if (first === null) return <p className="text-muted text-center py-10">Loading…</p>;
  return signup ? <StudentSignup onBack={() => setSignup(false)} /> : <SignInForm error={error} first={first} onSignup={() => setSignup(true)} />;
}

function SignInForm({ error, first, onSignup }: { error?: string; first: boolean; onSignup: () => void }) {
  const [who, setWhoState] = useState<Who>(() => { if (first) return 'admin'; try { return (localStorage.getItem('loginAs') as Who) || 'student'; } catch { return 'student'; } });
  const [id, setId] = useState(first ? 'investmore' : '');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'bad' | 'ok'; text: string } | null>(error ? { tone: 'bad', text: error } : null);
  const setWho = (x: Who) => { setWhoState(x); setMsg(null); try { localStorage.setItem('loginAs', x); } catch { /* */ } };
  const w = WHO.find((x) => x.id === who) ?? WHO[0];
  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      let email: string;
      if (first && who === 'admin') {
        // very first sign-in: this ID + password become the admin login
        email = await setupAdmin(id, pw).catch((e: Error) => { if (/already set up/i.test(e.message)) return signInWithId(id, pw, 'staff'); throw e; });
      } else if (first) throw new Error('The academy is not set up yet. The admin must sign in first.');
      else email = await signInWithId(id, pw, who === 'student' ? 'student' : 'staff');
      await S.enterCloud(email);
    } catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }); }
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (id.trim() && pw) void go(); }} className="space-y-3">
      <Title sub="Choose how you want to log in.">Sign in</Title>
      <div role="tablist" aria-label="Sign in as" className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-zinc-100 border border-line">
        {WHO.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={who === x.id} onClick={() => setWho(x.id)}
            className={cx('h-9 rounded-lg inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold transition-all',
              who === x.id ? 'bg-white text-navy shadow-[0_1px_4px_rgba(15,35,65,.15)]' : 'text-zinc-500 hover:text-navy')}>
            <Icon d={x.icon} />{x.label}
          </button>
        ))}
      </div>
      <Field label={w.field} hint={w.hint}>
        <Input autoComplete="username" autoCapitalize="none" autoFocus value={id} onChange={(e) => setId(e.target.value)} placeholder={w.placeholder} />
      </Field>
      <Field label="Password">
        <div className="relative">
          <Input type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} className="pr-16" />
          <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 h-8 px-2 rounded-md text-[12px] font-semibold text-navy hover:bg-surface" aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
        </div>
      </Field>
      {msg && <Msg tone={msg.tone}>{msg.text}</Msg>}
      <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!id.trim() || !pw}>Sign in as {w.label.toLowerCase()}</Button>
      <p className="text-center text-[12px] text-muted">Forgot your password? {who === 'student' ? 'Ask the academy office.' : 'Ask your admin.'}</p>
      <div className="pt-3 border-t border-line text-center text-[13px] text-zinc-600">
        New student? <button type="button" onClick={onSignup} className="font-semibold text-accent hover:underline">Sign up as a student</button>
      </div>
    </form>
  );
}

/** Enrolled students create their own login: student ID + the mobile number given at admission. */
function StudentSignup({ onBack }: { onBack: () => void }) {
  const [f, setF] = useState({ code: '', phone: '', pw: '', pw2: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ok = !!f.code.trim() && f.phone.replace(/\D/g, '').length >= 10 && f.pw.length >= 8 && f.pw2.length > 0;
  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      if (f.pw !== f.pw2) throw new Error('The two passwords do not match.');
      const email = await studentSignup(f.code, f.phone, f.pw);
      await S.enterCloud(email);
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ok) void go(); }} className="space-y-3">
      <Title sub="Use the student ID and mobile number from your admission.">Student sign up</Title>
      <Field label="Student ID"><Input autoCapitalize="characters" autoFocus value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="e.g. IMNOV0001" /></Field>
      <Field label="Mobile number"><Input inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="10-digit mobile" /></Field>
      <Field label="Create password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} /></Field>
      <Field label="Confirm password"><Input type="password" autoComplete="new-password" value={f.pw2} onChange={(e) => setF({ ...f, pw2: e.target.value })} /></Field>
      {msg && <Msg tone="bad">{msg}</Msg>}
      <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!ok}>Sign up</Button>
      <div className="pt-3 border-t border-line text-center text-[13px] text-zinc-600">
        Already have a login? <button type="button" onClick={onBack} className="font-semibold text-accent hover:underline">Sign in</button>
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

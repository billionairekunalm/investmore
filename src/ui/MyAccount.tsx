import { useState, type ReactNode } from 'react';
import * as S from '../store/store';
import { changeMyPassword, loginIdOf, setMyLoginEmail, signOutEverywhere } from '../store/cloud';
import { Button, Field, Input, Modal, useUI } from './kit';

/** Your own login: change your password; a Super Admin can also sign in with a real email so "Forgot password?" works. */
export function MyAccount({ onClose }: { onClose: () => void }) {
  const me = S.useMe()!;
  const cloud = S.useCloud();
  const login = cloud.email ?? '';
  const usesId = /\.investmore\.invalid$/i.test(login);
  return (
    <Modal open onClose={onClose} title="My account" footer={<Button onClick={onClose}>Close</Button>}>
      <p className="text-[12.5px] text-muted">You sign in with <b className="text-ink">{loginIdOf(login)}</b>.</p>
      <ChangePassword />
      {me.role === 'super_admin' && (
        <Section title="Recovery email" sub={usesId
          ? 'Add your email so you can reset your password yourself if you forget it. You will then sign in with this email instead of your login ID.'
          : 'If you forget your password, use “Forgot password?” on the sign-in page and a reset link is sent to this email.'}>
          <RecoveryEmail current={usesId ? '' : login} />
        </Section>
      )}
      <Section title="Signed in on other devices?" sub="Signs this login out everywhere: every phone, computer and browser, including this one. You can sign in again with your password.">
        <SignOutEverywhere />
      </Section>
    </Modal>
  );
}

const Section = ({ title, sub, children }: { title: string; sub: string; children: ReactNode }) => (
  <section className="mt-3 rounded-xl border border-line bg-surface/60 p-4">
    <div className="font-semibold text-[14px]">{title}</div>
    <p className="text-[12px] text-muted mb-3">{sub}</p>
    {children}
  </section>
);

function ChangePassword() {
  const { toast } = useUI();
  const [f, setF] = useState({ cur: '', pw: '', pw2: '' });
  const [busy, setBusy] = useState(false);
  const mismatch = !!f.pw2 && f.pw !== f.pw2;
  const save = async () => {
    setBusy(true);
    try { await changeMyPassword(f.cur, f.pw); setF({ cur: '', pw: '', pw2: '' }); toast('Password changed', 'ok'); }
    catch (e) { toast((e as Error).message, 'bad'); }
    setBusy(false);
  };
  return (
    <Section title="Change password" sub="Use at least 8 characters. Other devices stay signed in until they sign out.">
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="grid gap-2">
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value })} /></Field>
        <div className="grid sm:grid-cols-2 gap-2">
          <Field label="New password" error={f.pw && f.pw.length < 8 ? 'At least 8 characters' : undefined}><Input type="password" autoComplete="new-password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} /></Field>
          <Field label="Confirm new password" error={mismatch ? 'Does not match' : undefined}><Input type="password" autoComplete="new-password" value={f.pw2} onChange={(e) => setF({ ...f, pw2: e.target.value })} /></Field>
        </div>
        <Button type="submit" variant="primary" className="justify-self-start" loading={busy} disabled={!f.cur || f.pw.length < 8 || f.pw !== f.pw2}>Change password</Button>
      </form>
    </Section>
  );
}

function SignOutEverywhere() {
  const { ask, toast } = useUI();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!(await ask({ title: 'Sign out of all devices?', message: 'Every device using this login, including this one, is signed out within an hour at most (straight away on this device).', confirm: 'Sign out everywhere', danger: true }))) return;
    setBusy(true);
    try { await signOutEverywhere(); S.logout(); } catch (e) { toast((e as Error).message, 'bad'); setBusy(false); }
  };
  return <Button variant="danger" loading={busy} onClick={go}>Sign out of all devices</Button>;
}

function RecoveryEmail({ current }: { current: string }) {
  const { toast } = useUI();
  const [f, setF] = useState({ email: current, email2: '', cur: '' });
  const [busy, setBusy] = useState(false);
  const valid = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(f.email.trim());
  const same = f.email.trim().toLowerCase() === f.email2.trim().toLowerCase();
  const save = async () => {
    setBusy(true);
    try {
      const email = await setMyLoginEmail(f.email, f.cur);
      await S.enterCloud(email);
      setF({ email, email2: '', cur: '' });
      toast(`From now on, sign in with ${email}`, 'ok');
    } catch (e) { toast((e as Error).message, 'bad'); }
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="grid gap-2">
      <div className="grid sm:grid-cols-2 gap-2">
        <Field label="Email"><Input type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Type it again" error={f.email2 && !same ? 'Does not match' : undefined}><Input type="email" value={f.email2} onChange={(e) => setF({ ...f, email2: e.target.value })} /></Field>
      </div>
      <Field label="Current password"><Input type="password" autoComplete="current-password" value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value })} /></Field>
      <Button type="submit" variant="primary" className="justify-self-start" loading={busy}
        disabled={!valid || !same || !f.cur || f.email.trim().toLowerCase() === current.toLowerCase()}>{current ? 'Change email' : 'Use this email'}</Button>
    </form>
  );
}

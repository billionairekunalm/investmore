import { useEffect, useState } from 'react';
import * as S from '../store/store';
import { cloudEnabled, loginIdOf, setStaffLogin, staffEmail, staffLoginExists } from '../store/cloud';
import { Badge, Button, Card, CardHeader, Checkbox, Empty, Field, Input, Modal, PageHeader, Select, Table, Tabs, useRun, useUI } from '../ui/kit';
import { ACTIONS, MODULES } from '../domain/permissions';
import { ROLES, type Action, type Employee, type Module, type Role } from '../domain/types';
import { fmtDateTime, fmtPhone } from '../domain/util';

export default function Employees() {
  const db = S.useDB();
  const [tab, setTab] = useState<'people' | 'roles' | 'logins'>('people');
  const [edit, setEdit] = useState<Partial<Employee> | null>(null);
  const roleLabel = (r: Role) => ROLES.find((x) => x.id === r)?.label;
  return (
    <>
      <PageHeader title="Employees" actions={S.allowed('employees', 'create', db) && <Button variant="primary" onClick={() => setEdit({ role: 'caller', active: true, name: '', phone: '', email: '' })}>+ Add employee</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'people', label: 'Team', count: db.employees.length }, { id: 'roles', label: 'Roles & permissions' }, { id: 'logins', label: 'Login history' }]} />
      {tab === 'people' && (
        <Card>
          <Table rows={db.employees} rowKey={(e) => e.id} onRow={(e) => S.allowed('employees', 'edit', db) && setEdit(e)} cols={[
            { key: 'n', label: 'Name', render: (e) => <span className="font-medium">{e.name}</span>, sort: (e) => e.name },
            { key: 'r', label: 'Role', render: (e) => roleLabel(e.role), sort: (e) => e.role },
            { key: 'p', label: 'Mobile', render: (e) => fmtPhone(e.phone) }, { key: 'm', label: cloudEnabled ? 'Login ID / email' : 'Email', render: (e) => e.email ? loginIdOf(e.email) : '—' },
            { key: 'l', label: 'Leads', render: (e) => db.leads.filter((l) => l.assignedTo === e.id).length },
            { key: 'll', label: 'Last login', render: (e) => fmtDateTime(db.logins.find((x) => x.userId === e.id)?.at) },
            { key: 's', label: 'Status', render: (e) => <Badge tone={e.active ? 'green' : 'gray'}>{e.active ? 'Active' : 'Inactive'}</Badge> },
          ]} />
        </Card>
      )}
      {tab === 'roles' && <Permissions />}
      {tab === 'logins' && (
        <Card>
          <Table rows={db.logins.slice(0, 300)} rowKey={(l) => l.id} empty={<Empty title="No logins yet" />} cols={[
            { key: 'a', label: 'When', render: (l) => fmtDateTime(l.at) }, { key: 'u', label: 'Employee', render: (l) => S.empName(l.userId, db) },
            { key: 'r', label: 'Role', render: (l) => roleLabel(db.employees.find((e) => e.id === l.userId)?.role ?? 'caller') },
            { key: 'd', label: 'Device', render: (l) => <span className="text-muted text-xs truncate max-w-md inline-block align-bottom">{l.userAgent}</span> },
          ]} />
        </Card>
      )}
      <EmployeeModal emp={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function EmployeeModal({ emp, onClose }: { emp: Partial<Employee> | null; onClose: () => void }) {
  const run = useRun();
  const me = S.useMe()!;
  const [e, setE] = useState<Partial<Employee>>({});
  useEffect(() => { if (emp) setE(emp); }, [emp]);
  const { ask } = useUI();
  const db = S.useDB();
  const roles = ROLES.filter((r) => r.id !== 'super_admin' || me.role === 'super_admin');
  const canDelete = !!e.id && e.id !== me.id && (me.role === 'super_admin' || me.role === 'admin') && S.allowed('employees', 'delete', db)
    && (emp?.role !== 'super_admin' || me.role === 'super_admin');
  const del = async () => {
    const id = e.id!, name = emp?.name;
    const n = db.leads.filter((l) => l.assignedTo === id).length;
    onClose(); // the confirm dialog would otherwise open underneath this one
    const ok = await ask({ title: `Delete ${name}?`, danger: true, confirm: 'Delete employee',
      message: `They will no longer be able to sign in.${n ? ` Their ${n} lead${n > 1 ? 's' : ''} will become unassigned.` : ''} Past payments and calls keep their name. This cannot be undone.` });
    if (ok) run(() => S.deleteEmployee(id), 'Employee deleted');
  };
  return (
    <Modal open={!!emp} onClose={onClose} title={e.id ? `Edit ${emp?.name}` : 'Add employee'} footer={<>{canDelete && <Button variant="danger" className="mr-auto" onClick={del}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!e.name || !e.phone} onClick={() => { let ok = false; run(() => { S.saveEmployee(e as Employee); ok = true; }, 'Saved'); if (ok) onClose(); }}>Save</Button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name" required><Input value={e.name ?? ''} onChange={(x) => setE({ ...e, name: x.target.value })} /></Field>
        <Field label="Mobile" required><Input inputMode="tel" value={e.phone ?? ''} onChange={(x) => setE({ ...e, phone: x.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={e.email ?? ''} onChange={(x) => setE({ ...e, email: x.target.value })} /></Field>
        <Field label="Role"><Select value={e.role ?? 'caller'} onChange={(x) => setE({ ...e, role: x.target.value as Role })} options={roles.map((r) => ({ value: r.id, label: r.label }))} /></Field>
        <div className="sm:col-span-2"><Checkbox checked={e.active ?? true} onChange={(x) => setE({ ...e, active: x.target.checked })} label="Active (can sign in)" /></div>
      </div>
      {cloudEnabled && me.role === 'super_admin' && (e.id === me.id
        ? <p className="mt-4 text-[12.5px] text-muted">Change your own password or add a recovery email from <b>My account</b> in the sidebar.</p>
        : e.id ? <StaffLogin id={e.id} />
        : <p className="mt-4 text-[12.5px] text-muted">Save the employee first, then open them again to give a login ID and password.</p>)}
    </Modal>
  );
}

function Permissions() {
  const db = S.useDB();
  const run = useRun();
  const editable = S.currentUser()?.role === 'super_admin';
  const [role, setRole] = useState<Role>('caller');
  const m = db.settings.permissions;
  const toggle = (mod: Module, a: Action) => {
    const cur = m[role]?.[mod] ?? [];
    const next = cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a];
    run(() => S.updateSettings({ permissions: { ...m, [role]: { ...m[role], [mod]: next } } }, `${role}.${mod}.${a}`));
  };
  return (
    <Card>
      <CardHeader title="Permission matrix" sub={role === 'super_admin' ? 'Super Admin always has full access.' : editable ? 'Changes apply immediately and are logged.' : 'Only Super Admin can change permissions.'}
        right={<Select value={role} onChange={(e) => setRole(e.target.value as Role)} options={ROLES.map((r) => ({ value: r.id, label: r.label }))} className="w-44" />} />
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted"><th className="text-left px-4 py-2 font-medium">Module</th>{ACTIONS.map((a) => <th key={a} className="px-3 py-2 font-medium">{a}</th>)}</tr></thead>
          <tbody>
            {MODULES.map((mod) => (
              <tr key={mod.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2 font-medium">{mod.label}{mod.id === 'sensitive' && <span className="ml-1 text-xs text-bad">restricted</span>}</td>
                {ACTIONS.map((a) => (
                  <td key={a} className="text-center px-3 py-2">
                    <input type="checkbox" className="size-4 accent-[var(--color-accent)]" disabled={!editable || role === 'super_admin'}
                      checked={role === 'super_admin' || !!m[role]?.[mod.id]?.includes(a)} onChange={() => toggle(mod.id, a)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Super Admin gives this employee a login ID + password; they then see only what their role allows. */
function StaffLogin({ id }: { id: string }) {
  const db = S.useDB();
  const me = S.useMe()!;
  const { toast } = useUI();
  const emp = db.employees.find((x) => x.id === id)!;
  const current = /@staff\.investmore\.invalid$/i.test(emp.email) ? loginIdOf(emp.email) : '';
  const self = id === me.id; // changing your own login ID would sign you out for good
  const [loginId, setLoginId] = useState(current || emp.name.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9._-]/g, ''));
  const [pw, setPw] = useState('');
  const [has, setHas] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { staffLoginExists(id).then(setHas).catch(() => setHas(null)); }, [id, emp.email]);
  const validId = /^[A-Za-z0-9._-]{3,40}$/.test(loginId.trim());
  const save = async () => {
    setBusy(true);
    try {
      const email = staffEmail(loginId);
      if (email !== emp.email.toLowerCase()) S.saveEmployee({ ...emp, email });
      const lid = await setStaffLogin(id, pw);
      setPw(''); setHas(true);
      toast(`Login ready — Login ID ${lid}`, 'ok');
    } catch (e) { toast((e as Error).message, 'bad'); }
    setBusy(false);
  };
  return (
    <div className="mt-5 rounded-xl border border-line bg-surface/60 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div><div className="font-semibold text-[14px]">Login</div><div className="text-[12px] text-muted">They sign in on the login page with this ID and see only their role's pages.</div></div>
        {has !== null && <Badge tone={has ? 'green' : 'gray'}>{has ? 'Login active' : 'No login yet'}</Badge>}
      </div>
      <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <Field label="Login ID" error={loginId && !validId ? '3-40 letters or numbers' : undefined}>
          <Input autoCapitalize="none" value={loginId} disabled={self && !!current} onChange={(x) => setLoginId(x.target.value.trim())} />
        </Field>
        <Field label={has ? 'New password' : 'Password'} error={pw && pw.length < 8 ? 'At least 8 characters' : undefined}>
          <Input type="text" autoComplete="new-password" value={pw} onChange={(x) => setPw(x.target.value)} />
        </Field>
        <Button variant="primary" loading={busy} disabled={!validId || pw.length < 8} onClick={save}>{has ? 'Reset password' : 'Create login'}</Button>
      </div>
    </div>
  );
}

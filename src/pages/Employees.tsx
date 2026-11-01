import { useEffect, useState } from 'react';
import * as S from '../store/store';
import { Badge, Button, Card, CardHeader, Checkbox, Empty, Field, Input, Modal, PageHeader, Select, Table, Tabs, useRun } from '../ui/kit';
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
            { key: 'p', label: 'Mobile', render: (e) => fmtPhone(e.phone) }, { key: 'm', label: 'Email', render: (e) => e.email || '—' },
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
  const roles = ROLES.filter((r) => r.id !== 'super_admin' || me.role === 'super_admin');
  return (
    <Modal open={!!emp} onClose={onClose} title={e.id ? `Edit ${emp?.name}` : 'Add employee'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!e.name || !e.phone} onClick={() => { let ok = false; run(() => { S.saveEmployee(e as Employee); ok = true; }, 'Saved'); if (ok) onClose(); }}>Save</Button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name" required><Input value={e.name ?? ''} onChange={(x) => setE({ ...e, name: x.target.value })} /></Field>
        <Field label="Mobile" required><Input inputMode="tel" value={e.phone ?? ''} onChange={(x) => setE({ ...e, phone: x.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={e.email ?? ''} onChange={(x) => setE({ ...e, email: x.target.value })} /></Field>
        <Field label="Role"><Select value={e.role ?? 'caller'} onChange={(x) => setE({ ...e, role: x.target.value as Role })} options={roles.map((r) => ({ value: r.id, label: r.label }))} /></Field>
        <div className="sm:col-span-2"><Checkbox checked={e.active ?? true} onChange={(x) => setE({ ...e, active: x.target.checked })} label="Active (can sign in)" /></div>
      </div>
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

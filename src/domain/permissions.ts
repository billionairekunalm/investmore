import type { Action, Module, PermissionMatrix, Role } from './types';

const ALL: Action[] = ['view', 'create', 'edit', 'delete', 'export', 'approve'];
const RW: Action[] = ['view', 'create', 'edit'];
export const MODULES: { id: Module; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' }, { id: 'leads', label: 'Leads CRM' }, { id: 'students', label: 'Students' },
  { id: 'admissions', label: 'Admissions' }, { id: 'fees', label: 'Fee Management' }, { id: 'collections', label: 'Collections' },
  { id: 'batches', label: 'Batches' }, { id: 'certificates', label: 'Certificates' }, { id: 'expenses', label: 'Expenses' },
  { id: 'profit', label: 'Salary & Profit' }, { id: 'reports', label: 'Reports' }, { id: 'employees', label: 'Employees' },
  { id: 'notifications', label: 'Notifications' }, { id: 'settings', label: 'Settings' }, { id: 'sensitive', label: 'Sensitive records (ID docs)' },
];
export const ACTIONS = ALL;

export function defaultPermissions(): PermissionMatrix {
  const full = Object.fromEntries(MODULES.map((m) => [m.id, ALL])) as Record<Module, Action[]>;
  return {
    super_admin: full,
    admin: {
      ...full, profit: ['view'], settings: ['view'], employees: ['view'],
    },
    calling_manager: {
      leads: ALL, students: ['view'], admissions: ['view', 'create'], reports: ['view', 'export'], notifications: ['view'], employees: ['view'],
    },
    // Callers: only their own leads (row-level filter in the store), no money, no certificates, no ID documents.
    caller: { leads: RW, notifications: ['view'] },
    teacher: { batches: ['view', 'edit'], students: ['view'], notifications: ['view'] },
    accountant: {
      dashboard: ['view'], students: ['view'], fees: ALL, collections: ALL, expenses: ALL, profit: ['view', 'create', 'edit', 'export'],
      reports: ['view', 'export'], notifications: ['view'],
    },
  };
}

export const can = (m: PermissionMatrix, role: Role, mod: Module, act: Action = 'view') => role === 'super_admin' || !!m[role]?.[mod]?.includes(act);

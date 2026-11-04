import { useSyncExternalStore } from 'react';
import type { BatchVideo, ClassMark, ClassSession,
  Action, Batch, BookingPolicy, CallOutcome, Certificate, CertificateTemplate, Course, DB, Distribution, DistributionStatus,
  Employee, Expense, ISODate, Withdrawal, Lead, Module, Notification, Paise, Payment, PayMethod, RecurringExpense, Role, Settings, Student, StudentStatus,
} from '../domain/types';
import { NEEDS_DATE } from '../domain/types';
import { buildSchedule } from '../domain/fees';
import { financeFor, periodFigures, splitProfit } from '../domain/finance';
import { can, defaultPermissions } from '../domain/permissions';
import { addDays, monthOf, monthRange, normalizePhone, nowISO, todayIST, uid } from '../domain/util';
import { idbGet, idbSet } from './idb';
import { cloudEnabled, getSession, getSyncStatus, isStudentEmail, pullAll, pushSoon, resetSynced, sb, signOutCloud } from './cloud';

export class AppError extends Error {}
const fail = (msg: string): never => { throw new AppError(msg); };

// ---------------------------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------------------------
export function defaultSettings(): Settings {
  return {
    academyName: 'InvestMore',
    bookingPolicy: null,
    startEvent: 'admission',
    instalmentGapDays: 7,
    gstRateBp: 0,
    shares: [{ name: 'Bikram', pctBp: 3500 }, { name: 'Shekhar', pctBp: 3250 }, { name: 'Sanjeev', pctBp: 3250 }],
    leadStatuses: ['New', 'Not Contacted', 'Connected', 'Warm', 'Hot', 'Call Later', 'Converted', 'Cold', 'Lost'],
    reminderOffsets: [-2, 0, 1, 3],
    rules: Object.fromEntries(RULES.map((r) => [r.id, true])),
    permissions: defaultPermissions(),
    certificateAutoIssue: false,
    invoice: { address: '', phone: '', email: '', gstin: '', note: '' },
  };
}
export const RULES = [
  { id: 'lead_imported', label: 'New lead imported → add to calling queue & notify manager' },
  { id: 'lead_assigned', label: 'Lead assigned → notify caller' },
  { id: 'lead_hot', label: 'Lead marked Hot → priority follow-up for today' },
  { id: 'student_admitted', label: 'Student admitted → notify accounts' },
  { id: 'payment_recorded', label: 'Payment recorded → notify accounts' },
  { id: 'payment_due', label: 'Payment due soon / due today → reminder' },
  { id: 'payment_overdue', label: 'Payment overdue → collection alert' },
  { id: 'followup_due', label: 'Follow-up due → remind assigned caller' },
  { id: 'certificate_eligible', label: 'Student completed → certificate approval request' },
  { id: 'expense_submitted', label: 'Expense submitted → request approval' },
  { id: 'month_closed', label: 'Month closed → profit distribution draft' },
];

export function emptyDB(): DB {
  return {
    version: 1, settings: defaultSettings(), counters: {},
    employees: [], courses: [{ id: uid(), name: 'Stock Market Mastery', bookingDefault: 100000, instalments: [300000, 300000, 150000], durationWeeks: 8, status: 'active' },
      // Forex Advance: Bikram takes 45%, the other two share the remaining 55% equally
      { id: uid(), name: 'Forex Advance', bookingDefault: 100000, instalments: [300000, 300000, 150000], durationWeeks: 8, status: 'active', shares: [{ name: 'Bikram', pctBp: 4500 }, { name: 'Shekhar', pctBp: 2750 }, { name: 'Sanjeev', pctBp: 2750 }] }],
    batches: [], students: [], enrolments: [], feePlans: [], instalments: [], payments: [], leads: [], calls: [], expenses: [],
    recurring: [], periods: [], distributions: [], templates: [], certificates: [], attendance: [], classes: [], marks: [], videos: [], notifications: [], audit: [], imports: [], logins: [], withdrawals: [],
  };
}

let db: DB = emptyDB();
let me: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
export const getDB = () => db;
export const useDB = () => useSyncExternalStore(subscribe, getDB);

// ---------------- cloud (Supabase) session ----------------
// Local mode (no Supabase env): data lives in IndexedDB key 'db', "sign in as" picker.
// Cloud mode: staff sign in with email + password; data is pulled from Supabase, every commit is pushed (see cloud.ts),
// and a cache sits in IndexedDB key 'cloud-db' for offline use. The device's old local data stays under 'db' until moved.
export type CloudPhase = 'signed-out' | 'setup' | 'not-staff' | 'ready' | 'error' | 'recovery' | 'student';
export type Cloud = { enabled: boolean; phase: CloudPhase; email: string | null; error?: string; deviceData?: DB };
let cloud: Cloud = { enabled: cloudEnabled, phase: 'signed-out', email: null };
const setCloud = (c: Partial<Cloud>) => { cloud = { ...cloud, ...c }; emit(); };
export const getCloud = () => cloud;
export const useCloud = () => useSyncExternalStore(subscribe, getCloud);
const normalize = (d: DB): DB => ({ ...emptyDB(), ...d, settings: { ...defaultSettings(), ...d.settings, invoice: { ...defaultSettings().invoice, ...d.settings?.invoice } } });

// Write-through on every commit: a debounce could lose the last action if the app is closed right after it.
function persist() {
  if (cloud.enabled) {
    if (cloud.phase !== 'ready') return;
    pushSoon(db);
    if (typeof indexedDB !== 'undefined') idbSet('cloud-db', db).catch((e) => console.error('Cache failed', e));
    return;
  }
  if (typeof indexedDB === 'undefined') return;
  idbSet('db', db).catch((e) => console.error('Save failed', e));
}

export async function boot() {
  const saved = await idbGet<DB>('db');
  if (saved) db = normalize(saved);
  if (db.settings.academyName === 'Trading Academy') db.settings.academyName = 'InvestMore'; // rebrand of pre-brand installs
  if (cloudEnabled) {
    const device = db.employees.length ? db : undefined;
    db = emptyDB();
    setCloud({ deviceData: device });
    sb!.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setCloud({ phase: 'recovery', email: session?.user.email ?? null });
      if (event === 'SIGNED_OUT' && cloud.phase !== 'signed-out') clearSession();
    });
    window.addEventListener('focus', refreshFromCloud);
    const session = await getSession();
    if (session?.user.email && cloud.phase !== 'recovery') await enterCloud(session.user.email);
    return;
  }
  me = sessionStorage.getItem('me');
  if (me && !db.employees.some((e) => e.id === me && e.active)) me = null;
  emit();
}

/** After sign-in: load the academy from Supabase and find the employee with this login email. */
export async function enterCloud(email: string) {
  // students get their own portal; no academy data is loaded for them
  if (isStudentEmail(email)) { db = emptyDB(); me = null; setCloud({ email, error: undefined, phase: 'student' }); return; }
  setCloud({ email, error: undefined });
  try {
    const remote = await pullAll(emptyDB);
    if (!remote) { db = emptyDB(); me = null; resetSynced(); setCloud({ phase: 'setup' }); return; }
    db = normalize(remote);
    const emp = db.employees.find((e) => e.active && e.email.toLowerCase() === email.toLowerCase());
    if (!emp) { db = emptyDB(); me = null; setCloud({ phase: 'not-staff' }); return; }
    setCloud({ phase: 'ready' });
    login(emp.id);
  } catch (e) {
    const cache = await idbGet<DB>('cloud-db').catch(() => undefined);
    const emp = cache?.employees.find((x) => x.active && x.email.toLowerCase() === email.toLowerCase());
    if (cache && emp) { db = normalize(cache); me = emp.id; setCloud({ phase: 'ready', error: 'Offline: showing the copy saved on this device. Changes upload when you are back online.' }); return; }
    setCloud({ phase: 'error', error: (e as Error).message });
  }
}
let lastPull = Date.now();
/** Pick up other staff members' changes when the window regains focus (only when nothing local is waiting to upload). */
/** Pull now (e.g. to see students' QR attendance); skipped while local changes are still uploading. */
export const refreshNow = () => { lastPull = 0; return refreshFromCloud(); };
async function refreshFromCloud() {
  if (cloud.phase !== 'ready' || getSyncStatus().state !== 'saved' || Date.now() - lastPull < 30000) return;
  lastPull = Date.now();
  try {
    const remote = await pullAll(emptyDB);
    if (!remote || getSyncStatus().state !== 'saved') return;
    db = normalize(remote);
    if (!db.employees.some((e) => e.id === me && e.active)) { clearSession(); return; }
    emit();
  } catch { /* keep the current copy */ }
}
function clearSession() {
  me = null; db = emptyDB();
  if (typeof indexedDB !== 'undefined') idbSet('cloud-db', null).catch(() => undefined); // shared computers: leave no copy behind
  setCloud({ phase: 'signed-out', email: null, error: undefined });
}
/** First run in the cloud: move this browser's existing records up, making the chosen Super Admin the signed-in user. */
export function moveDeviceDataToCloud(adminId: string) {
  const d = cloud.deviceData, email = cloud.email;
  if (cloud.phase !== 'setup' || !d || !email) fail('Nothing to move.');
  if (!d!.employees.some((e) => e.id === adminId && e.role === 'super_admin')) fail('Choose a Super Admin.');
  const clash = d!.employees.find((e) => e.id !== adminId && e.email.toLowerCase() === email!.toLowerCase());
  if (clash) fail(`${clash.name} already uses ${email}. Change their email first.`);
  db = normalize(structuredClone(d!));
  db.employees = db.employees.map((e) => (e.id === adminId ? { ...e, email: email!, active: true } : e));
  resetSynced(); // nothing is in the cloud yet, so everything uploads
  setCloud({ phase: 'ready' });
  login(adminId);
}

/** Atomic transaction: runs on a draft copy; on any error nothing is committed. */
// ponytail: structuredClone of the whole DB per write is O(size); fine for one academy, moves to Postgres transactions with Supabase.
function tx<T>(fn: (d: DB) => T): T {
  const draft = structuredClone(db);
  const out = fn(draft);
  db = draft; persist(); emit();
  return out;
}

/**
 * Highest number already used for this kind of ID anywhere in the data (id, receiptNo, code), so a lost or
 * stale counter (another device, a fresh sync) can never hand out an ID that already exists.
 * ponytail: scans every record per new ID; fine for thousands of rows, keep a per-prefix max if it ever gets slow.
 */
function highest(d: DB, re: RegExp) {
  let max = 0;
  for (const v of Object.values(d)) if (Array.isArray(v)) for (const r of v as Record<string, unknown>[])
    for (const k of ['id', 'receiptNo', 'code']) { const m = typeof r[k] === 'string' && re.exec(r[k] as string); if (m) max = Math.max(max, +m[1]); }
  return max;
}
const bump = (d: DB, key: string, re: RegExp) => (d.counters[key] = Math.max(d.counters[key] ?? 0, highest(d, re)) + 1);
const next = (d: DB, prefix: string, pad = 4) => `${prefix}-${String(bump(d, prefix, new RegExp(`^${prefix}-(\\d+)$`))).padStart(pad, '0')}`;
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** Student ID = IM + admission month + running serial, e.g. IMNOV0001, IMNOV0002, IMDEC0003. The serial never resets, so IDs stay unique across years. */
export const studentCode = (d: DB, admissionDate: ISODate) => `IM${MON[+admissionDate.slice(5, 7) - 1]}${String(bump(d, 'IM', /^IM[A-Z]{3}(\d+)$/)).padStart(4, '0')}`;
function audit(d: DB, action: string, entity: string, entityId: string, detail = '') {
  d.audit.unshift({ id: uid(), at: nowISO(), by: me ?? 'system', action, entity, entityId, detail });
}
function notify(d: DB, n: Omit<Notification, 'id' | 'at' | 'readBy'>, rule?: string) {
  if (rule && !d.settings.rules[rule]) return;
  if (d.notifications.some((x) => x.key === n.key)) return; // idempotent
  d.notifications.unshift({ ...n, id: uid(), at: nowISO(), readBy: [] });
}

// ---------------------------------------------------------------------------------------------
// session & permissions
// ---------------------------------------------------------------------------------------------
export const currentUser = (d: DB = db) => d.employees.find((e) => e.id === me) ?? null;
export const useMe = () => { const d = useDB(); return d.employees.find((e) => e.id === me) ?? null; };
export const allowed = (mod: Module, act: Action = 'view', d: DB = db) => { const u = currentUser(d); return !!u && can(d.settings.permissions, u.role, mod, act); };
function guard(d: DB, mod: Module, act: Action) {
  const u = currentUser(d);
  if (!u) fail('Please sign in first.');
  if (!can(d.settings.permissions, u!.role, mod, act)) fail(`Your role does not allow "${act}" on ${mod}.`);
  return u!;
}
export const empName = (id?: string, d: DB = db) => d.employees.find((e) => e.id === id)?.name ?? (id && d.settings.formerStaff?.[id]) ?? (id === 'system' ? 'System' : '—');

// ponytail: "sign in as" until Supabase Auth replaces it; permission checks already live in the data layer.
export function login(id: string) {
  tx((d) => {
    const e = d.employees.find((x) => x.id === id && x.active) ?? fail('Employee not found or inactive.');
    me = e.id;
    d.logins.unshift({ id: uid(), userId: e.id, at: nowISO(), userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'test' });
    audit(d, 'login', 'employee', e.id);
  });
  try { sessionStorage.setItem('me', id); } catch { /* tests */ }
}
export function logout() {
  if (cloud.enabled) { void signOutCloud(); clearSession(); return; }
  me = null;
  try { sessionStorage.removeItem('me'); } catch { /* */ }
  db = { ...db }; // new snapshot so every subscriber re-renders into the signed-out state
  emit();
}

export function createFirstAdmin(name: string, phone: string, email: string) {
  if (db.employees.length) fail('Setup already completed.');
  if (cloud.enabled) {
    if (cloud.phase !== 'setup' || !cloud.email) fail('Sign in first.');
    email = cloud.email!; // the login email is what links this account to the employee
    if (!normalizePhone(phone)) fail('Enter a valid 10-digit mobile number.');
    setCloud({ phase: 'ready' });
  }
  const id = uid();
  tx((d) => { d.employees.push({ id, name, phone: normalizePhone(phone) ?? phone, email, role: 'super_admin', active: true, createdAt: nowISO() }); });
  login(id);
}

// ---------------------------------------------------------------------------------------------
// settings, employees, courses, batches
// ---------------------------------------------------------------------------------------------
export function updateSettings(patch: Partial<Settings>, reason = '') {
  tx((d) => {
    const u = guard(d, 'settings', 'edit');
    if (patch.shares) {
      if (u.role !== 'super_admin') fail('Only Super Admin can change profit-sharing percentages.');
      splitProfit(100, patch.shares); // throws unless exactly 100%
      // a founder renamed in place: carry the new name to course splits and past withdrawals
      if (patch.shares.length === d.settings.shares.length)
        d.settings.shares.forEach((old, i) => {
          const to = patch.shares![i].name;
          if (old.name === to) return;
          for (const c of d.courses) for (const s of c.shares ?? []) if (s.name === old.name) s.name = to;
          for (const w of d.withdrawals) if (w.founder === old.name) w.founder = to;
        });
    }
    if (patch.permissions && u.role !== 'super_admin') fail('Only Super Admin can change permissions.');
    d.settings = { ...d.settings, ...patch };
    audit(d, 'settings.update', 'settings', '-', `${Object.keys(patch).join(', ')}${reason ? ` — ${reason}` : ''}`);
  });
}

export function saveEmployee(e: Omit<Employee, 'id' | 'createdAt'> & { id?: string }) {
  return tx((d) => {
    const u = guard(d, 'employees', e.id ? 'edit' : 'create');
    if (e.role === 'super_admin' && u.role !== 'super_admin') fail('Only Super Admin can create another Super Admin.');
    if (!e.name.trim()) fail('Name is required.');
    const phone = normalizePhone(e.phone) ?? fail('Enter a valid 10-digit mobile number.');
    if (d.employees.some((x) => x.phone === phone && x.id !== e.id)) fail('Another employee already uses this mobile number.');
    if (e.email.trim() && d.employees.some((x) => x.id !== e.id && x.email.toLowerCase() === e.email.trim().toLowerCase())) fail('Another employee already uses this email / login ID.');
    if (e.id) {
      const cur = d.employees.find((x) => x.id === e.id)!;
      if (cur.role === 'super_admin' && (e.role !== 'super_admin' || !e.active) && d.employees.filter((x) => x.role === 'super_admin' && x.active).length === 1)
        fail('At least one active Super Admin is required.');
      Object.assign(cur, { ...e, phone });
      audit(d, 'employee.update', 'employee', e.id, `${e.name} (${e.role}${e.active ? '' : ', inactive'})`);
      return e.id;
    }
    const id = uid();
    d.employees.push({ ...e, phone, id, createdAt: nowISO() });
    audit(d, 'employee.create', 'employee', id, `${e.name} (${e.role})`);
    return id;
  });
}

/**
 * Removes an employee for good. Their leads, batches and students are left unassigned (the cloud tables link to
 * employees, so those links must be cleared first); past payments, calls and the activity log keep their name.
 */
export function deleteEmployee(id: string) {
  return tx((d) => {
    const u = guard(d, 'employees', 'delete');
    if (u.role !== 'super_admin' && u.role !== 'admin') fail('Only an admin can delete an employee.');
    const e = d.employees.find((x) => x.id === id) ?? fail('Employee not found.');
    if (e.id === u.id) fail('You cannot delete your own account.');
    if (e.role === 'super_admin' && u.role !== 'super_admin') fail('Only a Super Admin can delete a Super Admin.');
    if (e.role === 'super_admin' && e.active && d.employees.filter((x) => x.role === 'super_admin' && x.active).length === 1) fail('At least one active Super Admin is required.');
    const leads = d.leads.filter((l) => l.assignedTo === id);
    for (const l of leads) l.assignedTo = '';
    for (const b of d.batches) if (b.teacherId === id) b.teacherId = '';
    for (const s of d.students) if (s.counsellorId === id) s.counsellorId = '';
    d.settings = { ...d.settings, formerStaff: { ...d.settings.formerStaff, [id]: e.name } };
    d.employees = d.employees.filter((x) => x.id !== id);
    audit(d, 'employee.delete', 'employee', id, `${e.name} (${e.role}, ${e.phone}) · ${leads.length} leads unassigned`);
  });
}

/** A course's full fee, booking included. */
export const courseFee = (c: Pick<Course, 'bookingDefault' | 'instalments'>) => c.bookingDefault + c.instalments.reduce((a, x) => a + x, 0);

export function saveCourse(c: Omit<Course, 'id'> & { id?: string }) {
  return tx((d) => {
    guard(d, 'settings', 'edit');
    c = { ...c, name: c.name.trim() };
    if (!c.name) fail('Course name is required.');
    if (d.courses.some((x) => x.id !== c.id && x.name.toLowerCase() === c.name.toLowerCase())) fail('A course with this name already exists.');
    if (!Number.isInteger(c.durationWeeks) || c.durationWeeks < 1) fail('Duration must be at least 1 week.');
    if (!Number.isInteger(c.bookingDefault) || c.bookingDefault < 0) fail('Booking amount cannot be negative.');
    if (!c.instalments.length || c.instalments.some((x) => !Number.isInteger(x) || x <= 0)) fail('Each instalment must be a positive amount.');
    if (c.shares) {
      if (c.shares.some((s) => !s.name.trim() || s.pctBp <= 0)) fail('Each founder needs a name and a share above 0%.');
      const total = c.shares.reduce((a, s) => a + s.pctBp, 0);
      if (total !== 10000) fail(`Founder shares must add up to 100% (now ${(total / 100).toFixed(2)}%).`);
    }
    if (c.id) { Object.assign(d.courses.find((x) => x.id === c.id)!, c); audit(d, 'course.update', 'course', c.id, c.name); return c.id; }
    const id = uid(); d.courses.push({ ...c, id }); audit(d, 'course.create', 'course', id, c.name); return id;
  });
}
/** A founder takes money out of the profit. Recorded with a receipt number; does not change the profit itself. */
export function addWithdrawal(w: Omit<Withdrawal, 'id' | 'by' | 'createdAt'>) {
  return tx((d) => {
    guard(d, 'profit', 'create');
    if (!d.settings.shares.some((s) => s.name === w.founder)) fail('Choose a founder.');
    if (!Number.isInteger(w.amount) || w.amount <= 0) fail('Enter an amount greater than zero.');
    if (w.date > todayIST()) fail('The date cannot be in the future.');
    if (!/^\d{4}-\d{2}$/.test(w.forMonth)) fail('Choose which month\'s profit this is from.');
    if (w.method !== 'Cash' && !w.reference.trim()) fail('Add the reference / UTR for non-cash payments.');
    const id = next(d, 'WDR', 5);
    d.withdrawals.unshift({ ...w, reference: w.reference.trim(), notes: w.notes.trim(), id, by: me ?? 'system', createdAt: nowISO() });
    audit(d, 'withdrawal.create', 'withdrawal', id, `${w.founder} ₹${w.amount / 100} for ${w.forMonth}`);
    return id;
  });
}
export function deleteWithdrawal(id: string, reason: string) {
  tx((d) => {
    guard(d, 'profit', 'delete');
    if (!reason.trim()) fail('Please give a reason.');
    const w = d.withdrawals.find((x) => x.id === id) ?? fail('Withdrawal not found.');
    d.withdrawals = d.withdrawals.filter((x) => x.id !== id);
    audit(d, 'withdrawal.delete', 'withdrawal', id, `${w!.founder} ₹${w!.amount / 100} for ${w!.forMonth} — ${reason}`);
  });
}

/** Only courses nobody has joined can be deleted; otherwise mark them Closed. */
export function deleteCourse(id: string) {
  tx((d) => {
    guard(d, 'settings', 'edit');
    if (d.students.some((s) => s.courseId === id) || d.batches.some((b) => b.courseId === id)) fail('Students or batches use this course. Mark it Closed instead.');
    if (d.courses.length <= 1) fail('Keep at least one course.');
    const c = d.courses.find((x) => x.id === id);
    d.courses = d.courses.filter((x) => x.id !== id); audit(d, 'course.delete', 'course', id, c?.name ?? '');
  });
}

export function saveBatch(b: Omit<Batch, 'id'> & { id?: string }) {
  return tx((d) => {
    guard(d, 'batches', b.id ? 'edit' : 'create');
    if (!b.name.trim()) fail('Batch name is required.');
    if (b.endDate && b.endDate < b.startDate) fail('End date cannot be before start date.');
    if (b.capacity < 1) fail('Capacity must be at least 1.');
    if (b.id) { Object.assign(d.batches.find((x) => x.id === b.id)!, b); audit(d, 'batch.update', 'batch', b.id, b.name); return b.id; }
    const id = next(d, 'BAT', 3); d.batches.push({ ...b, id }); audit(d, 'batch.create', 'batch', id, b.name); return id;
  });
}

export function transferStudent(studentId: string, batchId: string, reason: string) {
  tx((d) => {
    guard(d, 'batches', 'edit');
    if (!reason.trim()) fail('A reason is required for batch transfers.');
    const s = d.students.find((x) => x.id === studentId)!;
    if (s.batchId === batchId) fail('Student is already in this batch.');
    assertCapacity(d, batchId);
    const today = todayIST();
    const open = d.enrolments.find((e) => e.studentId === studentId && !e.to);
    if (open) open.to = today;
    d.enrolments.push({ id: uid(), studentId, batchId, from: today, reason });
    audit(d, 'student.transfer', 'student', studentId, `${batchName(d, s.batchId)} → ${batchName(d, batchId)}: ${reason}`);
    s.batchId = batchId;
  });
}
const batchName = (d: DB, id: string) => d.batches.find((b) => b.id === id)?.name ?? 'No batch';
function assertCapacity(d: DB, batchId: string) {
  if (!batchId) return;
  const b = d.batches.find((x) => x.id === batchId) ?? fail('Batch not found.');
  const n = d.students.filter((s) => s.batchId === batchId && s.status === 'Active').length;
  if (n >= b.capacity) fail(`${b.name} is full (${b.capacity} seats).`);
}

export function markAttendance(batchId: string, date: ISODate, present: string[]) {
  tx((d) => {
    guard(d, 'batches', 'edit');
    const a = d.attendance.find((x) => x.batchId === batchId && x.date === date);
    if (a) a.present = present; else d.attendance.push({ id: uid(), batchId, date, present });
    audit(d, 'attendance.mark', 'batch', batchId, `${date}: ${present.length} present`);
  });
}

// ---------------------------------------------------------------------------------------------
// class schedule & per-class attendance
// ---------------------------------------------------------------------------------------------
export const DEFAULT_ATTENDANCE_WINDOW = { beforeMins: 15, afterMins: 15 };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Schedule a class, or edit / reschedule one. Reminders for the batch's students are (re)planned by the database. */
export function saveClass(c: Pick<ClassSession, 'batchId' | 'date' | 'startTime' | 'endTime' | 'notes'> & { id?: string }) {
  return tx((d) => {
    guard(d, 'batches', c.id ? 'edit' : 'create');
    const b = d.batches.find((x) => x.id === c.batchId) ?? fail('Choose a batch.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) fail('Choose the class date.');
    if (!HHMM.test(c.startTime) || !HHMM.test(c.endTime)) fail('Enter start and end time.');
    if (c.endTime <= c.startTime) fail('End time must be after the start time.');
    const clash = d.classes.find((x) => x.id !== c.id && x.batchId === c.batchId && x.date === c.date && x.status === 'scheduled' && x.startTime < c.endTime && c.startTime < x.endTime);
    if (clash) fail(`${b.name} already has a class at ${clash.startTime}–${clash.endTime} that day.`);
    const notes = c.notes.trim();
    if (c.id) {
      const cur = d.classes.find((x) => x.id === c.id) ?? fail('Class not found.');
      const moved = cur.date !== c.date || cur.startTime !== c.startTime || cur.endTime !== c.endTime;
      Object.assign(cur, { batchId: c.batchId, date: c.date, startTime: c.startTime, endTime: c.endTime, notes });
      audit(d, moved ? 'class.reschedule' : 'class.update', 'class', cur.id, `${b.name} ${c.date} ${c.startTime}–${c.endTime}`);
      return cur.id;
    }
    const id = uid();
    d.classes.push({ id, batchId: c.batchId, date: c.date, startTime: c.startTime, endTime: c.endTime, status: 'scheduled', notes, createdAt: nowISO() });
    audit(d, 'class.schedule', 'class', id, `${b.name} ${c.date} ${c.startTime}–${c.endTime}`);
    return id;
  });
}
export function setClassStatus(id: string, status: ClassSession['status'], reason = '') {
  tx((d) => {
    guard(d, 'batches', 'edit');
    const c = d.classes.find((x) => x.id === id) ?? fail('Class not found.');
    if (status === 'cancelled' && !reason.trim()) fail('Give a reason for cancelling.');
    c.status = status;
    audit(d, status === 'cancelled' ? 'class.cancel' : 'class.restore', 'class', id, `${batchName(d, c.batchId)} ${c.date}${reason ? ` — ${reason}` : ''}`);
    syncDayAttendance(d, c.batchId, c.date);
  });
}
/** Mark / correct one student for one class: present, absent, or null to clear. Every change is logged. */
export function setMark(classId: string, studentId: string, status: ClassMark['status'] | null) {
  tx((d) => {
    guard(d, 'batches', 'edit');
    const c = d.classes.find((x) => x.id === classId) ?? fail('Class not found.');
    if (c.status === 'cancelled') fail('This class was cancelled.');
    const s = d.students.find((x) => x.id === studentId) ?? fail('Student not found.');
    const id = `${classId}:${studentId}`, cur = d.marks.find((m) => m.id === id);
    const before = cur?.status ?? null;
    if (before === status) return;
    if (status === null) d.marks = d.marks.filter((m) => m.id !== id);
    else if (cur) Object.assign(cur, { status, at: nowISO(), method: 'manual', markedBy: me ?? 'system' });
    else d.marks.push({ id, classId, studentId, status, at: nowISO(), method: 'manual', markedBy: me ?? 'system' });
    audit(d, before ? 'attendance.correct' : 'attendance.mark', 'student', studentId, `${s.name} · ${batchName(d, c.batchId)} ${c.date} ${c.startTime}: ${before ?? 'not marked'} → ${status ?? 'not marked'}`);
    syncDayAttendance(d, c.batchId, c.date);
  });
}
/** Mark everyone not yet marked in a class as present or absent. */
export function markRest(classId: string, studentIds: string[], status: ClassMark['status']) {
  tx((d) => {
    guard(d, 'batches', 'edit');
    const c = d.classes.find((x) => x.id === classId) ?? fail('Class not found.');
    let n = 0;
    for (const sid of studentIds) {
      const id = `${classId}:${sid}`;
      if (d.marks.some((m) => m.id === id)) continue;
      d.marks.push({ id, classId, studentId: sid, status, at: nowISO(), method: 'manual', markedBy: me ?? 'system' }); n++;
    }
    audit(d, 'attendance.mark', 'class', classId, `${batchName(d, c.batchId)} ${c.date}: ${n} marked ${status}`);
    syncDayAttendance(d, c.batchId, c.date);
  });
}
/** YouTube video id from a watch / youtu.be / shorts / embed / live link (or a bare id). */
export function youtubeId(url: string): string | null {
  const u = url.trim();
  if (/^[\w-]{11}$/.test(u)) return u;
  const m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/i);
  return m ? m[1] : null;
}
/** Add or edit a lecture for a batch. */
export function saveVideo(v: Pick<BatchVideo, 'batchId' | 'title' | 'url' | 'notes'> & { id?: string }) {
  return tx((d) => {
    guard(d, 'batches', v.id ? 'edit' : 'create');
    const b = d.batches.find((x) => x.id === v.batchId) ?? fail('Batch not found.');
    const vid = youtubeId(v.url) ?? fail('Paste a YouTube video link (youtube.com/watch?v=… or youtu.be/…).');
    const title = v.title.trim() || fail('Give the lecture a title.');
    if (v.id) {
      const cur = d.videos.find((x) => x.id === v.id) ?? fail('Lecture not found.');
      Object.assign(cur, { title, url: v.url.trim(), videoId: vid, notes: v.notes.trim() });
      audit(d, 'lecture.update', 'batch', b.id, `${b.name}: ${title}`);
      return cur.id;
    }
    if (d.videos.some((x) => x.batchId === b.id && x.videoId === vid)) fail('This video is already added to this batch.');
    const id = uid();
    d.videos.push({ id, batchId: b.id, title, url: v.url.trim(), videoId: vid, notes: v.notes.trim(), createdAt: nowISO(), addedBy: me ?? 'system' });
    audit(d, 'lecture.add', 'batch', b.id, `${b.name}: ${title}`);
    return id;
  });
}
export function deleteVideo(id: string) {
  tx((d) => {
    guard(d, 'batches', 'edit');
    const v = d.videos.find((x) => x.id === id) ?? fail('Lecture not found.');
    d.videos = d.videos.filter((x) => x.id !== id);
    audit(d, 'lecture.remove', 'batch', v.batchId, v.title);
  });
}
/** Keeps the older day-level attendance record in step, so student profiles, reports and the portal stay correct. */
function syncDayAttendance(d: DB, batchId: string, date: ISODate) {
  const ids = new Set(d.classes.filter((c) => c.batchId === batchId && c.date === date && c.status === 'scheduled').map((c) => c.id));
  if (!ids.size) return;
  const present = [...new Set(d.marks.filter((m) => ids.has(m.classId) && m.status === 'present').map((m) => m.studentId))];
  const a = d.attendance.find((x) => x.batchId === batchId && x.date === date);
  if (a) a.present = present; else if (present.length) d.attendance.push({ id: uid(), batchId, date, present });
}

// ---------------------------------------------------------------------------------------------
// students & admissions
// ---------------------------------------------------------------------------------------------
export function findDuplicates(d: DB, phone: string, email = '', excludeId?: string) {
  const p = normalizePhone(phone);
  const e = email.trim().toLowerCase();
  return d.students.filter((s) => s.id !== excludeId && ((p && (s.phone === p || s.altPhone === p)) || (e && s.email.toLowerCase() === e)));
}

export interface AdmissionInput {
  key: string; // idempotency key from the form
  name: string; phone: string; altPhone?: string; email?: string; address?: string; city?: string; state?: string; pin?: string; photo?: string;
  dob?: ISODate; gender?: Student['gender'];
  courseId: string; batchId: string; admissionDate: ISODate; source: string; campaign?: string; counsellorId: string;
  bookingAmount: Paise; bookingPaid?: { method: PayMethod; reference: string } | null;
  courseFee?: Paise; // this student's full fee incl. booking; missing = the course's fee
  idDoc?: Student['idDoc']; leadId?: string;
}

function admitInto(d: DB, a: AdmissionInput): string {
  const existing = d.students.find((s) => s.id === a.key);
  if (existing) return existing.id; // retried submit
  if (!a.name.trim()) fail('Student name is required.');
  const phone = normalizePhone(a.phone) ?? fail('Enter a valid 10-digit Indian mobile number.');
  const alt = a.altPhone ? normalizePhone(a.altPhone) ?? fail('Alternate mobile number is invalid.') : '';
  if (a.email && !/^\S+@\S+\.\S+$/.test(a.email)) fail('Email address looks invalid.');
  if (a.pin && !/^\d{6}$/.test(a.pin)) fail('PIN code must be 6 digits.');
  const dup = findDuplicates(d, phone, a.email);
  if (dup.length) fail(`Duplicate: ${dup[0].name} (${dup[0].code}) already uses this mobile number or email.`);
  const course = d.courses.find((c) => c.id === a.courseId) ?? fail('Select a course.');
  assertCapacity(d, a.batchId);
  assertOpen(d, a.admissionDate);
  const batch = d.batches.find((b) => b.id === a.batchId);
  const startDate = d.settings.startEvent === 'batch_start' && batch ? batch.startDate : a.admissionDate;
  const sched = buildSchedule({
    // the booking is always part of the course fee (₹8,500 fee = ₹1,000 booking + ₹7,500 in instalments)
    booking: a.bookingAmount, instalments: course.instalments, policy: 'additional',
    admissionDate: a.admissionDate, startDate, gapDays: d.settings.instalmentGapDays, total: a.courseFee ?? courseFee(course),
  });

  const id = a.key, code = studentCode(d, a.admissionDate);
  d.students.push({
    id, code, name: a.name.trim(), phone, altPhone: alt, email: a.email?.trim() ?? '', address: a.address ?? '', city: a.city ?? '', state: a.state ?? '',
    pin: a.pin ?? '', photo: a.photo, dob: a.dob || undefined, gender: a.gender || undefined, courseId: course.id, batchId: a.batchId, admissionDate: a.admissionDate, leadId: a.leadId,
    source: a.source, campaign: a.campaign ?? '', counsellorId: a.counsellorId, status: 'Active', remindersOptOut: false, idDoc: a.idDoc, createdAt: nowISO(),
  });
  if (a.batchId) d.enrolments.push({ id: uid(), studentId: id, batchId: a.batchId, from: a.admissionDate, reason: 'Admission' });
  const planId = uid();
  d.feePlans.push({ id: planId, studentId: id, policy: 'additional', bookingAmount: a.bookingAmount, total: sched.total, startDate, createdAt: a.admissionDate });
  for (const l of sched.lines) d.instalments.push({ id: uid(), planId, studentId: id, seq: l.seq, label: l.label, amount: l.amount, dueDate: l.dueDate, state: 'active' });
  audit(d, 'student.admit', 'student', id, `${a.name} — ${course.name}, total ${sched.total / 100}`);
  if (a.idDoc) audit(d, 'iddoc.capture', 'student', id, `${a.idDoc.type}${a.idDoc.maskedNumber ? ' ' + a.idDoc.maskedNumber : ''} · consent ${a.idDoc.consentAt.slice(0, 10)} · ${a.idDoc.imageRetained ? 'card images saved' : 'no images'}`);
  if (a.bookingPaid && a.bookingAmount > 0)
    paymentInto(d, { key: `${id}:booking`, studentId: id, amount: a.bookingAmount, date: a.admissionDate, method: a.bookingPaid.method, reference: a.bookingPaid.reference, notes: 'Booking amount', verified: true });
  notify(d, { key: `admit:${id}`, title: 'New admission', body: `${a.name} (${code}) admitted to ${course.name}`, link: `/students/${id}`, forRoles: ['admin', 'accountant'] }, 'student_admitted');
  return id;
}

export function admitStudent(a: AdmissionInput) {
  return tx((d) => { guard(d, 'admissions', 'create'); return admitInto(d, a); });
}

export function updateStudent(id: string, patch: Partial<Student>) {
  tx((d) => {
    guard(d, 'students', 'edit');
    const s = d.students.find((x) => x.id === id) ?? fail('Student not found.');
    for (const k of ['id', 'code', 'status', 'batchId', 'courseId'] as const) delete patch[k]; // use dedicated actions
    if (patch.phone !== undefined) patch.phone = normalizePhone(patch.phone) ?? fail('Enter a valid 10-digit mobile number.');
    if (patch.altPhone) patch.altPhone = normalizePhone(patch.altPhone) ?? fail('Alternate mobile number is invalid.');
    if (patch.phone || patch.email) {
      const dup = findDuplicates(d, patch.phone ?? s.phone, patch.email ?? s.email, id);
      if (dup.length) fail(`Duplicate: ${dup[0].name} (${dup[0].code}) already uses this mobile number or email.`);
    }
    if (patch.idDoc !== undefined && !allowed('sensitive', 'edit', d)) fail('You are not allowed to change identity documents.');
    const changed = Object.keys(patch).filter((k) => (s as any)[k] !== (patch as any)[k]);
    Object.assign(s, patch);
    audit(d, 'student.update', 'student', id, changed.filter((k) => k !== 'photo' && k !== 'idDoc').join(', ') + (changed.includes('idDoc') ? ' idDoc' : ''));
  });
}

/**
 * Permanently deletes a student and everything that belongs only to them (fee plan, instalments, payments,
 * enrolments, calls, certificates, attendance). The reason and a summary stay in the activity log.
 */
export function deleteStudent(id: string, reason: string) {
  return tx((d) => {
    const u = guard(d, 'students', 'delete');
    if (u.role !== 'super_admin' && u.role !== 'admin') fail('Only an admin can delete a student.');
    const s = d.students.find((x) => x.id === id) ?? fail('Student not found.');
    if (!reason.trim()) fail('Please write why this student is being deleted.');
    const paid = financeFor(d, id, todayIST()).paid;
    const docs = s.idDoc?.files ? [s.idDoc.files.front, s.idDoc.files.back] : [];
    d.students = d.students.filter((x) => x.id !== id);
    d.enrolments = d.enrolments.filter((x) => x.studentId !== id);
    d.feePlans = d.feePlans.filter((x) => x.studentId !== id);
    d.instalments = d.instalments.filter((x) => x.studentId !== id);
    d.payments = d.payments.filter((x) => x.studentId !== id);
    d.calls = d.calls.filter((x) => !(x.entity === 'student' && x.entityId === id));
    d.certificates = d.certificates.filter((x) => x.studentId !== id);
    d.marks = d.marks.filter((x) => x.studentId !== id);
    for (const a of d.attendance) if (a.present.includes(id)) a.present = a.present.filter((x) => x !== id);
    for (const l of d.leads) if (l.convertedStudentId === id) l.convertedStudentId = '';
    audit(d, 'student.delete', 'student', id, `${s.name} (${s.code}, ${s.phone}) · paid ${paid / 100} · reason: ${reason.trim()}`);
    return docs; // Aadhaar images to remove from storage
  });
}

export function setStudentStatus(id: string, status: StudentStatus, reason: string) {
  tx((d) => {
    guard(d, 'students', 'edit');
    const s = d.students.find((x) => x.id === id) ?? fail('Student not found.');
    if (s.status === status) return;
    if (!reason.trim()) fail('Please enter a reason for the status change.');
    if (status === 'Refunded' && !d.payments.some((p) => p.studentId === id && p.kind === 'refund')) fail('Record the refund first (Fee Details → Refund).');
    if (status === 'Active') assertCapacity(d, s.batchId);
    const prev = s.status;
    s.status = status;
    if (status === 'Refunded' || status === 'Dropped') {
      const paidMap = financeFor(d, id, todayIST()).lines;
      for (const i of d.instalments.filter((x) => x.studentId === id && x.state === 'active')) {
        if ((paidMap.find((l) => l.id === i.id)?.paid ?? 0) < i.amount) i.state = 'cancelled';
      }
    }
    audit(d, 'student.status', 'student', id, `${prev} → ${status}: ${reason}`);
    if (status === 'Completed') {
      const tpl = d.templates[0];
      if (d.settings.certificateAutoIssue && tpl) issueInto(d, id, tpl.id);
      else notify(d, { key: `cert-eligible:${id}`, title: 'Certificate approval needed', body: `${s.name} completed the course`, link: `/certificates?student=${id}`, forRoles: ['admin'] }, 'certificate_eligible');
    }
  });
}

/** Course kit handed to the student (or undo a mistake). Recorded with time and staff member. */
export function setKitReceived(id: string, received: boolean) {
  tx((d) => {
    const u = guard(d, 'students', 'edit');
    const s = d.students.find((x) => x.id === id) ?? fail('Student not found.');
    if (received) { s.kitReceivedAt = nowISO(); s.kitReceivedBy = u.id; } else { s.kitReceivedAt = undefined; s.kitReceivedBy = undefined; }
    audit(d, received ? 'kit.given' : 'kit.undo', 'student', id, received ? 'Course kit handed over' : 'Kit status reset to not received');
  });
}
export function setReminderOptOut(id: string, optOut: boolean) {
  tx((d) => { guard(d, 'students', 'edit'); d.students.find((s) => s.id === id)!.remindersOptOut = optOut; audit(d, 'student.optout', 'student', id, optOut ? 'opted out of reminders' : 'opted in'); });
}

export function deleteIdDocument(id: string, reason: string) {
  tx((d) => {
    guard(d, 'sensitive', 'delete');
    const s = d.students.find((x) => x.id === id)!;
    if (!s.idDoc) return;
    s.idDoc = undefined;
    audit(d, 'iddoc.delete', 'student', id, reason || 'deleted on request');
  });
}
export function logSensitiveView(id: string) { tx((d) => { guard(d, 'sensitive', 'view'); audit(d, 'iddoc.view', 'student', id); }); }

// ---------------------------------------------------------------------------------------------
// fees & payments
// ---------------------------------------------------------------------------------------------
function assertOpen(d: DB, date: ISODate) {
  const p = d.periods.find((x) => x.id === monthOf(date));
  if (p?.status === 'closed') fail(`${monthOf(date)} is a closed financial period. Ask a Super Admin to reopen it with a reason.`);
}

export function overrideInstalment(id: string, patch: { amount?: Paise; dueDate?: ISODate; state?: 'active' | 'waived' }, reason: string) {
  tx((d) => {
    guard(d, 'fees', 'edit');
    if (!reason.trim()) fail('A reason is required for overrides.');
    const i = d.instalments.find((x) => x.id === id) ?? fail('Instalment not found.');
    if (patch.amount !== undefined && (!Number.isInteger(patch.amount) || patch.amount <= 0)) fail('Amount must be positive.');
    const before = `${i.amount / 100} on ${i.dueDate} (${i.state})`;
    if (patch.amount !== undefined) {
      const paid = financeFor(d, i.studentId, todayIST()).lines.find((l) => l.id === id)!.paid;
      if (patch.amount < paid) fail(`Amount cannot be less than what is already paid (₹${paid / 100}).`);
    }
    Object.assign(i, patch);
    const plan = d.feePlans.find((p) => p.id === i.planId)!;
    plan.total = d.instalments.filter((x) => x.planId === plan.id && x.state === 'active').reduce((a, x) => a + x.amount, 0);
    audit(d, 'instalment.override', 'student', i.studentId, `${i.label}: ${before} → ${i.amount / 100} on ${i.dueDate} (${i.state}). ${reason}`);
  });
}

export interface PaymentInput { key: string; studentId: string; amount: Paise; date: ISODate; method: PayMethod; reference: string; notes: string; verified: boolean }
function paymentInto(d: DB, p: PaymentInput): string {
  const dupe = d.payments.find((x) => x.key === p.key);
  if (dupe) return dupe.id; // idempotent: double-click / retry never double-counts
  if (!Number.isInteger(p.amount) || p.amount <= 0) fail('Enter an amount greater than zero.');
  if (p.date > todayIST()) fail('Payment date cannot be in the future. Promised payments are not recorded as received.');
  if (p.method !== 'Cash' && !p.reference.trim() && p.verified) fail('Reference / UTR number is required for non-cash payments.');
  if (p.reference.trim() && d.payments.some((x) => x.kind === 'payment' && x.method === p.method && x.reference.trim() === p.reference.trim()))
    fail(`Reference ${p.reference} was already used for another ${p.method} payment.`);
  assertOpen(d, p.date);
  const s = d.students.find((x) => x.id === p.studentId) ?? fail('Student not found.');
  if (s.status === 'Refunded') fail('Cannot take payments from a refunded student.');
  const f = financeFor(d, p.studentId, todayIST());
  const pending = d.payments.filter((x) => x.studentId === p.studentId && x.kind === 'payment' && !x.verified && !d.payments.some((r) => r.reversesId === x.id)).reduce((a, x) => a + x.amount, 0);
  if (p.amount > f.outstanding - pending) fail(`Amount exceeds the outstanding balance of ₹${(f.outstanding - pending) / 100}.`);
  const id = next(d, 'TXN', 6);
  d.payments.push({ ...p, reference: p.reference.trim(), id, kind: 'payment', receivedBy: me ?? 'system', receiptNo: next(d, 'RCPT', 6), createdAt: nowISO() });
  audit(d, 'payment.record', 'student', p.studentId, `${id} ₹${p.amount / 100} via ${p.method}${p.verified ? '' : ' (awaiting verification)'}`);
  notify(d, { key: `pay:${id}`, title: 'Payment recorded', body: `₹${p.amount / 100} from ${s.name} via ${p.method}`, link: `/students/${s.id}?tab=payments`, forRoles: ['accountant'] }, 'payment_recorded');
  return id;
}
export function recordPayment(p: PaymentInput) { return tx((d) => { guard(d, 'fees', 'create'); return paymentInto(d, p); }); }

export function verifyPayment(id: string) {
  tx((d) => {
    guard(d, 'fees', 'approve');
    const p = d.payments.find((x) => x.id === id) ?? fail('Payment not found.');
    if (p.verified) return;
    assertOpen(d, p.date);
    p.verified = true;
    audit(d, 'payment.verify', 'student', p.studentId, `${id} verified`);
  });
}

/** Never edits the original: adds a reversal row. The original stays visible, marked reversed. */
export function reversePayment(id: string, reason: string) {
  return tx((d) => {
    guard(d, 'fees', 'approve');
    if (!reason.trim()) fail('A reason is required to reverse a payment.');
    const p = d.payments.find((x) => x.id === id && x.kind === 'payment') ?? fail('Payment not found.');
    if (d.payments.some((x) => x.reversesId === id)) fail('This payment is already reversed.');
    const date = todayIST();
    assertOpen(d, date);
    const rid = next(d, 'TXN', 6);
    d.payments.push({ id: rid, key: `rev:${id}`, studentId: p.studentId, amount: p.amount, date, method: p.method, reference: p.reference, receivedBy: me ?? 'system', notes: reason, kind: 'reversal', reversesId: id, receiptNo: '', verified: p.verified, createdAt: nowISO() });
    audit(d, 'payment.reverse', 'student', p.studentId, `${id} reversed by ${rid}: ${reason}`);
    return rid;
  });
}

export function recordRefund(studentId: string, amount: Paise, method: PayMethod, reference: string, reason: string) {
  return tx((d) => {
    guard(d, 'fees', 'approve');
    if (!reason.trim()) fail('A reason is required for refunds.');
    const date = todayIST();
    assertOpen(d, date);
    const f = financeFor(d, studentId, date);
    if (!Number.isInteger(amount) || amount <= 0) fail('Enter a refund amount.');
    if (amount > f.paid - f.refunded) fail(`Refund cannot exceed the net amount received (₹${(f.paid - f.refunded) / 100}).`);
    const id = next(d, 'TXN', 6);
    d.payments.push({ id, key: `refund:${uid()}`, studentId, amount, date, method, reference, receivedBy: me ?? 'system', notes: reason, kind: 'refund', receiptNo: '', verified: true, createdAt: nowISO() });
    audit(d, 'payment.refund', 'student', studentId, `${id} refund ₹${amount / 100}: ${reason}`);
    return id;
  });
}

// ---------------------------------------------------------------------------------------------
// leads & calls
// ---------------------------------------------------------------------------------------------
export function visibleLeads(d: DB): Lead[] {
  const u = currentUser(d);
  if (!u) return [];
  return u.role === 'caller' ? d.leads.filter((l) => l.assignedTo === u.id) : can(d.settings.permissions, u.role, 'leads') ? d.leads : [];
}
function ownLead(d: DB, id: string) {
  const l = d.leads.find((x) => x.id === id) ?? fail('Lead not found.');
  const u = currentUser(d)!;
  if (u.role === 'caller' && l.assignedTo !== u.id) fail('This lead is not assigned to you.');
  return l;
}

export function saveLead(l: Partial<Lead> & { name: string; phone: string }) {
  return tx((d) => {
    const u = guard(d, 'leads', l.id ? 'edit' : 'create');
    if (!l.name.trim()) fail('Name is required.');
    const phone = normalizePhone(l.phone) ?? fail('Enter a valid 10-digit Indian mobile number.');
    const dupLead = d.leads.find((x) => x.phone === phone && x.id !== l.id);
    if (dupLead) fail(`Duplicate: lead ${dupLead.name} (${dupLead.id}) already has this number.`);
    const dupStu = findDuplicates(d, phone);
    if (dupStu.length) fail(`This number belongs to student ${dupStu[0].name} (${dupStu[0].code}).`);
    if (l.id) {
      const cur = ownLead(d, l.id);
      const wasAssigned = cur.assignedTo;
      if (u.role === 'caller') delete l.assignedTo;
      Object.assign(cur, { ...l, phone });
      audit(d, 'lead.update', 'lead', cur.id, cur.name);
      if (l.assignedTo && l.assignedTo !== wasAssigned) assignNotify(d, [cur]);
      return cur.id;
    }
    const id = next(d, 'LD', 5);
    const lead: Lead = { email: '', source: 'Manual', campaign: '', status: 'New', interest: 'Medium', notes: '', ...l, assignedTo: u.role === 'caller' ? u.id : l.assignedTo ?? '', id, phone, createdAt: nowISO() };
    d.leads.push(lead);
    audit(d, 'lead.create', 'lead', id, lead.name);
    if (lead.assignedTo) assignNotify(d, [lead]);
    return id;
  });
}

function assignNotify(d: DB, leads: Lead[]) {
  const by = new Map<string, number>();
  leads.forEach((l) => l.assignedTo && by.set(l.assignedTo, (by.get(l.assignedTo) ?? 0) + 1));
  by.forEach((n, uidv) => notify(d, { key: `assign:${uidv}:${uid()}`, title: 'Leads assigned to you', body: `${n} lead${n > 1 ? 's' : ''} added to your calling queue`, link: '/leads?view=calling', forRoles: [], forUser: uidv }, 'lead_assigned'));
}

export function assignLeads(ids: string[], callerId: string) {
  tx((d) => {
    guard(d, 'leads', 'edit');
    if (currentUser(d)!.role === 'caller') fail('Callers cannot reassign leads.');
    const leads = d.leads.filter((l) => ids.includes(l.id));
    leads.forEach((l) => (l.assignedTo = callerId));
    audit(d, 'lead.assign', 'lead', ids.join(','), `→ ${empName(callerId, d)}`);
    assignNotify(d, leads);
  });
}

export function setLeadStatus(id: string, status: string) {
  tx((d) => {
    guard(d, 'leads', 'edit');
    const l = ownLead(d, id);
    if (l.convertedStudentId) fail('This lead is already a student, so its status cannot change.');
    const prev = l.status; l.status = status;
    if (status === 'Converted') {
      // the caller's job ends here; the admission team completes the admission from Admissions → Ready for admission
      l.nextFollowUp = undefined;
      notify(d, { key: `conv:${id}`, title: 'Ready for admission', body: `${l.name} was marked Converted — complete the admission`, link: '/admissions', forRoles: ['admin', 'super_admin'] });
    }
    if (status === 'Hot') {
      if (!l.nextFollowUp || l.nextFollowUp > todayIST()) l.nextFollowUp = todayIST();
      notify(d, { key: `hot:${id}:${todayIST()}`, title: 'Hot lead', body: `${l.name} marked Hot — follow up today`, link: '/leads?view=calling', forRoles: ['calling_manager'], forUser: l.assignedTo }, 'lead_hot');
    }
    audit(d, 'lead.status', 'lead', id, `${prev} → ${status}`);
  });
}

const OUTCOME_STATUS: Partial<Record<CallOutcome, string>> = {
  Connected: 'Connected', Interested: 'Warm', 'Not Interested': 'Cold', 'Wrong Number': 'Lost', 'Call Later': 'Call Later',
};
/** Move a lead's follow-up to another day without logging a call (e.g. "call tomorrow instead"). */
export function moveFollowUp(id: string, date: ISODate) {
  tx((d) => {
    guard(d, 'leads', 'edit');
    if (date < todayIST()) fail('Follow-up date cannot be in the past.');
    const l = ownLead(d, id);
    const prev = l.nextFollowUp;
    l.nextFollowUp = date;
    audit(d, 'lead.followup', 'lead', id, `${prev ?? 'none'} → ${date}`);
  });
}

export function logCall(entity: 'lead' | 'student', entityId: string, outcome: CallOutcome, notes: string, nextFollowUp?: ISODate) {
  tx((d) => {
    const u = guard(d, entity === 'lead' ? 'leads' : 'collections', entity === 'lead' ? 'edit' : 'create');
    if (nextFollowUp && nextFollowUp < todayIST()) fail('Follow-up date cannot be in the past.');
    if (NEEDS_DATE.includes(outcome) && !nextFollowUp) fail(outcome === 'Call Later' ? 'Pick a follow-up date for "Call Later".' : `Pick the date for "${outcome}".`);
    const at = nowISO();
    d.calls.unshift({ id: uid(), entity, entityId, by: u.id, at, outcome, notes, nextFollowUp });
    if (entity === 'lead') {
      const l = ownLead(d, entityId);
      l.lastCallAt = at;
      l.nextFollowUp = nextFollowUp;
      const st = OUTCOME_STATUS[outcome];
      if (st && l.status !== 'Hot' && l.status !== 'Converted') l.status = st;
      if (l.status === 'New') l.status = 'Not Contacted';
      if (notes) l.notes = notes;
    }
    audit(d, 'call.log', entity, entityId, `${outcome}${nextFollowUp ? `, follow-up ${nextFollowUp}` : ''}`);
  });
}

export function importLeads(fileName: string, rows: { name: string; phone: string; email: string; source: string; campaign: string; notes: string; assignee: string }[], errors: { row: number; reason: string; data: Record<string, string> }[], totals: { total: number; duplicates: number; invalid: number }) {
  return tx((d) => {
    guard(d, 'leads', 'create');
    const jobId = next(d, 'IMP', 4);
    const created: Lead[] = [];
    const late: typeof errors = [];
    for (const r of rows) {
      const phone = normalizePhone(r.phone);
      if (!phone) { late.push({ row: 0, reason: 'Invalid mobile', data: r as any }); continue; }
      if (d.leads.some((l) => l.phone === phone) || findDuplicates(d, phone).length) { late.push({ row: 0, reason: 'Duplicate (added meanwhile)', data: r as any }); continue; }
      const lead: Lead = { id: next(d, 'LD', 5), name: r.name, phone, email: r.email, source: r.source, campaign: r.campaign, notes: r.notes, assignedTo: r.assignee, status: 'New', interest: 'Medium', createdAt: nowISO(), importJobId: jobId };
      d.leads.push(lead); created.push(lead);
    }
    const job = { id: jobId, at: nowISO(), by: me!, fileName, total: totals.total, imported: created.length, duplicates: totals.duplicates + late.filter((x) => x.reason.startsWith('Dup')).length, invalid: totals.invalid + late.filter((x) => !x.reason.startsWith('Dup')).length, errors: [...errors, ...late] };
    d.imports.unshift(job);
    audit(d, 'lead.import', 'import', jobId, `${fileName}: ${created.length} imported, ${job.duplicates} duplicates, ${job.invalid} invalid`);
    notify(d, { key: `import:${jobId}`, title: 'Lead import finished', body: `${created.length} new leads from ${fileName}`, link: '/leads', forRoles: ['calling_manager'] }, 'lead_imported');
    assignNotify(d, created);
    return job;
  });
}

/** Converts a lead: creates the student, admission and fee schedule in ONE transaction, preserving attribution & calls. */
export function convertLead(leadId: string, a: Omit<AdmissionInput, 'name' | 'phone' | 'source' | 'campaign' | 'leadId'> & { name?: string; email?: string }) {
  return tx((d) => {
    guard(d, 'admissions', 'create');
    const l = d.leads.find((x) => x.id === leadId) ?? fail('Lead not found.');
    if (l.convertedStudentId) fail('This lead was already converted.');
    const sid = admitInto(d, { ...a, name: a.name || l.name, phone: l.phone, email: a.email ?? l.email, source: l.source, campaign: l.campaign, leadId });
    l.status = 'Converted'; l.convertedStudentId = sid; l.nextFollowUp = undefined;
    audit(d, 'lead.convert', 'lead', leadId, `→ student ${d.students.find((s) => s.id === sid)!.code}`);
    return sid;
  });
}

// ---------------------------------------------------------------------------------------------
// expenses
// ---------------------------------------------------------------------------------------------
export function addExpense(e: Omit<Expense, 'id' | 'addedBy' | 'status' | 'adjustments'> & { key?: string }) {
  return tx((d) => {
    guard(d, 'expenses', 'create');
    if (!Number.isInteger(e.amount) || e.amount <= 0) fail('Enter an amount greater than zero.');
    if (!e.category) fail('Choose a category.');
    if (!e.description.trim()) fail('Description is required.');
    assertOpen(d, e.date);
    const id = next(d, 'EXP', 5);
    const autoApprove = allowed('expenses', 'approve', d);
    d.expenses.push({ ...e, id, addedBy: me ?? 'system', status: autoApprove ? 'Approved' : 'Pending', adjustments: [] });
    audit(d, 'expense.create', 'expense', id, `${e.category} ₹${e.amount / 100}${autoApprove ? ' (auto-approved)' : ''}`);
    if (!autoApprove) notify(d, { key: `exp:${id}`, title: 'Expense awaiting approval', body: `${e.category}: ₹${e.amount / 100} — ${e.description}`, link: '/expenses?status=Pending', forRoles: ['accountant', 'admin'] }, 'expense_submitted');
    return id;
  });
}
export function decideExpense(id: string, approve: boolean, note = '') {
  tx((d) => {
    guard(d, 'expenses', 'approve');
    const e = d.expenses.find((x) => x.id === id) ?? fail('Expense not found.');
    if (e.status !== 'Pending') fail('Only pending expenses can be approved or rejected.');
    assertOpen(d, e.date);
    e.status = approve ? 'Approved' : 'Rejected';
    audit(d, approve ? 'expense.approve' : 'expense.reject', 'expense', id, note);
  });
}
/** Financial edits are logged deltas, never silent overwrites. */
export function adjustExpense(id: string, newAmount: Paise, reason: string) {
  tx((d) => {
    guard(d, 'expenses', 'edit');
    if (!reason.trim()) fail('A reason is required.');
    const e = d.expenses.find((x) => x.id === id) ?? fail('Expense not found.');
    assertOpen(d, e.date);
    const cur = e.amount + e.adjustments.reduce((a, x) => a + x.delta, 0);
    if (newAmount < 0 || newAmount === cur) fail('Enter a different, non-negative amount.');
    e.adjustments.push({ at: nowISO(), by: me!, delta: newAmount - cur, reason });
    audit(d, 'expense.adjust', 'expense', id, `₹${cur / 100} → ₹${newAmount / 100}: ${reason}`);
  });
}
export function saveRecurring(r: Omit<RecurringExpense, 'id'> & { id?: string }) {
  tx((d) => {
    guard(d, 'expenses', 'create');
    if (r.dayOfMonth < 1 || r.dayOfMonth > 28) fail('Day of month must be between 1 and 28.');
    if (r.id) Object.assign(d.recurring.find((x) => x.id === r.id)!, r);
    else d.recurring.push({ ...r, id: uid() });
    audit(d, 'recurring.save', 'expense', r.id ?? 'new', `${r.category} ₹${r.amount / 100} monthly`);
  });
}

// ---------------------------------------------------------------------------------------------
// financial periods & profit distribution
// ---------------------------------------------------------------------------------------------
export function closePeriod(ym: string) {
  return tx((d) => {
    guard(d, 'profit', 'create');
    const [from, to] = monthRange(ym);
    if (to >= todayIST()) fail('A month can only be closed after it has ended.');
    if (d.expenses.some((e) => e.status === 'Pending' && monthOf(e.date) === ym)) fail('Approve or reject all pending expenses for this month first.');
    if (d.payments.some((p) => p.kind === 'payment' && !p.verified && monthOf(p.date) === ym)) fail('Verify or reverse unverified payments for this month first.');
    let p = d.periods.find((x) => x.id === ym);
    if (p?.status === 'closed') fail('Period already closed.');
    if (!p) { p = { id: ym, status: 'open', history: [] }; d.periods.push(p); }
    const snap = periodFigures(d, from, to, to);
    p.status = 'closed'; p.snapshot = snap;
    p.history.push({ at: nowISO(), by: me!, action: 'closed', reason: '' });
    audit(d, 'period.close', 'period', ym, `net profit ₹${snap.netProfit / 100}`);
    const existing = d.distributions.find((x) => x.periodId === ym && x.status !== 'Reversed');
    if (!existing && d.settings.rules.month_closed) {
      const distributable = Math.max(0, snap.netProfit);
      d.distributions.push({ id: next(d, 'DST', 4), periodId: ym, figures: snap, adjustments: [], distributable, shares: splitProfit(distributable, d.settings.shares), status: 'Draft', payments: [], createdAt: nowISO() });
      notify(d, { key: `dist:${ym}`, title: 'Profit distribution draft ready', body: `${ym}: net profit ₹${snap.netProfit / 100}`, link: '/profit', forRoles: ['accountant'] }, 'month_closed');
    } else if (existing && existing.status === 'Draft') {
      existing.figures = snap;
      recalcDist(d, existing);
    }
    return snap;
  });
}
export function reopenPeriod(ym: string, reason: string) {
  tx((d) => {
    const u = guard(d, 'profit', 'approve');
    if (u.role !== 'super_admin') fail('Only Super Admin can reopen a closed period.');
    if (reason.trim().length < 10) fail('Give a documented reason (at least 10 characters).');
    const p = d.periods.find((x) => x.id === ym && x.status === 'closed') ?? fail('Period is not closed.');
    if (d.distributions.some((x) => x.periodId === ym && (x.status === 'Paid' || x.status === 'Partially Paid'))) fail('Profit for this period was already paid out. Reverse the distribution first.');
    p.status = 'open';
    p.history.push({ at: nowISO(), by: u.id, action: 'reopened', reason });
    d.distributions.filter((x) => x.periodId === ym && x.status !== 'Reversed').forEach((x) => (x.status = 'Draft'));
    audit(d, 'period.reopen', 'period', ym, reason);
  });
}

function recalcDist(d: DB, x: Distribution) {
  const adj = x.adjustments.reduce((a, b) => a + b.amount, 0);
  x.distributable = Math.max(0, x.figures.netProfit + adj);
  x.shares = splitProfit(x.distributable, x.shares.map(({ name, pctBp }) => ({ name, pctBp })));
}
export function setDistributionAdjustments(id: string, adjustments: { label: string; amount: Paise }[]) {
  tx((d) => {
    guard(d, 'profit', 'edit');
    const x = d.distributions.find((y) => y.id === id) ?? fail('Not found.');
    if (x.status !== 'Draft' && x.status !== 'Under Review') fail('Only draft distributions can be adjusted.');
    x.adjustments = adjustments;
    recalcDist(d, x);
    audit(d, 'distribution.adjust', 'distribution', id, adjustments.map((a) => `${a.label}: ${a.amount / 100}`).join('; '));
  });
}
export function setDistributionStatus(id: string, status: DistributionStatus, reason = '') {
  tx((d) => {
    const x = d.distributions.find((y) => y.id === id) ?? fail('Not found.');
    const flow: Record<string, DistributionStatus[]> = { Draft: ['Under Review'], 'Under Review': ['Approved', 'Draft'], Approved: ['Reversed'], Paid: ['Reversed'], 'Partially Paid': ['Reversed'] };
    if (!flow[x.status]?.includes(status)) fail(`Cannot move from ${x.status} to ${status}.`);
    const u = guard(d, 'profit', status === 'Approved' || status === 'Reversed' ? 'approve' : 'edit');
    if (status === 'Approved') {
      if (d.periods.find((p) => p.id === x.periodId)?.status !== 'closed') fail('Close the financial period before approving its distribution.');
      if (x.distributable <= 0) fail('No distributable profit for this period — nothing to approve for payout.');
      x.approvedBy = u.id;
    }
    if (status === 'Reversed' && !reason.trim()) fail('A reason is required to reverse a distribution.');
    x.status = status;
    audit(d, 'distribution.status', 'distribution', id, `${status}${reason ? `: ${reason}` : ''}`);
  });
}
export function payDistribution(id: string, shareName: string, amount: Paise, date: ISODate) {
  tx((d) => {
    guard(d, 'profit', 'edit');
    const x = d.distributions.find((y) => y.id === id) ?? fail('Not found.');
    if (x.status !== 'Approved' && x.status !== 'Partially Paid') fail('Distribution must be approved before payout.');
    const share = x.shares.find((s) => s.name === shareName) ?? fail('Unknown share.');
    const paid = x.payments.filter((p) => p.shareName === shareName).reduce((a, p) => a + p.amount, 0);
    if (amount <= 0 || amount > share.amount - paid) fail(`Amount must be between ₹0.01 and ₹${(share.amount - paid) / 100}.`);
    x.payments.push({ id: next(d, 'DPAY', 5), at: date, shareName, amount, by: me! });
    const fully = x.shares.every((s) => x.payments.filter((p) => p.shareName === s.name).reduce((a, p) => a + p.amount, 0) >= s.amount);
    x.status = fully ? 'Paid' : 'Partially Paid';
    audit(d, 'distribution.pay', 'distribution', id, `${shareName} ₹${amount / 100}`);
  });
}

// ---------------------------------------------------------------------------------------------
// certificates
// ---------------------------------------------------------------------------------------------
export function saveTemplate(t: Omit<CertificateTemplate, 'id' | 'createdAt'> & { id?: string }) {
  return tx((d) => {
    guard(d, 'certificates', t.id ? 'edit' : 'create');
    if (!t.name.trim()) fail('Template name is required.');
    if (t.id) { Object.assign(d.templates.find((x) => x.id === t.id)!, t); audit(d, 'template.update', 'template', t.id, t.name); return t.id; }
    const id = uid(); d.templates.push({ ...t, id, createdAt: nowISO() }); audit(d, 'template.create', 'template', id, t.name); return id;
  });
}
export function deleteTemplate(id: string) {
  tx((d) => {
    guard(d, 'certificates', 'delete');
    if (d.certificates.some((c) => c.templateId === id)) fail('Certificates were issued with this template; it cannot be deleted.');
    d.templates = d.templates.filter((t) => t.id !== id);
    audit(d, 'template.delete', 'template', id);
  });
}
function issueInto(d: DB, studentId: string, templateId: string): Certificate {
  const existing = d.certificates.find((c) => c.studentId === studentId && c.status === 'Issued');
  if (existing) return existing; // idempotent
  const s = d.students.find((x) => x.id === studentId) ?? fail('Student not found.');
  if (s.status !== 'Completed') fail(`${s.name} has not completed the course yet.`);
  const course = d.courses.find((c) => c.id === s.courseId);
  const c: Certificate = {
    id: next(d, `CERT-${todayIST().slice(0, 4)}`, 4), studentId, templateId, issuedAt: nowISO(), issuedBy: me ?? 'system', status: 'Issued',
    data: { name: s.name, course: course?.name ?? '', date: todayIST(), batch: d.batches.find((b) => b.id === s.batchId)?.name ?? '' },
    history: [{ at: nowISO(), by: me ?? 'system', action: 'generated' }],
  };
  d.certificates.push(c);
  audit(d, 'certificate.issue', 'certificate', c.id, s.name);
  return c;
}
export function issueCertificates(studentIds: string[], templateId: string) {
  return tx((d) => { guard(d, 'certificates', 'create'); return studentIds.map((id) => issueInto(d, id, templateId)); });
}
export function revokeCertificate(id: string, reason: string) {
  tx((d) => {
    guard(d, 'certificates', 'delete');
    if (!reason.trim()) fail('A reason is required to revoke a certificate.');
    const c = d.certificates.find((x) => x.id === id) ?? fail('Not found.');
    c.status = 'Revoked'; c.history.push({ at: nowISO(), by: me!, action: 'revoked', note: reason });
    audit(d, 'certificate.revoke', 'certificate', id, reason);
  });
}
export function logCertificateEvent(ids: string[], action: 'downloaded' | 'regenerated') {
  tx((d) => {
    guard(d, 'certificates', 'view');
    for (const c of d.certificates.filter((x) => ids.includes(x.id))) c.history.push({ at: nowISO(), by: me!, action });
    audit(d, `certificate.${action}`, 'certificate', ids.join(','));
  });
}

// ---------------------------------------------------------------------------------------------
// notifications & automation (idempotent: every generated item has a dedupe key)
// ---------------------------------------------------------------------------------------------
export function markRead(ids: string[]) { tx((d) => { for (const n of d.notifications) if (ids.includes(n.id) && me && !n.readBy.includes(me)) n.readBy.push(me); }); }
export const notificationsFor = (d: DB, u: Employee | null) =>
  !u ? [] : d.notifications.filter((n) => n.forUser === u.id || n.forRoles.includes(u.role) || (u.role === 'super_admin' && !n.forUser) || (u.role === 'admin' && n.forRoles.length && !n.forUser));

export function runAutomations(today = todayIST()) {
  const d = structuredClone(db);
  const before = d.notifications.length + d.expenses.length;
  {
    for (const s of d.students.filter((x) => x.status === 'Active')) {
      const f = financeFor(d, s.id, today);
      for (const l of f.lines.filter((x) => x.remaining > 0)) {
        const offsets = [...d.settings.reminderOffsets].sort((a, b) => b - a);
        const off = offsets.find((o) => addDays(l.dueDate, o) <= today);
        if (off === undefined || addDays(l.dueDate, Math.max(...offsets)) < addDays(today, -7)) continue; // stale beyond a week: covered by overdue list
        const overdue = off > 0;
        const when = off < 0 ? `due in ${-off} day${off === -1 ? '' : 's'}` : off === 0 ? 'due today' : `overdue by ${off} day${off === 1 ? '' : 's'}`;
        notify(d, {
          key: `rem:${l.id}:${off}`, title: overdue ? 'Payment overdue' : 'Payment reminder',
          body: `${s.name} — ${l.label} ₹${l.remaining / 100} ${when}${s.remindersOptOut ? ' (student opted out of messages)' : ''}`,
          link: `/collections?view=${overdue ? 'overdue' : 'due7'}`, forRoles: ['accountant', 'admin'], phone: s.remindersOptOut ? undefined : s.phone,
        }, overdue ? 'payment_overdue' : 'payment_due');
      }
    }
    for (const l of d.leads.filter((x) => x.nextFollowUp && x.nextFollowUp <= today && x.status !== 'Converted' && x.status !== 'Lost' && x.assignedTo))
      notify(d, { key: `fu:${l.id}:${l.nextFollowUp}`, title: 'Follow-up due', body: `Call ${l.name} (${l.nextFollowUp === today ? 'today' : 'overdue'})`, link: '/leads?view=calling', forRoles: [], forUser: l.assignedTo }, 'followup_due');
    // recurring expenses: one per (template, month) — the generated key makes retries safe
    for (const rec of d.recurring.filter((x) => x.active)) {
      const ym = monthOf(today);
      if (ym < rec.startMonth || today < `${ym}-${String(rec.dayOfMonth).padStart(2, '0')}`) continue;
      if (d.expenses.some((e) => e.recurringId === `${rec.id}:${ym}`)) continue;
      if (d.periods.find((p) => p.id === ym)?.status === 'closed') continue;
      const id = next(d, 'EXP', 5);
      const kind = ['Office Rent', 'Internet', 'Electricity', 'Fixed Salaries', 'Software Subscriptions', 'Maintenance'].includes(rec.category) ? 'fixed' : 'variable';
      d.expenses.push({ id, category: rec.category, kind, description: `${rec.description} (recurring)`, amount: rec.amount, date: `${ym}-${String(rec.dayOfMonth).padStart(2, '0')}`, method: 'Bank Transfer', addedBy: 'system', status: 'Pending', notes: '', recurringId: `${rec.id}:${ym}`, adjustments: [] });
      notify(d, { key: `exp:${id}`, title: 'Recurring expense awaiting approval', body: `${rec.category}: ₹${rec.amount / 100}`, link: '/expenses?status=Pending', forRoles: ['accountant', 'admin'] }, 'expense_submitted');
    }
  }
  const created = d.notifications.length + d.expenses.length - before;
  if (created) { db = d; persist(); emit(); } // only commit when something was generated
  return created;
}

// ---------------------------------------------------------------------------------------------
// backup / demo / reset
// ---------------------------------------------------------------------------------------------
export function exportBackup() { guard(db, 'settings', 'export'); return JSON.stringify(db); }
export function resetAll() {
  const u = currentUser();
  if (u?.role !== 'super_admin') fail('Only Super Admin can erase data.');
  db = emptyDB(); me = null; persist(); emit();
}
export function restoreBackup(json: string) {
  const u = currentUser();
  if (u?.role !== 'super_admin') fail('Only Super Admin can restore a backup.');
  const parsed = JSON.parse(json) as DB;
  if (!Array.isArray(parsed.students) || !parsed.settings) fail('This file is not a valid backup.');
  db = { ...emptyDB(), ...parsed }; persist(); emit();
}

/** Demo loader only: back-dates seeded records. Super Admin, audited. */
export function demoPatch(fn: (d: DB) => void) {
  tx((d) => { if (currentUser(d)?.role !== 'super_admin') fail('Super Admin only.'); fn(d); audit(d, 'demo.load', 'system', '-', 'Demo data loaded'); });
}

/** For tests only. */
export function __setDB(d: DB, userId: string | null = null) { db = d; me = userId; }
export type { Role };

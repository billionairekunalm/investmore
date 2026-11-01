import type { DB } from '../domain/types';

/**
 * One source of truth for how app records map to Supabase tables. The sync layer converts with it, and
 * schema.test.ts checks it against supabase/migrations/0001_init.sql and against real records, so a field
 * can never be silently dropped.
 *
 * Column kinds: text · int (counts) · money (bigint paise) · bool · date ('YYYY-MM-DD') · ts (timestamptz) · json (jsonb)
 * blank: the app uses '' for "none" → stored as NULL, read back as ''. Otherwise NULL ↔ undefined.
 */
export type Kind = 'text' | 'int' | 'money' | 'bool' | 'date' | 'ts' | 'json';
export type ColSpec = { field: string; col: string; kind: Kind; blank?: boolean };
export type TableSpec = { table: string; key: CollectionKey; cols: ColSpec[] };
export type CollectionKey = Exclude<keyof DB, 'version' | 'settings' | 'counters'>;

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const RENAME: Record<string, string> = { from: 'from_date', to: 'to_date', by: 'by_user' }; // SQL reserved words
/** 'name', 'amount:money', 'batchId:text?' ( ? = blank '' ↔ NULL ) */
const cols = (...defs: string[]): ColSpec[] => defs.map((d) => {
  const [field, rest = 'text'] = d.split(':');
  const blank = rest.endsWith('?');
  return { field, col: RENAME[field] ?? snake(field), kind: rest.replace('?', '') as Kind, ...(blank ? { blank } : {}) };
});

// Order matters: parents before children (inserts run top-down, deletes bottom-up).
export const TABLES: TableSpec[] = [
  { table: 'employees', key: 'employees', cols: cols('id', 'name', 'phone', 'email', 'role', 'active:bool', 'createdAt:ts?') },
  { table: 'courses', key: 'courses', cols: cols('id', 'name', 'bookingDefault:money', 'instalments:json', 'durationWeeks:int', 'description', 'status', 'launchDate:date', 'shares:json') },
  { table: 'batches', key: 'batches', cols: cols('id', 'name', 'courseId', 'teacherId:text?', 'startDate:date', 'endDate:date', 'schedule', 'timing', 'capacity:int', 'status') },
  { table: 'leads', key: 'leads', cols: cols('id', 'name', 'phone', 'email', 'source', 'campaign', 'assignedTo:text?', 'status', 'interest', 'lastCallAt:ts', 'nextFollowUp:date', 'notes', 'createdAt:ts', 'convertedStudentId', 'importJobId') },
  { table: 'students', key: 'students', cols: cols('id', 'code', 'name', 'phone', 'altPhone', 'email', 'address', 'city', 'state', 'pin', 'photo', 'dob:date', 'gender',
    'courseId', 'batchId:text?', 'admissionDate:date', 'leadId', 'source', 'campaign', 'counsellorId:text?', 'status', 'remindersOptOut:bool', 'idDoc:json', 'createdAt:ts', 'kitReceivedAt:ts', 'kitReceivedBy') },
  { table: 'enrolments', key: 'enrolments', cols: cols('id', 'studentId', 'batchId', 'from:date', 'to:date', 'reason') },
  { table: 'fee_plans', key: 'feePlans', cols: cols('id', 'studentId', 'policy', 'bookingAmount:money', 'total:money', 'startDate:date', 'createdAt:ts') },
  { table: 'instalments', key: 'instalments', cols: cols('id', 'planId', 'studentId', 'seq:int', 'label', 'amount:money', 'dueDate:date', 'state') },
  { table: 'payments', key: 'payments', cols: cols('id', 'key', 'studentId', 'amount:money', 'date:date', 'method', 'reference', 'receivedBy', 'notes', 'kind', 'reversesId', 'receiptNo', 'verified:bool', 'createdAt:ts') },
  { table: 'calls', key: 'calls', cols: cols('id', 'entity', 'entityId', 'by', 'at:ts', 'outcome', 'notes', 'nextFollowUp:date') },
  { table: 'recurring_expenses', key: 'recurring', cols: cols('id', 'category', 'description', 'amount:money', 'dayOfMonth:int', 'active:bool', 'startMonth') },
  { table: 'expenses', key: 'expenses', cols: cols('id', 'category', 'kind', 'description', 'amount:money', 'date:date', 'method', 'receipt:json', 'addedBy', 'status', 'notes', 'recurringId', 'adjustments:json') },
  { table: 'financial_periods', key: 'periods', cols: cols('id', 'status', 'snapshot:json', 'history:json') },
  { table: 'distributions', key: 'distributions', cols: cols('id', 'periodId', 'figures:json', 'adjustments:json', 'distributable:money', 'shares:json', 'status', 'approvedBy', 'payments:json', 'createdAt:ts') },
  { table: 'certificate_templates', key: 'templates', cols: cols('id', 'name', 'fileType', 'data', 'fields:json', 'createdAt:ts') },
  { table: 'certificates', key: 'certificates', cols: cols('id', 'studentId', 'templateId', 'issuedAt:ts', 'issuedBy', 'status', 'data:json', 'history:json') },
  { table: 'attendance', key: 'attendance', cols: cols('id', 'batchId', 'date:date', 'present:json') },
  { table: 'notifications', key: 'notifications', cols: cols('id', 'key', 'at:ts', 'title', 'body', 'link', 'forRoles:json', 'forUser', 'readBy:json', 'phone') },
  { table: 'audit_log', key: 'audit', cols: cols('id', 'at:ts', 'by', 'action', 'entity', 'entityId', 'detail') },
  { table: 'import_jobs', key: 'imports', cols: cols('id', 'at:ts', 'by', 'fileName', 'total:int', 'imported:int', 'duplicates:int', 'invalid:int', 'errors:json') },
  { table: 'login_events', key: 'logins', cols: cols('id', 'userId', 'at:ts', 'userAgent') },
  { table: 'founder_withdrawals', key: 'withdrawals', cols: cols('id', 'founder', 'amount:money', 'date:date', 'forMonth', 'method', 'reference', 'notes', 'by', 'createdAt:ts', 'proof:json') },
];

type Rec = Record<string, unknown>;

/** App record → table row. */
export function toRow(spec: TableSpec, obj: Rec): Rec {
  const row: Rec = {};
  for (const c of spec.cols) {
    const v = obj[c.field];
    row[c.col] = v === undefined || (c.blank && v === '') ? null : v;
  }
  return row;
}

/** Table row → app record (timestamps normalised to the app's ISO 'Z' form). */
export function fromRow(spec: TableSpec, row: Rec): Rec {
  const obj: Rec = {};
  for (const c of spec.cols) {
    const v = row[c.col];
    if (v === null || v === undefined) { if (c.blank) obj[c.field] = ''; continue; }
    obj[c.field] = c.kind === 'ts' ? new Date(String(v)).toISOString() : c.kind === 'money' || c.kind === 'int' ? Number(v) : v;
  }
  return obj;
}

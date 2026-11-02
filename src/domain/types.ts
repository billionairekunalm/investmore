// All money is integer paise. All calendar dates are 'YYYY-MM-DD' in Asia/Kolkata.
export type Paise = number;
export type ISODate = string;

export type Role = 'super_admin' | 'admin' | 'calling_manager' | 'caller' | 'teacher' | 'accountant';
export const ROLES: { id: Role; label: string }[] = [
  { id: 'super_admin', label: 'Super Admin' },
  { id: 'admin', label: 'Admin' },
  { id: 'calling_manager', label: 'Calling Manager' },
  { id: 'caller', label: 'Caller' },
  { id: 'teacher', label: 'Teacher' },
  { id: 'accountant', label: 'Accountant' },
];

export type Module =
  | 'dashboard' | 'leads' | 'students' | 'admissions' | 'fees' | 'collections' | 'batches'
  | 'certificates' | 'expenses' | 'profit' | 'reports' | 'employees' | 'notifications' | 'settings'
  | 'sensitive';
export type Action = 'view' | 'create' | 'edit' | 'delete' | 'export' | 'approve';
export type PermissionMatrix = Record<Role, Partial<Record<Module, Action[]>>>;

export interface Employee {
  id: string; name: string; phone: string; email: string; role: Role; active: boolean; createdAt: string;
}

export type CourseStatus = 'upcoming' | 'active' | 'closed';
export interface Course {
  id: string; name: string; bookingDefault: Paise; instalments: Paise[]; durationWeeks: number;
  description?: string; status?: CourseStatus; launchDate?: ISODate; // status missing = active (older records)
  shares?: Share[]; // founders' split of this course's fees; missing = the default split in Settings
}

export type BatchStatus = 'upcoming' | 'running' | 'completed' | 'cancelled';
export interface Batch {
  id: string; name: string; courseId: string; teacherId: string; startDate: ISODate; endDate: ISODate;
  schedule: string; timing: string; capacity: number; status: BatchStatus;
}

export type StudentStatus = 'Active' | 'Completed' | 'Inactive' | 'Dropped' | 'Refunded';
export const STUDENT_STATUSES: StudentStatus[] = ['Active', 'Completed', 'Inactive', 'Dropped', 'Refunded'];

export interface IdDocument {
  type: 'Aadhaar' | 'PAN' | 'Driving Licence' | 'Passport' | 'Voter ID' | 'Other';
  maskedNumber: string; // never the full number: last 4 only ('' if it could not be read)
  nameOnDoc: string; consentAt: string; capturedBy: string; imageRetained: boolean;
  files?: { front?: string; back?: string }; // card images: 'sb:<path>' in the private Supabase bucket, or a data URL in device-only mode
}

export type Gender = 'Male' | 'Female' | 'Transgender' | '';
export const GENDERS: Exclude<Gender, ''>[] = ['Male', 'Female', 'Transgender'];

export interface Student {
  id: string; code: string; name: string; phone: string; altPhone: string; email: string;
  address: string; city: string; state: string; pin: string; photo?: string; dob?: ISODate; gender?: Gender;
  courseId: string; batchId: string; admissionDate: ISODate; leadId?: string; source: string; campaign: string;
  counsellorId: string; status: StudentStatus; remindersOptOut: boolean; idDoc?: IdDocument; createdAt: string;
  kitReceivedAt?: string; kitReceivedBy?: string; // course kit handed over (empty = not yet)
}

export interface Enrolment { id: string; studentId: string; batchId: string; from: ISODate; to?: ISODate; reason: string }

export type BookingPolicy = 'additional' | 'credited';
export interface FeePlan {
  id: string; studentId: string; policy: BookingPolicy; bookingAmount: Paise; total: Paise; startDate: ISODate; createdAt: string;
}
export interface Instalment {
  id: string; planId: string; studentId: string; seq: number; label: string; amount: Paise; dueDate: ISODate;
  state: 'active' | 'waived' | 'cancelled';
}

export type PayMethod = 'Cash' | 'UPI' | 'Bank Transfer' | 'Card' | 'Online Gateway';
export const PAY_METHODS: PayMethod[] = ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Online Gateway'];
export interface Payment {
  id: string; key: string; studentId: string; amount: Paise; date: ISODate; method: PayMethod; reference: string;
  receivedBy: string; notes: string; kind: 'payment' | 'reversal' | 'refund'; reversesId?: string;
  receiptNo: string; verified: boolean; createdAt: string;
}

export type InstalmentStatus =
  | 'Paid' | 'Partially Paid' | 'Due Soon' | 'Pending' | 'Overdue' | 'Waived' | 'Cancelled' | 'Refunded';

export type LeadSource = 'Meta Ads' | 'Facebook' | 'Instagram' | 'Website' | 'Referral' | 'Walk-in' | 'Manual' | 'Other';
export const LEAD_SOURCES: LeadSource[] = ['Meta Ads', 'Facebook', 'Instagram', 'Website', 'Referral', 'Walk-in', 'Manual', 'Other'];
export interface Lead {
  id: string; name: string; phone: string; email: string; source: string; campaign: string; assignedTo: string;
  status: string; interest: 'Low' | 'Medium' | 'High'; lastCallAt?: string; nextFollowUp?: ISODate; notes: string;
  createdAt: string; convertedStudentId?: string; importJobId?: string;
}

export type CallOutcome = 'Connected' | 'Not Answered' | 'Busy' | 'Call Later' | 'Interested' | 'Not Interested' | 'Wrong Number'
  | 'Promised to Pay' | 'Already Paid' | 'Needs More Time'; // last three: fee follow-up calls to students
export const CALL_OUTCOMES: CallOutcome[] = ['Connected', 'Not Answered', 'Busy', 'Call Later', 'Interested', 'Not Interested', 'Wrong Number'];
export const FEE_CALL_OUTCOMES: CallOutcome[] = ['Promised to Pay', 'Already Paid', 'Needs More Time', 'Call Later', 'Not Answered', 'Busy', 'Wrong Number'];
/** Outcomes that must come with a date (call-back date, or the date the student said they will pay). */
export const NEEDS_DATE: CallOutcome[] = ['Call Later', 'Promised to Pay', 'Needs More Time'];
export interface CallActivity {
  id: string; entity: 'lead' | 'student'; entityId: string; by: string; at: string; outcome: CallOutcome; notes: string; nextFollowUp?: ISODate;
}

export const FIXED_CATEGORIES = ['Office Rent', 'Internet', 'Electricity', 'Fixed Salaries', 'Software Subscriptions', 'Maintenance'];
export const VARIABLE_CATEGORIES = ['Marketing', 'Meta Ads', 'Travel', 'Commissions', 'Events', 'Equipment', 'Miscellaneous'];
export interface ExpenseAdjustment { at: string; by: string; delta: Paise; reason: string }
export interface Expense {
  id: string; category: string; kind: 'fixed' | 'variable'; description: string; amount: Paise; date: ISODate;
  method: PayMethod; receipt?: { name: string; data: string }; addedBy: string; status: 'Pending' | 'Approved' | 'Rejected';
  notes: string; recurringId?: string; adjustments: ExpenseAdjustment[];
}
export interface RecurringExpense { id: string; category: string; description: string; amount: Paise; dayOfMonth: number; active: boolean; startMonth: string }

export interface PeriodFigures {
  from: ISODate; to: ISODate; billed: Paise; collected: Paise; refunds: Paise; gst: Paise; earned: Paise;
  fixedExpenses: Paise; variableExpenses: Paise; totalExpenses: Paise; netProfit: Paise; outstanding: Paise;
}
export interface FinancialPeriod {
  id: string; // YYYY-MM
  status: 'open' | 'closed'; snapshot?: PeriodFigures;
  history: { at: string; by: string; action: 'closed' | 'reopened'; reason: string }[];
}

export type DistributionStatus = 'Draft' | 'Under Review' | 'Approved' | 'Paid' | 'Partially Paid' | 'Reversed';
export interface Share { name: string; pctBp: number } // basis points, 10000 = 100%
export interface Distribution {
  id: string; periodId: string; figures: PeriodFigures; adjustments: { label: string; amount: Paise }[];
  distributable: Paise; shares: (Share & { amount: Paise })[]; status: DistributionStatus; approvedBy?: string;
  payments: { id: string; at: ISODate; shareName: string; amount: Paise; by: string }[]; createdAt: string;
}

export interface TemplateField { key: 'name' | 'course' | 'date' | 'certId' | 'batch'; x: number; y: number; size: number }
export interface CertificateTemplate {
  id: string; name: string; fileType: 'image/png' | 'image/jpeg' | 'application/pdf'; data: string; fields: TemplateField[]; createdAt: string;
}
export interface Certificate {
  id: string; studentId: string; templateId: string; issuedAt: string; issuedBy: string; status: 'Issued' | 'Revoked';
  data: { name: string; course: string; date: string; batch: string };
  history: { at: string; by: string; action: 'generated' | 'regenerated' | 'revoked' | 'downloaded'; note?: string }[];
}

export interface Attendance { id: string; batchId: string; date: ISODate; present: string[] }
/** One scheduled class of a batch. Times are 'HH:MM' in India time (IST). */
export interface ClassSession { id: string; batchId: string; date: ISODate; startTime: string; endTime: string; status: 'scheduled' | 'cancelled'; notes: string; createdAt: string }
/** One student's attendance in one class; id = `${classId}:${studentId}`, so there is only ever one record per student per class. */
export interface ClassMark { id: string; classId: string; studentId: string; status: 'present' | 'absent'; at: string; method: 'qr' | 'manual'; markedBy: string }

export interface Notification {
  id: string; key: string; at: string; title: string; body: string; link: string; forRoles: Role[]; forUser?: string; readBy: string[]; phone?: string;
}
export interface AuditLog { id: string; at: string; by: string; action: string; entity: string; entityId: string; detail: string }
export interface ImportJob {
  id: string; at: string; by: string; fileName: string; total: number; imported: number; duplicates: number; invalid: number;
  errors: { row: number; reason: string; data: Record<string, string> }[];
}
/** Money a founder takes out of the profit. forMonth = whose profit it is (usually the previous month). */
export interface Withdrawal {
  id: string; founder: string; amount: Paise; date: ISODate; forMonth: string; method: PayMethod; reference: string; notes: string; by: string; createdAt: string;
  proof?: { name: string; data: string }; // photo / screenshot of the payment
}
export interface LoginEvent { id: string; userId: string; at: string; userAgent: string }

export interface Settings {
  academyName: string;
  bookingPolicy: BookingPolicy | null; // null = admin has not chosen; admissions are blocked
  startEvent: 'admission' | 'batch_start';
  instalmentGapDays: number;
  gstRateBp: number; // GST included in fees, in basis points (1800 = 18%)
  shares: Share[];
  leadStatuses: string[];
  reminderOffsets: number[]; // days relative to due date: -2, 0, 1, 3
  rules: Record<string, boolean>;
  permissions: PermissionMatrix;
  certificateAutoIssue: boolean;
  invoice: { address: string; phone: string; email: string; gstin: string; note: string }; // printed on fee invoices
  attendanceWindow?: { beforeMins: number; afterMins: number }; // QR attendance opens this long before a class starts and closes this long after it ends
}

export interface DB {
  version: number;
  settings: Settings;
  counters: Record<string, number>;
  employees: Employee[]; courses: Course[]; batches: Batch[]; students: Student[]; enrolments: Enrolment[];
  feePlans: FeePlan[]; instalments: Instalment[]; payments: Payment[]; leads: Lead[]; calls: CallActivity[];
  expenses: Expense[]; recurring: RecurringExpense[]; periods: FinancialPeriod[]; distributions: Distribution[];
  templates: CertificateTemplate[]; certificates: Certificate[]; attendance: Attendance[]; classes: ClassSession[]; marks: ClassMark[];
  notifications: Notification[]; audit: AuditLog[]; imports: ImportJob[]; logins: LoginEvent[]; withdrawals: Withdrawal[];
}

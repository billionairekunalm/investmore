import { beforeEach, describe, expect, it } from 'vitest';
import * as S from './store/store';
import { buildSchedule } from './domain/fees';
import { splitProfit, periodFigures, financeFor } from './domain/finance';
import { checkImport, callingQueue } from './domain/leads';
import { normalizePhone, todayIST, addDays, uid, monthOf } from './domain/util';
import { can, defaultPermissions } from './domain/permissions';

const T = todayIST();
let admin: string;

function setup() {
  const d = S.emptyDB();
  admin = uid();
  d.employees.push({ id: admin, name: 'Owner', phone: '9000000001', email: '', role: 'super_admin', active: true, createdAt: '' });
  S.__setDB(d, admin);
  S.updateSettings({ bookingPolicy: 'additional' });
}
const course = () => S.getDB().courses[0].id;
const admit = (phone = '9876543210', extra: Partial<S.AdmissionInput> = {}) =>
  S.admitStudent({ key: uid(), name: 'Ravi Kumar', phone, courseId: course(), batchId: '', admissionDate: T, source: 'Walk-in', counsellorId: admin, bookingAmount: 100000, bookingPaid: null, ...extra });
const pay = (studentId: string, rupees: number, extra: Partial<S.PaymentInput> = {}) =>
  S.recordPayment({ key: uid(), studentId, amount: rupees * 100, date: T, method: 'Cash', reference: '', notes: '', verified: true, ...extra });

beforeEach(setup);

describe('A. admission → fee plan & 7-day schedule', () => {
  it('additional policy: booking + 3000/3000/1500, due +7/+14/+21', () => {
    const id = admit();
    const f = financeFor(S.getDB(), id, T);
    expect(f.total).toBe(850000);
    expect(f.lines.map((l) => [l.label, l.amount, l.dueDate])).toEqual([
      ['Booking', 100000, T], ['Instalment 1', 300000, addDays(T, 7)], ['Instalment 2', 300000, addDays(T, 14)], ['Instalment 3', 150000, addDays(T, 21)],
    ]);
  });
  it('credited policy: total stays 7500, booking deducted from last instalment', () => {
    const s = buildSchedule({ booking: 100000, instalments: [300000, 300000, 150000], policy: 'credited', admissionDate: T, startDate: T });
    expect(s.total).toBe(750000);
    expect(s.lines.map((l) => l.amount)).toEqual([100000, 300000, 300000, 50000]);
  });
  it('blocks admissions until booking policy is explicitly chosen', () => {
    S.getDB().settings.bookingPolicy = null;
    expect(() => admit()).toThrow(/booking-amount policy/);
  });
  it('retried submit with the same key does not create a second student', () => {
    const key = uid();
    admit('9876543210', { key }); admit('9876543210', { key });
    expect(S.getDB().students).toHaveLength(1);
  });
});

describe('B/C. partial and full payment', () => {
  it('₹1000 on ₹3000 instalment leaves ₹2000; then pays off', () => {
    const id = admit('9876543210', { bookingAmount: 0 });
    pay(id, 1000);
    let f = financeFor(S.getDB(), id, T);
    expect(f.lines[0].remaining).toBe(200000);
    expect(f.lines[0].status).toBe('Partially Paid');
    pay(id, 2000);
    f = financeFor(S.getDB(), id, T);
    expect(f.lines[0].status).toBe('Paid');
    expect(f.outstanding).toBe(450000);
  });
  it('same idempotency key never counts twice; overpayment rejected; future date rejected', () => {
    const id = admit();
    const key = uid();
    pay(id, 500, { key }); pay(id, 500, { key });
    expect(financeFor(S.getDB(), id, T).paid).toBe(50000);
    expect(() => pay(id, 9000)).toThrow(/exceeds/);
    expect(() => pay(id, 100, { date: addDays(T, 1) })).toThrow(/future/);
  });
  it('unverified (promised) payment is not counted as collected', () => {
    const id = admit();
    pay(id, 1000, { verified: false, method: 'Online Gateway' });
    expect(financeFor(S.getDB(), id, T).paid).toBe(0);
    expect(periodFigures(S.getDB(), T, T, T).collected).toBe(0);
  });
  it('reversal preserves the original and removes it from collections', () => {
    const id = admit();
    const tx = pay(id, 1000);
    S.reversePayment(tx, 'Entered wrong amount');
    const d = S.getDB();
    expect(d.payments.find((p) => p.id === tx)!.amount).toBe(100000);
    expect(financeFor(d, id, T).paid).toBe(0);
    expect(periodFigures(d, T, T, T).collected).toBe(0);
    expect(() => S.reversePayment(tx, 'again')).toThrow(/already reversed/);
  });
});

describe('D. overdue', () => {
  it('moving a due date into the past makes it overdue', () => {
    const id = admit('9876543210', { bookingAmount: 0 });
    const inst = S.getDB().instalments.find((i) => i.studentId === id)!;
    S.overrideInstalment(inst.id, { dueDate: addDays(T, -1) }, 'Test');
    expect(financeFor(S.getDB(), id, T).status).toBe('Overdue');
    expect(S.getDB().audit.some((a) => a.action === 'instalment.override')).toBe(true);
  });
});

describe('E. duplicates', () => {
  it('same mobile (any format) is rejected', () => {
    admit('9876543210');
    expect(() => admit('+91 98765-43210')).toThrow(/Duplicate/);
  });
});

describe('F. lead conversion', () => {
  it('creates student with attribution, keeps calls, leaves queue', () => {
    const lid = S.saveLead({ name: 'Asha', phone: '9123456780', source: 'Meta Ads', campaign: 'Diwali' });
    S.logCall('lead', lid, 'Interested', 'wants weekend batch');
    const sid = S.convertLead(lid, { key: uid(), courseId: course(), batchId: '', admissionDate: T, counsellorId: admin, bookingAmount: 100000, bookingPaid: { method: 'Cash', reference: '' } });
    const d = S.getDB();
    const s = d.students.find((x) => x.id === sid)!;
    expect([s.source, s.campaign, s.leadId]).toEqual(['Meta Ads', 'Diwali', lid]);
    expect(d.calls.filter((c) => c.entityId === lid)).toHaveLength(1);
    expect(callingQueue(d.leads, T).find((l) => l.id === lid)).toBeUndefined();
    expect(financeFor(d, sid, T).paid).toBe(100000);
    expect(() => S.convertLead(lid, { key: uid(), courseId: course(), batchId: '', admissionDate: T, counsellorId: admin, bookingAmount: 0 })).toThrow(/already converted/);
  });
});

describe('G. import validation', () => {
  it('splits valid, duplicate and invalid rows; nothing dropped', () => {
    const rows = [
      { Name: 'A', Mobile: '9811111111' }, { Name: 'B', Mobile: '12345' }, { Name: 'C', Mobile: '+91 98111 11111' },
      { Name: '', Mobile: '9822222222' }, { Name: 'D', Mobile: '9833333333' },
    ];
    const r = checkImport(rows, { name: 'Name', phone: 'Mobile' }, new Set(['9833333333']), 'Meta Ads');
    expect([r.valid.length, r.duplicates.length, r.invalid.length]).toEqual([1, 2, 2]);
    expect(normalizePhone('09811111111')).toBe('9811111111');
  });
});

describe('H. follow-up queue', () => {
  it('orders overdue > today > hot > new > others', () => {
    const base = { email: '', source: '', campaign: '', assignedTo: '', interest: 'Medium' as const, notes: '', createdAt: '' };
    const q = callingQueue([
      { ...base, id: 'other', name: '', phone: '', status: 'Warm', lastCallAt: 'x' },
      { ...base, id: 'new', name: '', phone: '', status: 'New' },
      { ...base, id: 'hot', name: '', phone: '', status: 'Hot' },
      { ...base, id: 'today', name: '', phone: '', status: 'Warm', nextFollowUp: T },
      { ...base, id: 'late', name: '', phone: '', status: 'Warm', nextFollowUp: addDays(T, -2) },
    ], T);
    expect(q.map((l) => l.id)).toEqual(['late', 'today', 'hot', 'new', 'other']);
  });
});

describe('I. certificates', () => {
  it('only completed students, unique IDs, idempotent', () => {
    const a = admit('9800000001'); const b = admit('9800000002');
    const tpl = S.saveTemplate({ name: 'Default', fileType: 'image/png', data: '', fields: [] });
    expect(() => S.issueCertificates([a], tpl)).toThrow(/not completed/);
    S.setStudentStatus(a, 'Completed', 'Finished'); S.setStudentStatus(b, 'Completed', 'Finished');
    const certs = S.issueCertificates([a, b], tpl);
    S.issueCertificates([a], tpl);
    expect(new Set(certs.map((c) => c.id)).size).toBe(2);
    expect(S.getDB().certificates).toHaveLength(2);
  });
});

describe('J/K. expenses and profit sharing', () => {
  it('net profit = collected − refunds − approved expenses; adjustments are logged deltas', () => {
    const id = admit();
    pay(id, 5000);
    const e1 = S.addExpense({ category: 'Office Rent', kind: 'fixed', description: 'Rent', amount: 100000, date: T, method: 'Bank Transfer', notes: '' });
    S.addExpense({ category: 'Meta Ads', kind: 'variable', description: 'Ads', amount: 50000, date: T, method: 'Card', notes: '' });
    S.adjustExpense(e1, 120000, 'Revised invoice');
    const f = periodFigures(S.getDB(), T, T, T);
    expect([f.collected, f.fixedExpenses, f.variableExpenses, f.netProfit]).toEqual([500000, 120000, 50000, 330000]);
  });
  it('35 / 32.5 / 32.5 on ₹1,50,000 and must total 100%', () => {
    const s = splitProfit(15000000, defaultSettingsShares());
    expect(s.map((x) => x.amount)).toEqual([5250000, 4875000, 4875000]);
    expect(() => splitProfit(100, [{ name: 'X', pctBp: 9000 }])).toThrow(/100%/);
    expect(splitProfit(-500, defaultSettingsShares()).every((x) => x.amount === 0)).toBe(true);
    const odd = splitProfit(1001, defaultSettingsShares());
    expect(odd.reduce((a, b) => a + b.amount, 0)).toBe(1001);
  });
});
const defaultSettingsShares = () => S.defaultSettings().shares;

describe('L. access control', () => {
  it('callers cannot see certificates, fees, profit or ID docs, and only their own leads', () => {
    const m = defaultPermissions();
    for (const mod of ['certificates', 'fees', 'collections', 'profit', 'sensitive', 'dashboard', 'expenses'] as const) expect(can(m, 'caller', mod)).toBe(false);
    const caller = S.saveEmployee({ name: 'Cal', phone: '9700000000', email: '', role: 'caller', active: true });
    const mine = S.saveLead({ name: 'Mine', phone: '9111111111', assignedTo: caller });
    S.saveLead({ name: 'Other', phone: '9222222222' });
    S.login(caller);
    expect(S.visibleLeads(S.getDB()).map((l) => l.id)).toEqual([mine]);
    expect(() => S.issueCertificates([], 'x')).toThrow(/role does not allow/);
    expect(() => S.recordPayment({ key: uid(), studentId: 'x', amount: 1, date: T, method: 'Cash', reference: '', notes: '', verified: true })).toThrow(/role does not allow/);
  });
});

describe('O. financial close', () => {
  it('closed period blocks changes; reopening needs a documented reason; negative profit never approved', () => {
    const past = addDays(`${monthOf(T)}-01`, -1); // last day of previous month
    const id = admit('9876543210', { admissionDate: past });
    S.addExpense({ category: 'Office Rent', kind: 'fixed', description: 'Rent', amount: 99999900, date: past, method: 'Bank Transfer', notes: '' });
    S.closePeriod(monthOf(past));
    expect(() => pay(id, 100, { date: past })).toThrow(/closed financial period/);
    const dist = S.getDB().distributions[0];
    expect(dist.distributable).toBe(0);
    S.setDistributionStatus(dist.id, 'Under Review');
    expect(() => S.setDistributionStatus(dist.id, 'Approved')).toThrow(/No distributable profit/);
    expect(() => S.reopenPeriod(monthOf(past), 'oops')).toThrow(/documented reason/);
    S.reopenPeriod(monthOf(past), 'Late bank statement correction');
    pay(id, 100, { date: past });
  });
});

describe('I. certificate PDFs', () => {
  it('renders a PNG template to a 1-page PDF per student and merges for print', async () => {
    const { readFileSync } = await import('node:fs');
    const { certificatePdf, mergedPdf } = await import('./lib/certpdf');
    const { PDFDocument } = await import('pdf-lib');
    const data = `data:image/png;base64,${readFileSync('public/icon-512.png').toString('base64')}`;
    const tpl = { id: 't', name: 'T', fileType: 'image/png' as const, data, createdAt: '', fields: [{ key: 'name' as const, x: 0.5, y: 0.5, size: 40 }, { key: 'certId' as const, x: 0.5, y: 0.8, size: 20 }] };
    const cert = (id: string, name: string) => ({ id, studentId: '', templateId: 't', issuedAt: '', issuedBy: '', status: 'Issued' as const, history: [], data: { name, course: 'Stock Market Mastery', date: T, batch: 'B' } });
    const one = await PDFDocument.load(await certificatePdf(tpl, cert('CERT-1', 'Asha Rao')));
    expect(one.getPageCount()).toBe(1);
    expect(one.getPage(0).getWidth()).toBe(512); // native template resolution
    const merged = await PDFDocument.load(await mergedPdf([{ tpl, cert: cert('CERT-1', 'A') }, { tpl, cert: cert('CERT-2', 'B') }]));
    expect(merged.getPageCount()).toBe(2);
  });
});

describe('M. demo data is internally consistent', () => {
  it('loads through real actions; dashboard totals equal ledger sums', async () => {
    const { loadDemo } = await import('./lib/demo');
    loadDemo();
    const d = S.getDB();
    expect(d.students.length).toBe(72);
    const f = periodFigures(d, '2000-01-01', T, T);
    const ledger = d.payments.filter((p) => p.kind === 'payment' && p.verified).reduce((a, p) => a + p.amount, 0);
    expect(f.collected).toBe(ledger);
    const perStudent = d.students.reduce((a, s) => a + financeFor(d, s.id, T).paid, 0);
    expect(perStudent).toBe(ledger);
    expect(new Set(d.students.map((s) => s.phone)).size).toBe(d.students.length);
  });
});

describe('Automations are idempotent', () => {
  it('running twice creates no duplicate reminders', () => {
    const id = admit('9876543210', { bookingAmount: 0 });
    const inst = S.getDB().instalments.find((i) => i.studentId === id)!;
    S.overrideInstalment(inst.id, { dueDate: addDays(T, 1) }, 'test');
    const first = S.runAutomations(T);
    expect(first).toBeGreaterThan(0);
    expect(S.runAutomations(T)).toBe(0);
  });
});

describe('inWords (invoice amount in words)', () => {
  it('uses the Indian numbering system', async () => {
    const { inWords } = await import('./domain/util');
    expect(inWords(850000)).toBe('Rupees Eight Thousand Five Hundred Only');
    expect(inWords(12345678900)).toBe('Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only');
    expect(inWords(100050)).toBe('Rupees One Thousand and Fifty Paise Only');
    expect(inWords(0)).toBe('Rupees Zero Only');
  });
});

describe('fee follow-up calls', () => {
  it('"Promised to Pay" and "Needs More Time" need a date; the call is saved with it', () => {
    const id = admit();
    expect(() => S.logCall('student', id, 'Promised to Pay', '', undefined)).toThrow(/date/i);
    expect(() => S.logCall('student', id, 'Needs More Time', '', undefined)).toThrow(/date/i);
    S.logCall('student', id, 'Promised to Pay', 'UPI on Monday', addDays(T, 1));
    const c = S.getDB().calls.find((x) => x.entityId === id)!;
    expect(c).toMatchObject({ entity: 'student', outcome: 'Promised to Pay', nextFollowUp: addDays(T, 1) });
  });
  it('"Not Answered" / "Wrong Number" need no date, and past dates are refused', () => {
    const id = admit();
    expect(() => S.logCall('student', id, 'Not Answered', '')).not.toThrow();
    expect(() => S.logCall('student', id, 'Wrong Number', '')).not.toThrow();
    expect(() => S.logCall('student', id, 'Call Later', '', addDays(T, -1))).toThrow(/past/i);
  });
});

describe('student ID format', () => {
  it('IM + admission month + running serial', () => {
    const a = admit('9876500001', { admissionDate: '2026-11-03' });
    const b = admit('9876500002', { admissionDate: '2026-11-20' });
    const c = admit('9876500003', { admissionDate: '2026-12-01' });
    const code = (id: string) => S.getDB().students.find((s) => s.id === id)!.code;
    expect([code(a), code(b), code(c)]).toEqual(['IMNOV0001', 'IMNOV0002', 'IMDEC0003']);
  });
});

describe('courses', () => {
  const base = { name: 'Options Pro', bookingDefault: 100000, instalments: [400000, 400000], durationWeeks: 6, status: 'upcoming' as const };
  it('founder split must total 100% and names must be unique', () => {
    expect(() => S.saveCourse({ ...base, shares: [{ name: 'A', pctBp: 6000 }, { name: 'B', pctBp: 3000 }] })).toThrow(/100%/);
    const id = S.saveCourse({ ...base, shares: [{ name: 'A', pctBp: 6000 }, { name: 'B', pctBp: 4000 }] });
    expect(S.getDB().courses.find((c) => c.id === id)).toMatchObject({ status: 'upcoming', shares: [{ name: 'A', pctBp: 6000 }, { name: 'B', pctBp: 4000 }] });
    expect(() => S.saveCourse({ ...base, name: 'options pro' })).toThrow(/already exists/);
  });
  it('a course in use cannot be deleted', () => {
    admit();
    expect(() => S.deleteCourse(course())).toThrow(/Closed instead/);
  });
});

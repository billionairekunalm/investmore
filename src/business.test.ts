import { beforeEach, describe, expect, it } from 'vitest';
import * as S from './store/store';
import { buildSchedule } from './domain/fees';
import { splitProfit, periodFigures, financeFor, founderSplit, rebalanceShares } from './domain/finance';
import { checkImport, callingQueue } from './domain/leads';
import { normalizePhone, todayIST, addDays, uid, monthOf, batchTimes } from './domain/util';
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
  it('booking is always part of the course fee (no policy to choose)', () => {
    S.getDB().settings.bookingPolicy = null;
    const id = admit();
    const f = financeFor(S.getDB(), id, T);
    expect(f.total).toBe(850000);
    expect(f.lines[0]).toMatchObject({ label: 'Booking', amount: 100000 });
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
    expect(f.outstanding).toBe(550000); // no booking paid → its ₹1,000 sits in the last instalment, total stays ₹8,500
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

describe('booking smaller or bigger than the standard booking (additional rule)', () => {
  const sched = (booking: number) => buildSchedule({ booking, instalments: [300000, 300000, 150000], policy: 'additional', admissionDate: T, startDate: T, fullBooking: 100000 });
  it('₹500 booking: the missing ₹500 moves to the last instalment, total stays ₹8,500', () => {
    const s = sched(50000);
    expect(s.total).toBe(850000);
    expect(s.lines.map((l) => [l.label, l.amount])).toEqual([['Booking', 50000], ['Instalment 1', 300000], ['Instalment 2', 300000], ['Instalment 3', 200000]]);
  });
  it('₹1,500 booking: the extra comes off the last instalment, total stays ₹8,500', () => {
    const s = sched(150000);
    expect(s.total).toBe(850000);
    expect(s.lines.at(-1)).toMatchObject({ label: 'Instalment 3', amount: 100000 });
  });
  it('standard ₹1,000 booking is unchanged, and an admission keeps the course total', () => {
    expect(sched(100000).total).toBe(850000);
    const id = admit('9876511111', { bookingAmount: 50000 });
    expect(financeFor(S.getDB(), id, T).total).toBe(850000);
  });
});

describe('founder withdrawals', () => {
  it('records with a receipt number, validates, and can be deleted with a reason', () => {
    const founder = S.getDB().settings.shares[0].name;
    expect(() => S.addWithdrawal({ founder, amount: 0, date: T, forMonth: T.slice(0, 7), method: 'Cash', reference: '', notes: '' })).toThrow(/greater than zero/);
    expect(() => S.addWithdrawal({ founder, amount: 100000, date: T, forMonth: T.slice(0, 7), method: 'UPI', reference: '', notes: '' })).toThrow(/reference/i);
    expect(() => S.addWithdrawal({ founder: 'Nobody', amount: 100000, date: T, forMonth: T.slice(0, 7), method: 'Cash', reference: '', notes: '' })).toThrow(/founder/i);
    const id = S.addWithdrawal({ founder, amount: 2500000, date: T, forMonth: T.slice(0, 7), method: 'Cash', reference: '', notes: 'October profit' });
    expect(id).toMatch(/^WDR-\d{5}$/);
    expect(S.getDB().withdrawals[0]).toMatchObject({ id, founder, amount: 2500000 });
    expect(() => S.deleteWithdrawal(id, '')).toThrow(/reason/);
    S.deleteWithdrawal(id, 'entered twice');
    expect(S.getDB().withdrawals).toHaveLength(0);
  });
});

describe('founder split by course', () => {
  it('Forex Advance 45/27.5/27.5, other courses 35/32.5/32.5; net profit shared by each course\'s fees', () => {
    const forex = S.getDB().courses.find((c) => c.name === 'Forex Advance')!.id;
    pay(admit('9876500001'), 1000);
    pay(admit('9876500002', { courseId: forex }), 1000);
    const P = periodFigures(S.getDB(), T, T, T).netProfit;
    const out = founderSplit(S.getDB(), T, T, T);
    const by = (n: string) => out.find((f) => f.name === n)!;
    expect(out.reduce((a, f) => a + f.amount, 0)).toBe(P);
    expect(Math.abs(by('Bikram').amount - P * 0.4)).toBeLessThan(3); // (35% + 45%) / 2
    expect(Math.abs(by('Shekhar').amount - P * 0.3)).toBeLessThan(3);
    expect(by('Bikram').parts.map((p) => [p.course, p.pctBp])).toEqual(expect.arrayContaining([['Forex Advance', 4500], ['Stock Market Mastery', 3500]]));
  });
  it('renaming a founder in Settings carries the name to course splits and withdrawals', () => {
    const founder = S.getDB().settings.shares[0].name;
    S.addWithdrawal({ founder, amount: 1000, date: T, forMonth: T.slice(0, 7), method: 'Cash', reference: '', notes: '' });
    S.updateSettings({ shares: S.getDB().settings.shares.map((s, i) => (i ? s : { ...s, name: 'Bikram Singh' })) });
    expect(S.getDB().withdrawals[0].founder).toBe('Bikram Singh');
    expect(S.getDB().courses.find((c) => c.name === 'Forex Advance')!.shares![0].name).toBe('Bikram Singh');
  });
});

describe('IDs never repeat, even when the counter is lost', () => {
  it('student ID and receipt numbers continue after the highest existing one', () => {
    const a = admit('9876500011');
    pay(a, 500);
    const d = S.getDB();
    d.counters = {}; // e.g. synced from a device whose counter was empty
    const b = admit('9876500012');
    pay(b, 500);
    const codes = S.getDB().students.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    const receipts = S.getDB().payments.map((p) => p.receiptNo).filter(Boolean);
    expect(new Set(receipts).size).toBe(receipts.length);
    const txns = S.getDB().payments.map((p) => p.id);
    expect(new Set(txns).size).toBe(txns.length);
  });
});

describe('course fee includes the booking, and can be changed per student', () => {
  const amounts = (id: string) => financeFor(S.getDB(), id, T).lines.map((l) => l.amount);
  it('₹8,500 course: ₹1,000 booking + ₹3,000 + ₹3,000 + ₹1,500', () => {
    expect(S.courseFee(S.getDB().courses[0])).toBe(850000);
    const id = admit();
    expect(amounts(id)).toEqual([100000, 300000, 300000, 150000]);
  });
  it('more for this student (₹9,500): extra goes on the last instalment', () => {
    const id = admit('9876500021', { courseFee: 950000 });
    expect(financeFor(S.getDB(), id, T).total).toBe(950000);
    expect(amounts(id)).toEqual([100000, 300000, 300000, 250000]);
  });
  it('less for this student (₹6,000): the cut comes off the last instalments', () => {
    const id = admit('9876500022', { courseFee: 600000 });
    expect(financeFor(S.getDB(), id, T).total).toBe(600000);
    expect(amounts(id)).toEqual([100000, 300000, 200000]);
  });
  it('smaller booking with a changed fee still adds up to the fee', () => {
    const id = admit('9876500023', { courseFee: 800000, bookingAmount: 50000 });
    expect(financeFor(S.getDB(), id, T).total).toBe(800000);
    expect(amounts(id)[0]).toBe(50000);
  });
  it('booking more than the fee is refused', () => {
    expect(() => admit('9876500024', { courseFee: 50000, bookingAmount: 100000 })).toThrow(/more than the full course fee/);
  });
  it('editing a course fee: total = booking + instalments', () => {
    const c = S.getDB().courses[0];
    S.saveCourse({ ...c, bookingDefault: 100000, instalments: [400000, 400000, 100000] });
    expect(S.courseFee(S.getDB().courses[0])).toBe(1000000);
    const id = admit('9876500025');
    expect(financeFor(S.getDB(), id, T).total).toBe(1000000);
  });
});

describe('class schedule & per-class attendance', () => {
  const batch = () => S.saveBatch({ name: 'TA Batch 01', courseId: course(), teacherId: '', startDate: T, endDate: addDays(T, 60), schedule: 'Mon–Fri', timing: '17:00–18:00', capacity: 30, status: 'running' } as never);
  it('reads the usual class time from batch timing text', () => {
    expect(batchTimes('17:00–18:00')).toEqual(['17:00', '18:00']);
    expect(batchTimes('5:00-6:30 PM')).toEqual(['17:00', '18:30']);
    expect(batchTimes('Morning')).toEqual(['10:00', '11:00']);
  });
  it('schedules, refuses bad times and clashes, reschedules and cancels', () => {
    const b = S.getDB().batches[0]?.id ?? (batch(), S.getDB().batches[0].id);
    const id = S.saveClass({ batchId: b, date: addDays(T, 1), startTime: '17:00', endTime: '18:00', notes: '' });
    expect(() => S.saveClass({ batchId: b, date: addDays(T, 1), startTime: '18:00', endTime: '17:00', notes: '' })).toThrow(/after the start/);
    expect(() => S.saveClass({ batchId: b, date: addDays(T, 1), startTime: '17:30', endTime: '18:30', notes: '' })).toThrow(/already has a class/);
    S.saveClass({ id, batchId: b, date: addDays(T, 2), startTime: '16:00', endTime: '17:00', notes: 'moved' });
    expect(S.getDB().classes.find((c) => c.id === id)).toMatchObject({ date: addDays(T, 2), startTime: '16:00', notes: 'moved' });
    expect(() => S.setClassStatus(id, 'cancelled')).toThrow(/reason/);
    S.setClassStatus(id, 'cancelled', 'holiday');
    expect(S.getDB().classes.find((c) => c.id === id)!.status).toBe('cancelled');
  });
  it('one record per student per class, corrections logged, day record kept in step, old classes untouched', () => {
    batch(); const b = S.getDB().batches[0].id;
    const a = admit('9876500031', { batchId: b }), z = admit('9876500032', { batchId: b });
    const c1 = S.saveClass({ batchId: b, date: T, startTime: '09:00', endTime: '10:00', notes: '' });
    const c2 = S.saveClass({ batchId: b, date: addDays(T, 1), startTime: '09:00', endTime: '10:00', notes: '' });
    S.setMark(c1, a, 'present'); S.setMark(c1, a, 'present'); S.setMark(c1, z, 'absent');
    expect(S.getDB().marks.filter((m) => m.classId === c1)).toHaveLength(2);
    S.setMark(c1, z, 'present'); // correction
    expect(S.getDB().audit.find((x) => x.action === 'attendance.correct')?.detail).toMatch(/absent → present/);
    expect(S.getDB().attendance.find((x) => x.batchId === b && x.date === T)!.present.sort()).toEqual([a, z].sort());
    S.markRest(c2, [a, z], 'absent');
    expect(S.getDB().marks.filter((m) => m.classId === c1 && m.status === 'present')).toHaveLength(2); // class 1 not overwritten
    S.setMark(c1, a, null);
    expect(S.getDB().attendance.find((x) => x.batchId === b && x.date === T)!.present).toEqual([z]);
  });
});

describe('founder % always totals 100%', () => {
  it('Bikram 40% → Shekhar & Sanjeev 30% each; others keep Bikram fixed', () => {
    expect(rebalanceShares([3500, 3250, 3250], 0, 4000)).toEqual([4000, 3000, 3000]);
    expect(rebalanceShares([4500, 2750, 2750], 0, 3333)).toEqual([3333, 3333, 3334]);
    expect(rebalanceShares([4000, 3000, 3000], 1, 2000)).toEqual([4000, 2000, 4000]);
    expect(rebalanceShares([4000, 3000, 3000], 2, 9000)).toEqual([4000, 0, 6000]); // can't exceed 100%
  });
});

describe('batch lectures (YouTube)', () => {
  it('reads the video id from any YouTube link and refuses others / duplicates', () => {
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?si=x', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ', 'https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ'])
      expect(S.youtubeId(u)).toBe('dQw4w9WgXcQ');
    expect(S.youtubeId('https://example.com/video')).toBeNull();
    const b = S.saveBatch({ name: 'TA 01', courseId: course(), teacherId: '', startDate: T, endDate: addDays(T, 30), schedule: 'Mon', timing: '17:00–18:00', capacity: 30, status: 'running' } as never) ?? S.getDB().batches[0].id;
    const bid = S.getDB().batches[0].id;
    S.saveVideo({ batchId: bid, title: 'Lecture 1 — Candlesticks', url: 'https://youtu.be/dQw4w9WgXcQ', notes: '' });
    expect(S.getDB().videos[0]).toMatchObject({ batchId: bid, videoId: 'dQw4w9WgXcQ' });
    expect(() => S.saveVideo({ batchId: bid, title: 'Again', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', notes: '' })).toThrow(/already added/);
    expect(() => S.saveVideo({ batchId: bid, title: 'Bad', url: 'https://example.com', notes: '' })).toThrow(/YouTube/);
    void b;
  });
});

describe('delete a student', () => {
  it('needs a reason, removes their records, keeps the reason in the log', () => {
    const id = admit('9876500041');
    pay(id, 1000);
    expect(() => S.deleteStudent(id, ' ')).toThrow(/why/i);
    S.deleteStudent(id, 'Duplicate admission');
    const d = S.getDB();
    expect(d.students.some((s) => s.id === id)).toBe(false);
    expect(d.payments.some((p) => p.studentId === id) || d.instalments.some((i) => i.studentId === id) || d.feePlans.some((f) => f.studentId === id)).toBe(false);
    expect(d.audit.find((a) => a.action === 'student.delete')?.detail).toMatch(/Duplicate admission/);
  });
});

describe('employee delete', () => {
  it('unassigns their records, keeps their name on history, and protects self / last Super Admin', () => {
    const cal = S.saveEmployee({ name: 'Cal', phone: '9700000001', email: '', role: 'caller', active: true });
    const lead = S.saveLead({ name: 'L', phone: '9333333333', assignedTo: cal });
    S.deleteEmployee(cal);
    const d = S.getDB();
    expect(d.employees.some((e) => e.id === cal)).toBe(false);
    expect(d.leads.find((l) => l.id === lead)!.assignedTo).toBe('');
    expect(S.empName(cal)).toBe('Cal');
    expect(() => S.deleteEmployee(admin)).toThrow(/own account/);
  });
});

describe('move follow-up', () => {
  it('moves the date without logging a call, never into the past', () => {
    const id = S.saveLead({ name: 'Mover', phone: '9444444444' });
    S.moveFollowUp(id, addDays(todayIST(), 3));
    const l = S.getDB().leads.find((x) => x.id === id)!;
    expect(l.nextFollowUp).toBe(addDays(todayIST(), 3));
    expect(S.getDB().calls.some((c) => c.entityId === id)).toBe(false);
    expect(() => S.moveFollowUp(id, addDays(todayIST(), -1))).toThrow(/past/);
  });
});

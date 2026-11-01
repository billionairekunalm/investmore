import * as S from '../store/store';
import type { CallOutcome, LeadSource, PayMethod } from '../domain/types';
import { addDays, monthsBetween, todayIST, uid } from '../domain/util';

// Deterministic sample data built through the real store actions, so every business rule applies.
export function loadDemo() {
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const used = new Set(S.getDB().employees.map((e) => e.phone));
  const phone = () => { let p; do p = `${pick(['9', '8', '7'])}${String(int(100000000, 999999999))}`; while (used.has(p)); used.add(p); return p; };
  const today = todayIST();
  const first = ['Aarav', 'Vivaan', 'Aditya', 'Rohan', 'Kabir', 'Ishaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Kavya', 'Meera', 'Riya', 'Tanvi', 'Nikhil', 'Varun', 'Karan', 'Sneha', 'Pooja', 'Harsh', 'Manish', 'Deepak', 'Suresh', 'Lakshmi', 'Gaurav', 'Neel'];
  const last = ['Sharma', 'Verma', 'Patel', 'Gupta', 'Reddy', 'Iyer', 'Nair', 'Joshi', 'Mehta', 'Kulkarni', 'Singh', 'Rao', 'Desai', 'Chopra', 'Bhat', 'Pillai', 'Agarwal', 'Kapoor'];
  const name = () => `${pick(first)} ${pick(last)}`;

  const emp = (n: string, role: S.Role) => S.saveEmployee({ name: n, phone: phone(), email: `${n.split(' ')[0].toLowerCase()}@academy.demo`, role, active: true });
  emp('Shekhar (demo)', 'admin');
  emp('Sanjeev (demo)', 'admin');
  emp('Priya Accounts (demo)', 'accountant');
  emp('Rahul Manager (demo)', 'calling_manager');
  const callers = [emp('Neha Caller (demo)', 'caller'), emp('Amit Caller (demo)', 'caller'), emp('Pooja Caller (demo)', 'caller')];
  const teacher = emp('Vikram Teacher (demo)', 'teacher');

  const course = S.getDB().courses[0].id;
  const batches = [-165, -110, -55, -10, 12].map((off, i) => S.saveBatch({
    name: `${['Jun', 'Jul', 'Sep', 'Oct', 'Nov'][i]} ${i % 2 ? 'Evening' : 'Morning'} Batch`, courseId: course, teacherId: teacher,
    startDate: addDays(today, off), endDate: addDays(today, off + 56), schedule: i % 2 ? 'Mon–Fri' : 'Sat–Sun', timing: i % 2 ? '18:00–20:00' : '09:00–12:00',
    capacity: 25, status: off + 56 < 0 ? 'completed' : off > 0 ? 'upcoming' : 'running',
  }));

  // leads
  const sources: LeadSource[] = ['Meta Ads', 'Meta Ads', 'Instagram', 'Facebook', 'Website', 'Referral', 'Walk-in'];
  const leadIds: { id: string; created: string }[] = [];
  for (let i = 0; i < 80; i++) {
    const created = addDays(today, -int(0, 170));
    const id = S.saveLead({ name: name(), phone: phone(), source: pick(sources), campaign: pick(['Diwali Offer', 'Free Webinar', 'Options Basics', '']), assignedTo: pick(callers), interest: pick(['Low', 'Medium', 'High'] as const) });
    leadIds.push({ id, created });
  }
  const outcomes: CallOutcome[] = ['Connected', 'Not Answered', 'Busy', 'Interested', 'Call Later', 'Not Interested'];
  const callDates: Record<string, string> = {};
  for (const { id } of leadIds.slice(0, 60)) {
    const o = pick(outcomes);
    const fu = o === 'Call Later' || o === 'Interested' ? addDays(today, int(0, 4)) : undefined;
    S.logCall('lead', id, o, o === 'Interested' ? 'Asked about weekend batch' : o === 'Call Later' ? 'Busy at work, call in the evening' : '', fu);
    callDates[id] = addDays(today, -int(0, 6));
  }
  leadIds.slice(0, 8).forEach(({ id }) => S.setLeadStatus(id, 'Hot'));

  // students: some converted from leads, the rest walk-ins
  const methods: PayMethod[] = ['Cash', 'UPI', 'UPI', 'UPI', 'Bank Transfer', 'Card'];
  const students: string[] = [];
  for (let i = 0; i < 72; i++) {
    const b = i < 17 ? 0 : i < 34 ? 1 : i < 51 ? 2 : i < 66 ? 3 : 4;
    const batchStart = S.getDB().batches.find((x) => x.id === batches[b])!.startDate;
    const adm = addDays(batchStart, -int(0, 10));
    const admission = adm > today ? today : adm;
    const input = { key: uid(), courseId: course, batchId: batches[b], admissionDate: admission, counsellorId: pick(callers), bookingAmount: pick([50000, 100000, 100000]), bookingPaid: { method: 'Cash' as PayMethod, reference: '' } };
    const lead = i < 20 ? leadIds[60 + i] : null;
    const sid = lead
      ? S.convertLead(lead.id, input)
      : S.admitStudent({ ...input, name: name(), phone: phone(), source: pick(['Walk-in', 'Referral', 'Website']), city: pick(['Pune', 'Mumbai', 'Nagpur', 'Nashik']), state: 'Maharashtra' });
    students.push(sid);
    // pay instalments that are due; older batches pay more reliably
    const reliability = b < 2 ? 0.92 : 0.7;
    for (const inst of S.getDB().instalments.filter((x) => x.studentId === sid && x.seq > 0)) {
      if (inst.dueDate > today) break;
      const r = rnd();
      if (r > reliability) break; // stops paying → overdue
      const pd = addDays(inst.dueDate, int(-1, 3));
      const method = pick(methods);
      const amount = r > reliability - 0.08 ? inst.amount / 2 : inst.amount; // a few partial payments
      S.recordPayment({ key: uid(), studentId: sid, amount, date: pd > today ? today : pd, method, reference: method === 'Cash' ? '' : `UTR${int(10000000, 99999999)}`, notes: '', verified: true });
      if (amount < inst.amount) break;
    }
  }
  students.slice(0, 7).forEach((id) => S.setStudentStatus(id, 'Completed', 'Course finished'));
  S.setStudentStatus(students[12], 'Dropped', 'Relocated to another city');

  // expenses for the last 6 months
  for (const ym of monthsBetween(addDays(today, -165), today)) {
    const day = (n: number) => `${ym}-${String(n).padStart(2, '0')}`;
    const add = (category: string, kind: 'fixed' | 'variable', description: string, rupees: number, n: number, method: PayMethod = 'Bank Transfer') => {
      if (day(n) > today) return;
      S.addExpense({ category, kind, description, amount: rupees * 100, date: day(n), method, notes: '' });
    };
    add('Office Rent', 'fixed', 'Office rent', 18000, 1);
    add('Internet', 'fixed', 'Broadband', 1499, 3);
    add('Electricity', 'fixed', 'Electricity bill', int(2800, 4600), 8);
    add('Software Subscriptions', 'fixed', 'TradingView + Zoom', 2400, 5, 'Card');
    add('Fixed Salaries', 'fixed', 'Staff salaries', 38000, 28);
    add('Meta Ads', 'variable', 'Lead ads campaign', int(9000, 16000), 10, 'Card');
    if (rnd() > 0.5) add('Marketing', 'variable', 'Pamphlets & banners', int(1500, 6000), 15, 'UPI');
    if (rnd() > 0.6) add('Miscellaneous', 'variable', 'Tea, stationery', int(800, 2500), 20, 'Cash');
  }

  // back-date lead creation and call times so charts show history
  S.demoPatch((db) => {
    const created = new Map(leadIds.map((l) => [l.id, l.created]));
    for (const l of db.leads) {
      const c = created.get(l.id);
      if (!c) continue;
      l.createdAt = `${c}T10:00:00.000Z`;
      if (l.lastCallAt && callDates[l.id]) l.lastCallAt = `${callDates[l.id] < c ? c : callDates[l.id]}T11:30:00.000Z`;
    }
    for (const call of db.calls) {
      const l = db.leads.find((x) => x.id === call.entityId);
      if (l?.lastCallAt && callDates[call.entityId]) call.at = l.lastCallAt;
    }
  });
}

import type { DB, ISODate, Paise, PeriodFigures, Share, Expense } from './types';
import { effectivePayments, studentFinance } from './fees';
import { inRange } from './util';

export const expenseAmount = (e: Expense) => e.amount + e.adjustments.reduce((a, x) => a + x.delta, 0);

/**
 * Cash-basis period figures. Definitions used everywhere (dashboard, reports, distributions):
 *  collected  = verified payments dated in range − reversals dated in range (a reversal lands in the period it is made)
 *  refunds    = refunds dated in range
 *  gst        = GST contained in (collected − refunds), fees being GST-inclusive
 *  earned     = collected − refunds − gst
 *  expenses   = APPROVED expenses (incl. logged adjustments) dated in range
 *  netProfit  = earned − expenses
 *  billed     = fee plans created in range (total fee committed, NOT revenue)
 *  outstanding= current outstanding across non-refunded students (point-in-time, as of today)
 */
export function periodFigures(db: DB, from: ISODate, to: ISODate, today: ISODate): PeriodFigures {
  const range: [ISODate, ISODate] = [from, to];
  const byId = new Map(db.payments.map((p) => [p.id, p]));
  let collected = 0;
  for (const p of db.payments) {
    if (!inRange(p.date, range)) continue;
    if (p.kind === 'payment' && p.verified) collected += p.amount;
    if (p.kind === 'reversal' && byId.get(p.reversesId!)?.verified) collected -= p.amount;
  }
  const refunds = sum(db.payments.filter((p) => p.kind === 'refund' && inRange(p.date, range)).map((p) => p.amount));
  const net = collected - refunds;
  const gst = db.settings.gstRateBp > 0 ? Math.round((net * db.settings.gstRateBp) / (10000 + db.settings.gstRateBp)) : 0;
  const approved = db.expenses.filter((e) => e.status === 'Approved' && inRange(e.date, range));
  const fixedExpenses = sum(approved.filter((e) => e.kind === 'fixed').map(expenseAmount));
  const variableExpenses = sum(approved.filter((e) => e.kind === 'variable').map(expenseAmount));
  const totalExpenses = fixedExpenses + variableExpenses;
  const earned = net - gst;
  const billed = sum(db.feePlans.filter((f) => inRange(f.createdAt, range)).map((f) => f.total));
  return {
    from, to, billed, collected, refunds, gst, earned, fixedExpenses, variableExpenses, totalExpenses,
    netProfit: earned - totalExpenses, outstanding: totalOutstanding(db, today),
  };
}

export function totalOutstanding(db: DB, today: ISODate) {
  return sum(db.students.filter((s) => s.status !== 'Refunded' && s.status !== 'Dropped').map((s) => financeFor(db, s.id, today).outstanding));
}

export function financeFor(db: DB, studentId: string, today: ISODate) {
  const s = db.students.find((x) => x.id === studentId)!;
  return studentFinance(s, db.instalments.filter((i) => i.studentId === studentId), db.payments.filter((p) => p.studentId === studentId), today);
}

export const receivedFor = (db: DB, studentId: string) => sum(effectivePayments(db.payments.filter((p) => p.studentId === studentId)).map((p) => p.amount));

/**
 * Splits distributable profit by basis-point shares. Shares must total exactly 100%.
 * Rounding remainder (at most a few paise) goes to the first share so the split always sums exactly.
 * Non-positive profit yields zero payouts.
 */
export function splitProfit(distributable: Paise, shares: Share[]): (Share & { amount: Paise })[] {
  const totalBp = sum(shares.map((s) => s.pctBp));
  if (totalBp !== 10000) throw new Error(`Profit shares must total 100% (currently ${(totalBp / 100).toFixed(2)}%)`);
  if (distributable <= 0) return shares.map((s) => ({ ...s, amount: 0 }));
  const out = shares.map((s) => ({ ...s, amount: Math.floor((distributable * s.pctBp) / 10000) }));
  out[0].amount += distributable - sum(out.map((s) => s.amount));
  return out;
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

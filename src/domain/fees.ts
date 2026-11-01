import type { BookingPolicy, Instalment, InstalmentStatus, ISODate, Paise, Payment, Student } from './types';
import { addDays, daysBetween } from './util';

export interface ScheduleLine { seq: number; label: string; amount: Paise; dueDate: ISODate }

/**
 * Builds the fee schedule. seq 0 is the booking amount (due on admission).
 * 'additional': total = booking + all instalments.
 * 'credited'  : total = sum of instalments; booking is deducted from the LAST instalments first.
 * Instalment n is due startDate + n*gap (first is 7 days after the start event, then every 7 days).
 */
export function buildSchedule(opts: {
  booking: Paise; instalments: Paise[]; policy: BookingPolicy; admissionDate: ISODate; startDate: ISODate; gapDays?: number;
}): { total: Paise; lines: ScheduleLine[] } {
  const { booking, policy, admissionDate, startDate, gapDays = 7 } = opts;
  if (!Number.isInteger(booking) || booking < 0) throw new Error('Booking amount must be a non-negative whole paise value');
  const amounts = [...opts.instalments];
  if (policy === 'credited') {
    const base = amounts.reduce((a, b) => a + b, 0);
    if (booking > base) throw new Error('Booking amount cannot exceed the course fee when it is credited against it');
    let left = booking;
    for (let i = amounts.length - 1; i >= 0 && left > 0; i--) {
      const take = Math.min(left, amounts[i]);
      amounts[i] -= take; left -= take;
    }
  }
  const lines: ScheduleLine[] = [];
  if (booking > 0) lines.push({ seq: 0, label: 'Booking', amount: booking, dueDate: admissionDate });
  let n = 0;
  amounts.forEach((amt, i) => {
    n++; // due dates keep the 7-day rhythm even when an instalment is fully credited away
    if (amt > 0) lines.push({ seq: i + 1, label: `Instalment ${i + 1}`, amount: amt, dueDate: addDays(startDate, gapDays * n) });
  });
  return { total: lines.reduce((a, l) => a + l.amount, 0), lines };
}

/** A payment counts as received only if verified, of kind 'payment', and not reversed. */
export function effectivePayments(payments: Payment[]): Payment[] {
  const reversed = new Set(payments.filter((p) => p.kind === 'reversal').map((p) => p.reversesId));
  return payments.filter((p) => p.kind === 'payment' && p.verified && !reversed.has(p.id));
}

/** FIFO allocation of received money across a student's active instalments (by seq). Returns paid paise per instalment id. */
export function allocate(instalments: Instalment[], payments: Payment[]): Map<string, Paise> {
  const active = instalments.filter((i) => i.state === 'active').sort((a, b) => a.seq - b.seq);
  let pool = effectivePayments(payments).reduce((a, p) => a + p.amount, 0);
  const out = new Map<string, Paise>();
  for (const i of instalments) out.set(i.id, 0);
  for (const i of active) {
    const take = Math.min(pool, i.amount);
    out.set(i.id, take); pool -= take;
  }
  return out;
}

export function instalmentStatus(i: Instalment, paid: Paise, today: ISODate, studentStatus?: Student['status']): InstalmentStatus {
  if (i.state === 'waived') return 'Waived';
  if (i.state === 'cancelled') return studentStatus === 'Refunded' ? 'Refunded' : 'Cancelled';
  if (paid >= i.amount) return 'Paid';
  if (i.dueDate < today) return 'Overdue';
  if (paid > 0) return 'Partially Paid';
  if (daysBetween(today, i.dueDate) <= 2) return 'Due Soon';
  return 'Pending';
}

export interface InstalmentView extends Instalment { paid: Paise; remaining: Paise; status: InstalmentStatus }
export interface StudentFinance {
  total: Paise; paid: Paise; outstanding: Paise; refunded: Paise;
  lines: InstalmentView[]; next?: InstalmentView;
  status: 'Paid' | 'Partially Paid' | 'Pending' | 'Overdue' | 'Due Soon' | 'Refunded' | 'No Plan';
}

export function studentFinance(student: Student, instalments: Instalment[], payments: Payment[], today: ISODate): StudentFinance {
  const alloc = allocate(instalments, payments);
  const lines: InstalmentView[] = [...instalments].sort((a, b) => a.seq - b.seq).map((i) => {
    const paid = alloc.get(i.id) ?? 0;
    return { ...i, paid, remaining: i.state === 'active' ? i.amount - paid : 0, status: instalmentStatus(i, paid, today, student.status) };
  });
  const total = lines.filter((l) => l.state === 'active').reduce((a, l) => a + l.amount, 0);
  const paid = effectivePayments(payments).reduce((a, p) => a + p.amount, 0);
  const refunded = payments.filter((p) => p.kind === 'refund').reduce((a, p) => a + p.amount, 0);
  const outstanding = Math.max(0, total - paid);
  const next = lines.find((l) => l.remaining > 0);
  let status: StudentFinance['status'];
  if (student.status === 'Refunded') status = 'Refunded';
  else if (!lines.length) status = 'No Plan';
  else if (outstanding === 0) status = 'Paid';
  else if (lines.some((l) => l.status === 'Overdue')) status = 'Overdue';
  else if (next?.status === 'Due Soon') status = 'Due Soon';
  else if (paid > 0) status = 'Partially Paid';
  else status = 'Pending';
  return { total, paid, outstanding, refunded, lines, next, status };
}

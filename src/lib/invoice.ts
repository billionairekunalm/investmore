import { financeFor } from '../domain/finance';
import type { DB, Payment } from '../domain/types';
import { fmtDate, fmtINR, todayIST } from '../domain/util';

/** Paid / Provisional (not yet verified) / Void (reversed). */
export function invoiceStatus(db: DB, p: Payment): 'Paid' | 'Provisional' | 'Void' {
  if (db.payments.some((x) => x.reversesId === p.id)) return 'Void';
  return p.verified ? 'Paid' : 'Provisional';
}

/**
 * WhatsApp hand-off link with the invoice details (staff press send). The app runs on this device, so a link to the
 * invoice can't be opened by the student — attach the PDF from "Print / Save PDF" if they need the file.
 * ponytail: text hand-off; sending the PDF itself needs a WhatsApp Business API provider with the backend.
 */
export function invoiceWhatsApp(db: DB, p: Payment): string {
  const s = db.students.find((x) => x.id === p.studentId);
  if (!s) return '';
  const f = financeFor(db, s.id, todayIST());
  const status = invoiceStatus(db, p);
  const lines = [
    `Hello ${s.name},`,
    status === 'Void' ? `Invoice ${p.receiptNo} for ${fmtINR(p.amount)} has been cancelled.` : `Thank you for your payment to ${db.settings.academyName}.`,
    '',
    `Invoice no: ${p.receiptNo}`,
    `Date: ${fmtDate(p.date)}`,
    `Amount paid: ${fmtINR(p.amount)} (${p.method}${p.reference ? `, ref ${p.reference}` : ''})`,
    `Student ID: ${s.code}`,
    `Balance due: ${f.outstanding ? fmtINR(f.outstanding) : 'Nil — fully paid'}`,
    ...(f.next ? [`Next instalment: ${fmtINR(f.next.remaining)} on ${fmtDate(f.next.dueDate)}`] : []),
    ...(status === 'Provisional' ? ['', 'This payment is being verified; a final invoice will follow.'] : []),
  ];
  return `https://wa.me/91${s.phone}?text=${encodeURIComponent(lines.join('\n'))}`;
}

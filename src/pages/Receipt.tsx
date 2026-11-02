import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as S from '../store/store';
import { Button, DocBrand, DocWatermark, Empty } from '../ui/kit';
import { financeFor } from '../domain/finance';
import { allocate } from '../domain/fees';
import { fmtDate, fmtDateTime, fmtINR, fmtPhone, inWords, todayIST } from '../domain/util';
import { invoiceWhatsApp } from '../lib/invoice';

/** Fee invoice for one payment (route /receipt/:id). Print / Save PDF uses the browser's print dialog. */
export default function Receipt() {
  const { id } = useParams();
  const db = S.useDB();
  const p = db.payments.find((x) => x.id === id && x.kind === 'payment');
  if (!p) return <Empty title="Invoice not found" />;
  const s = db.students.find((x) => x.id === p.studentId)!;
  const reversed = db.payments.some((x) => x.reversesId === p.id);
  const f = financeFor(db, s.id, todayIST());
  const course = db.courses.find((c) => c.id === s.courseId);
  const batch = db.batches.find((b) => b.id === s.batchId);
  const inv = db.settings.invoice;

  // what this payment paid for: allocation with it minus allocation of everything received before it
  const mine = db.payments.filter((x) => x.studentId === s.id);
  const before = mine.filter((x) => x.id !== p.id && x.createdAt < p.createdAt);
  const inst = db.instalments.filter((i) => i.studentId === s.id);
  const a0 = allocate(inst, before), a1 = allocate(inst, [...before, { ...p, verified: true }]);
  const lines = inst.sort((x, y) => x.seq - y.seq).map((i) => ({ i, amt: (a1.get(i.id) ?? 0) - (a0.get(i.id) ?? 0) })).filter((l) => l.amt > 0);
  const excess = p.amount - lines.reduce((t, l) => t + l.amt, 0);

  const gst = db.settings.gstRateBp > 0 ? Math.round((p.amount * db.settings.gstRateBp) / (10000 + db.settings.gstRateBp)) : 0;
  const status = reversed ? { t: 'VOID', c: 'text-bad border-bad' } : !p.verified ? { t: 'PROVISIONAL', c: 'text-warn border-warn' } : { t: 'PAID', c: 'text-accent border-accent' };
  const wa = invoiceWhatsApp(db, p);

  return (
    <div className="min-h-full bg-surface print:bg-white py-6 sm:py-10 px-3 sm:px-4">
      <div className="max-w-3xl mx-auto mb-4 flex flex-wrap items-center justify-between gap-2 no-print">
        <Link to={`/students/${s.id}?tab=payments`} className="text-[12.5px] text-muted hover:text-ink">← {s.name}'s payments</Link>
        <div className="flex flex-wrap gap-2">
          <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center h-9 px-3.5 rounded-lg border border-zinc-300 bg-white font-medium hover:bg-surface">Send on WhatsApp</a>
          <Button variant="primary" onClick={() => window.print()}>Print / Save PDF</Button>
        </div>
      </div>

      <article className="relative max-w-3xl mx-auto bg-white border border-line rounded-2xl shadow-[0_8px_30px_-12px_rgba(15,35,65,.2)] overflow-hidden print:border-0 print:shadow-none print:rounded-none">
        <div className="h-2 bg-gradient-to-r from-navy via-[#173563] to-accent" />
        <DocWatermark />
        <div className="relative p-6 sm:p-10">
          {/* header */}
          <header className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <DocBrand />
              <div className="mt-3 text-[12.5px] text-zinc-600 leading-relaxed">
                {inv.address && <div>{inv.address}</div>}
                {(inv.phone || inv.email) && <div>{[inv.phone, inv.email].filter(Boolean).join(' · ')}</div>}
                {inv.gstin && <div className="font-medium text-zinc-700">GSTIN: {inv.gstin}</div>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[22px] font-bold tracking-tight text-navy">FEE INVOICE</div>
              <dl className="mt-2 text-[12.5px] grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 justify-end">
                <dt className="text-muted">Invoice no.</dt><dd className="font-semibold tabular">{p.receiptNo}</dd>
                <dt className="text-muted">Date</dt><dd className="tabular">{fmtDate(p.date)}</dd>
                <dt className="text-muted">Student ID</dt><dd className="tabular">{s.code}</dd>
              </dl>
              <div className={`mt-3 inline-block rotate-[-6deg] border-[3px] rounded-lg px-3 py-0.5 text-[18px] font-black tracking-[0.2em] opacity-85 ${status.c}`}>{status.t}</div>
            </div>
          </header>

          {reversed && <p className="mt-6 rounded-lg bg-bad-soft text-bad px-3 py-2 font-medium text-center">This payment was reversed — this invoice is void.</p>}
          {!p.verified && !reversed && <p className="mt-6 rounded-lg bg-warn-soft text-warn px-3 py-2 font-medium text-center">Provisional — the payment has not been verified yet.</p>}

          {/* parties */}
          <section className="mt-8 grid sm:grid-cols-2 gap-6 text-[13px]">
            <div>
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">Billed to</h2>
              <div className="font-semibold text-[15px] text-navy">{s.name}</div>
              <div className="text-zinc-600 mt-0.5">{fmtPhone(s.phone)}{s.email && ` · ${s.email}`}</div>
              {(s.address || s.city) && <div className="text-zinc-600">{[s.address, s.city, s.state, s.pin].filter(Boolean).join(', ')}</div>}
            </div>
            <div className="sm:text-right">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">Course</h2>
              <div className="font-semibold text-zinc-800">{course?.name ?? '—'}</div>
              <div className="text-zinc-600 mt-0.5">{batch ? `${batch.name} · ${batch.timing}` : 'Batch not assigned'}</div>
              <div className="text-zinc-600">Admitted {fmtDate(s.admissionDate)}</div>
            </div>
          </section>

          {/* line items */}
          <table className="mt-8 w-full text-[13px]">
            <thead>
              <tr className="border-y border-line bg-surface text-[11px] uppercase tracking-wider text-muted">
                <th className="text-left font-semibold px-3 py-2.5 w-10">#</th>
                <th className="text-left font-semibold px-3 py-2.5">Description</th>
                <th className="text-left font-semibold px-3 py-2.5 hidden sm:table-cell">Due date</th>
                <th className="text-right font-semibold px-3 py-2.5">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, n) => (
                <tr key={l.i.id} className="border-b border-line">
                  <td className="px-3 py-3 text-muted tabular">{n + 1}</td>
                  <td className="px-3 py-3"><div className="font-medium">{course?.name ?? 'Course'} — {l.i.label}</div>{l.amt < l.i.amount && <div className="text-xs text-muted">Part payment of {fmtINR(l.i.amount)}</div>}</td>
                  <td className="px-3 py-3 text-zinc-600 tabular hidden sm:table-cell">{fmtDate(l.i.dueDate)}</td>
                  <td className="px-3 py-3 text-right tabular font-medium">{fmtINR(l.amt)}</td>
                </tr>
              ))}
              {excess > 0 && (
                <tr className="border-b border-line">
                  <td className="px-3 py-3 text-muted tabular">{lines.length + 1}</td>
                  <td className="px-3 py-3 font-medium" colSpan={2}>{lines.length ? 'Advance / excess payment' : `${course?.name ?? 'Course'} — fee payment`}</td>
                  <td className="px-3 py-3 text-right tabular font-medium">{fmtINR(excess)}</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* totals */}
          <div className="mt-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
            <div className="text-[12.5px] max-w-sm">
              <div className="text-muted">Amount in words</div>
              <div className="font-medium text-zinc-800 mt-0.5">{inWords(p.amount)}</div>
            </div>
            <dl className="w-full sm:w-72 text-[13px] space-y-1.5">
              {gst > 0 && <>
                <Tot k="Taxable value" v={fmtINR(p.amount - gst)} />
                <Tot k={`GST @ ${db.settings.gstRateBp / 100}% (included)`} v={fmtINR(gst)} />
              </>}
              <div className="flex justify-between border-t-2 border-navy pt-2 mt-2"><dt className="font-bold text-navy">Total paid</dt><dd className="font-bold text-navy text-[17px] tabular">{fmtINR(p.amount)}</dd></div>
            </dl>
          </div>

          {/* payment + fee summary */}
          <section className="mt-8 grid sm:grid-cols-2 gap-4 text-[12.5px]">
            <div className="rounded-xl border border-line p-4">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted mb-2">Payment details</h2>
              <dl className="space-y-1.5">
                <Tot k="Method" v={p.method} />
                {p.reference && <Tot k="Reference / UTR" v={p.reference} />}
                <Tot k="Transaction ID" v={<span className="break-all tabular">{p.id}</span>} />
                <Tot k="Received by" v={S.empName(p.receivedBy, db)} />
              </dl>
            </div>
            <div className="rounded-xl border border-line bg-surface/60 p-4">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted mb-2">Fee summary (as of today)</h2>
              <dl className="space-y-1.5">
                <Tot k="Total course fee" v={fmtINR(f.total)} />
                <Tot k="Paid to date" v={<span className="text-accent font-semibold">{fmtINR(f.paid)}</span>} />
                {f.refunded > 0 && <Tot k="Refunded" v={fmtINR(f.refunded)} />}
                <Tot k="Balance due" v={<span className={f.outstanding ? 'text-warn font-semibold' : 'text-accent font-semibold'}>{f.outstanding ? fmtINR(f.outstanding) : 'Nil — fully paid'}</span>} />
                {f.next && <Tot k="Next instalment" v={`${fmtINR(f.next.remaining)} on ${fmtDate(f.next.dueDate)}`} />}
              </dl>
            </div>
          </section>

          <footer className="mt-10 pt-4 border-t border-line flex flex-wrap items-end justify-between gap-4 text-[11.5px] text-muted">
            <div className="max-w-md">
              {inv.note && <p className="text-zinc-600 mb-1">{inv.note}</p>}
              <p>This is a computer-generated invoice and does not require a signature. Generated {fmtDateTime(new Date().toISOString())}.</p>
            </div>
            <div className="text-right font-semibold text-navy text-[13px]">Thank you for learning with {db.settings.academyName}!</div>
          </footer>
        </div>
      </article>
    </div>
  );
}
const Tot = ({ k, v }: { k: string; v: ReactNode }) => <div className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right font-medium text-zinc-800">{v}</dd></div>;

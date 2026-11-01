import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as S from '../store/store';
import { Button, Empty, LogoMark, Wordmark } from '../ui/kit';
import { fmtDate, fmtDateTime, fmtINR, inWords } from '../domain/util';

const longMonth = (ym: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));

/** Printable receipt for a founder withdrawal (route /withdrawal/:id). */
export default function WithdrawalReceipt() {
  const { id } = useParams();
  const db = S.useDB();
  const w = db.withdrawals.find((x) => x.id === id);
  if (!w) return <Empty title="Receipt not found" body="It may have been deleted." />;
  const inv = db.settings.invoice;
  const share = db.settings.shares.find((s) => s.name === w.founder);

  return (
    <div className="min-h-full bg-surface print:bg-white py-6 sm:py-10 px-3 sm:px-4">
      <div className="max-w-2xl mx-auto mb-4 flex flex-wrap items-center justify-between gap-2 no-print">
        <Link to="/profit" className="text-[12.5px] text-muted hover:text-ink">← Salary & Profit</Link>
        <Button variant="primary" onClick={() => window.print()}>Print / Save PDF</Button>
      </div>
      <article className="max-w-2xl mx-auto bg-white border border-line rounded-2xl shadow-[0_8px_30px_-12px_rgba(15,35,65,.2)] overflow-hidden print:border-0 print:shadow-none print:rounded-none">
        <div className="h-2 bg-gradient-to-r from-navy via-[#173563] to-accent" />
        <div className="p-6 sm:p-10">
          <header className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-2.5"><LogoMark className="size-10" /><Wordmark name={db.settings.academyName} className="text-[18px]" /></div>
              <div className="mt-3 text-[12.5px] text-zinc-600 leading-relaxed">
                {inv.address && <div>{inv.address}</div>}
                {(inv.phone || inv.email) && <div>{[inv.phone, inv.email].filter(Boolean).join(' · ')}</div>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[20px] font-bold tracking-tight text-navy">WITHDRAWAL RECEIPT</div>
              <dl className="mt-2 text-[12.5px] grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 justify-end">
                <dt className="text-muted">Receipt no.</dt><dd className="font-semibold tabular">{w.id}</dd>
                <dt className="text-muted">Date</dt><dd className="tabular">{fmtDate(w.date)}</dd>
              </dl>
            </div>
          </header>

          <p className="mt-8 text-[14px] leading-relaxed text-zinc-700">
            Received from <b className="text-ink">{db.settings.academyName}</b> the sum of <b className="text-ink">{fmtINR(w.amount)}</b> by <b className="text-ink">{w.founder}</b>{share && <> (founder, {share.pctBp / 100}% share)</>} as a withdrawal from the profit of <b className="text-ink">{longMonth(w.forMonth)}</b>.
          </p>

          <div className="mt-6 rounded-xl border border-line bg-surface/60 p-5 flex flex-wrap items-end justify-between gap-4">
            <div><div className="text-[11px] font-bold uppercase tracking-wider text-muted">Amount</div><div className="text-[30px] font-bold tabular text-navy leading-tight">{fmtINR(w.amount)}</div></div>
            <div className="text-[12.5px] max-w-xs text-right"><div className="text-muted">In words</div><div className="font-medium text-zinc-800">{inWords(w.amount)}</div></div>
          </div>

          <dl className="mt-6 grid sm:grid-cols-2 gap-x-8 gap-y-2 text-[13px]">
            <Row k="Founder" v={w.founder} />
            <Row k="Profit of" v={longMonth(w.forMonth)} />
            <Row k="Paid by" v={w.method} />
            {w.reference && <Row k="Reference / UTR" v={w.reference} />}
            <Row k="Recorded by" v={S.empName(w.by, db)} />
            {w.notes && <Row k="Note" v={w.notes} />}
          </dl>

          <div className="mt-14 grid grid-cols-2 gap-10 text-[12.5px] text-zinc-600">
            <div><div className="border-t border-zinc-400 pt-1.5">Received by — {w.founder}</div></div>
            <div className="text-right"><div className="border-t border-zinc-400 pt-1.5">Paid by — {db.settings.academyName}</div></div>
          </div>
          <p className="mt-8 text-[11.5px] text-muted">Generated {fmtDateTime(new Date().toISOString())}.</p>
        </div>
      </article>
    </div>
  );
}
const Row = ({ k, v }: { k: string; v: ReactNode }) => <div className="flex justify-between gap-3 border-b border-line py-1.5"><dt className="text-muted">{k}</dt><dd className="font-medium text-right">{v}</dd></div>;

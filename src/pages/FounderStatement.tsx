import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as S from '../store/store';
import { Button, DocBrand, DocWatermark, Empty } from '../ui/kit';
import { founderSplit } from '../domain/finance';
import { fmtDate, fmtDateTime, fmtINR, fmtMonth, inRange, inWords, todayIST } from '../domain/util';

/** Printable founder statement for a period (route /founder-statement?name=&from=&to=): shares by course and money received. */
export default function FounderStatement() {
  const [sp] = useSearchParams();
  const db = S.useDB();
  const name = sp.get('name') ?? '', from = sp.get('from') ?? '', to = sp.get('to') ?? '';
  const label = sp.get('label') ?? '';
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return <Empty title="Statement not found" />;
  const f = founderSplit(db, from, to, todayIST()).find((x) => x.name === name);
  if (!f) return <Empty title="Founder not found" />;
  const paid = db.withdrawals.filter((w) => w.founder === name && inRange(w.date, [from, to])).sort((a, b) => a.date.localeCompare(b.date));
  const got = paid.reduce((t, w) => t + w.amount, 0);
  const balance = Math.max(0, f.amount - got);
  const inv = db.settings.invoice;

  return (
    <div className="min-h-full bg-surface print:bg-white py-6 sm:py-10 px-3 sm:px-4">
      <div className="max-w-3xl mx-auto mb-4 flex flex-wrap items-center justify-between gap-2 no-print">
        <Link to="/profit" className="text-[12.5px] text-muted hover:text-ink">← Salary & Profit</Link>
        <Button variant="primary" onClick={() => window.print()}>Print / Save PDF</Button>
      </div>
      <article className="relative max-w-3xl mx-auto bg-white border border-line rounded-2xl shadow-[0_8px_30px_-12px_rgba(15,35,65,.2)] overflow-hidden print:border-0 print:shadow-none print:rounded-none">
        <div className="h-2 bg-gradient-to-r from-navy via-[#173563] to-accent" />
        <DocWatermark />
        <div className="relative p-6 sm:p-10">
          <header className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <DocBrand />
              <div className="mt-3 text-[12.5px] text-zinc-600 leading-relaxed">
                {inv.address && <div>{inv.address}</div>}
                {(inv.phone || inv.email) && <div>{[inv.phone, inv.email].filter(Boolean).join(' · ')}</div>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[20px] font-bold tracking-tight text-navy">FOUNDER STATEMENT</div>
              <dl className="mt-2 text-[12.5px] grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 justify-end">
                <dt className="text-muted">Founder</dt><dd className="font-semibold">{name}</dd>
                <dt className="text-muted">Period</dt><dd className="tabular">{fmtDate(from)} – {fmtDate(to)}</dd>
                {label && <><dt className="text-muted">Filter</dt><dd>{label}</dd></>}
                <dt className="text-muted">Date</dt><dd className="tabular">{fmtDate(todayIST())}</dd>
              </dl>
            </div>
          </header>

          <div className="mt-8 grid grid-cols-3 gap-3">
            <Tile k="Share of profit" v={fmtINR(f.amount)} />
            <Tile k="Received" v={fmtINR(got)} tone="text-accent" />
            <Tile k="Balance to receive" v={fmtINR(balance)} tone="text-navy" />
          </div>

          <h2 className="mt-8 mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Share by course</h2>
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted"><th className="text-left font-semibold py-2">Course</th><th className="text-right font-semibold">Course profit</th><th className="text-right font-semibold">Share %</th><th className="text-right font-semibold">Amount</th></tr></thead>
            <tbody>
              {f.parts.map((p) => <tr key={p.course} className="border-b border-line"><td className="py-2 font-medium">{p.course}</td><td className="text-right tabular">{fmtINR(p.profit)}</td><td className="text-right tabular">{p.pctBp / 100}%</td><td className="text-right tabular font-semibold">{fmtINR(p.amount)}</td></tr>)}
              <tr><td colSpan={3} className="py-2 text-right font-semibold">Total share</td><td className="text-right tabular font-bold">{fmtINR(f.amount)}</td></tr>
            </tbody>
          </table>

          <h2 className="mt-8 mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Payments received</h2>
          {!paid.length ? <p className="text-[13px] text-muted py-2">No payments in this period.</p> : (
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted"><th className="text-left font-semibold py-2">Date</th><th className="text-left font-semibold">Receipt no.</th><th className="text-left font-semibold">Profit of</th><th className="text-left font-semibold">Paid by</th><th className="text-right font-semibold">Amount</th></tr></thead>
              <tbody>
                {paid.map((w) => <tr key={w.id} className="border-b border-line"><td className="py-2 tabular">{fmtDate(w.date)}</td><td className="tabular">{w.id}</td><td>{fmtMonth(w.forMonth)}</td><td>{w.method}{w.reference ? <span className="text-muted"> · {w.reference}</span> : null}</td><td className="text-right tabular font-semibold">{fmtINR(w.amount)}</td></tr>)}
                <tr><td colSpan={4} className="py-2 text-right font-semibold">Total received</td><td className="text-right tabular font-bold">{fmtINR(got)}</td></tr>
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[12.5px] text-zinc-600">In words: <span className="font-medium text-zinc-800">{inWords(got)}</span></p>

          <div className="mt-14 grid grid-cols-2 gap-10 text-[12.5px] text-zinc-600">
            <div><div className="border-t border-zinc-400 pt-1.5">Received by — {name}</div></div>
            <div className="text-right"><div className="border-t border-zinc-400 pt-1.5">For — {db.settings.academyName}</div></div>
          </div>
          <p className="mt-8 text-[11.5px] text-muted">Generated {fmtDateTime(new Date().toISOString())}. Share is worked out from the net profit of the period, course by course.</p>
        </div>
      </article>
    </div>
  );
}
const Tile = ({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) => (
  <div className="rounded-xl border border-line bg-surface/60 px-4 py-3"><div className="text-[10.5px] font-bold uppercase tracking-wider text-muted">{k}</div><div className={`text-[20px] font-bold tabular ${tone ?? 'text-ink'}`}>{v}</div></div>
);

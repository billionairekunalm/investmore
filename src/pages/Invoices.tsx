import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Card, Empty, PageHeader, SearchInput, Select, Table } from '../ui/kit';
import { useRange } from '../ui/shell';
import { invoiceStatus, invoiceWhatsApp } from '../lib/invoice';
import type { Payment } from '../domain/types';
import { fmtDate, fmtINR, fmtPhone, inRange } from '../domain/util';

const TONE = { Paid: 'green', Provisional: 'orange', Void: 'red' } as const;
const WA = 'M8 1.8a6.2 6.2 0 0 0-5.3 9.4L1.8 14.2l3.1-.9A6.2 6.2 0 1 0 8 1.8Zm3.2 8.6c-.1.4-.8.8-1.1.8-.3.1-.7.1-1.1 0-.3-.1-.6-.2-1-.4A7.3 7.3 0 0 1 5 7.6c-.3-.4-.5-.9-.5-1.4 0-.5.3-.8.4-.9.1-.1.3-.2.4-.2h.3c.1 0 .2 0 .4.3l.5 1.2v.3l-.2.3-.3.3c-.1.1-.2.2-.1.4.2.3.5.8.9 1.1.5.4.9.6 1.1.7.2.1.3.1.4 0l.5-.6c.1-.2.3-.1.4-.1l1.1.5c.2.1.3.1.3.2.1.1.1.4 0 .7Z';

/** All fee invoices (one per payment). Follows the global date range. */
export default function Invoices() {
  const db = S.useDB();
  const { key, range } = useRange();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const all = useMemo(() => db.payments.filter((p) => p.kind === 'payment').sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [db]);
  const t = q.trim().toLowerCase(), digits = t.replace(/\D/g, '');
  const shown = all.filter((p) => {
    if (!inRange(p.date, range)) return false;
    if (status && invoiceStatus(db, p) !== status) return false;
    if (!t) return true;
    const s = db.students.find((x) => x.id === p.studentId);
    return p.receiptNo.toLowerCase().includes(t) || !!s && (s.name.toLowerCase().includes(t) || s.code.toLowerCase().includes(t) || (digits.length > 2 && s.phone.includes(digits)));
  });
  const total = shown.filter((p) => invoiceStatus(db, p) !== 'Void').reduce((a, p) => a + p.amount, 0);
  return (
    <>
      <PageHeader title="Invoices" sub={`${shown.length} invoices · ${fmtINR(total)} · ${key === 'all' ? 'all time' : `${fmtDate(range[0])} – ${fmtDate(range[1])}`}`} />
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 rounded-xl border border-line bg-surface p-3 sm:p-4 mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Invoice no, student name, ID or mobile" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Any status" options={['Paid', 'Provisional', 'Void']} />
      </div>
      <Card className="overflow-hidden">
        <InvoiceTable rows={shown} showStudent empty={all.length ? 'No invoices match — try a wider date range at the top' : 'No invoices yet — they appear when a fee payment is recorded'} />
      </Card>
    </>
  );
}

/** Invoice list with View · WhatsApp actions. Used on the Invoices page and the student profile. */
export function InvoiceTable({ rows, showStudent, empty }: { rows: Payment[]; showStudent?: boolean; empty: string }) {
  const db = S.useDB();
  const stu = (p: Payment) => db.students.find((x) => x.id === p.studentId);
  return (
    <Table rows={rows} rowKey={(p) => p.id} pageSize={50} empty={<Empty title={empty} />}
      className="[&_td]:py-3"
      cols={[
        { key: 'no', label: 'Invoice no.', sort: (p) => p.receiptNo, render: (p) => <Link to={`/receipt/${p.id}`} target="_blank" className="font-semibold text-navy tabular hover:underline">{p.receiptNo}</Link> },
        { key: 'd', label: 'Date', sort: (p) => p.date, render: (p) => <span className="tabular">{fmtDate(p.date)}</span> },
        ...(showStudent ? [{ key: 's', label: 'Student', sort: (p: Payment) => stu(p)?.name ?? '', render: (p: Payment) => {
          const s = stu(p);
          return s ? <Link to={`/students/${s.id}`} className="block leading-tight hover:text-accent"><div className="font-medium">{s.name}</div><div className="text-[11.5px] text-muted tabular">{s.code} · {fmtPhone(s.phone)}</div></Link> : '—';
        } }] : []),
        { key: 'a', label: 'Amount', className: 'text-right', sort: (p) => p.amount, render: (p) => <span className={invoiceStatus(db, p) === 'Void' ? 'line-through text-muted tabular' : 'font-semibold tabular'}>{fmtINR(p.amount)}</span> },
        { key: 'm', label: 'Method', render: (p) => <span className="text-zinc-600">{p.method}</span> },
        { key: 'st', label: 'Status', sort: (p) => invoiceStatus(db, p), render: (p) => { const st = invoiceStatus(db, p); return <Badge tone={TONE[st]}>{st}</Badge>; } },
        { key: 'x', label: '', className: 'text-right', render: (p) => (
          <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Link to={`/receipt/${p.id}`} target="_blank" className="inline-flex items-center h-8 px-3 rounded-lg border border-zinc-300 bg-white text-[12.5px] font-medium hover:bg-surface">View / Print</Link>
            <a href={invoiceWhatsApp(db, p)} target="_blank" rel="noreferrer" title="Send on WhatsApp" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#25D366] text-white text-[12.5px] font-semibold hover:bg-[#1ebe5b]">
              <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor"><path d={WA} /></svg>WhatsApp
            </a>
          </div>
        ) },
      ]} />
  );
}

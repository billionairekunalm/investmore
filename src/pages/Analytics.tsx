import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as S from '../store/store';
import { Card, Empty } from '../ui/kit';
import { effectivePayments } from '../domain/fees';
import { expenseAmount, financeFor } from '../domain/finance';
import { PAY_METHODS, STUDENT_STATUSES, type DB } from '../domain/types';
import { fmtINR, fmtINRShort, inRange, todayIST } from '../domain/util';

// Categorical palette, fixed order, validated for colour-blind separation (dataviz skill validator, light mode).
// Three slots are under 3:1 on white, so every chart carries visible labels/values.
// brand order: charcoal, logo green, lime, sand, stone, deep green, peach
const SLOT = ['#181818', '#05b200', '#9ee27f', '#d9b35a', '#a8a69c', '#005d00', '#ef9a6a'];
const GOOD = '#008300', WARN = '#eda100', BAD = '#e34948';
const axis = { fontSize: 11, fill: '#71717a' };
const tip = { contentStyle: { borderRadius: 14, border: 'none', background: '#151715', color: '#fff', fontSize: 12, boxShadow: '0 10px 24px rgba(0,0,0,.18)' }, itemStyle: { color: '#fff' }, labelStyle: { color: '#b6f09c', fontWeight: 600 } };

type Slice = { name: string; value: number; color: string };

/** Visual analytics for the Reports page. Everything follows the global date range except the "as of today" snapshots. */
export function VisualAnalytics({ range }: { range: [string, string] }) {
  const db = S.useDB();
  const can = (m: Parameters<typeof S.allowed>[0]) => S.allowed(m, 'view', db);
  const a = useMemo(() => build(db, range), [db, range[0], range[1]]);

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {can('fees') && (
        <ChartCard title="Fee collection status" sub="All current fee plans · as of today" link="/collections?view=overdue">
          <Donut data={a.feeStatus} money center="Total billed" />
        </ChartCard>
      )}
      {can('fees') && (
        <ChartCard title="Collections by payment method" sub="Verified payments in the selected period" link="/invoices">
          <Donut data={a.byMethod} money center="Collected" empty="No payments in this period" />
        </ChartCard>
      )}
      {can('students') && (
        <ChartCard title="Students by status" sub="All students · as of today" link="/students">
          <Donut data={a.byStatus} center="Students" />
        </ChartCard>
      )}
      {can('leads') && (
        <ChartCard title="Lead sources & conversion" sub="Leads created in the selected period" link="/leads">
          <HBars data={a.sources} valueLabel={(d) => `${d.value} · ${d.note}`} empty="No leads in this period" />
        </ChartCard>
      )}
      {can('expenses') && (
        <ChartCard title="Expenses by category" sub="Approved expenses in the selected period" link="/expenses">
          <HBars data={a.expenses} money empty="No approved expenses in this period" />
        </ChartCard>
      )}
      {can('batches') && can('fees') && (
        <ChartCard title="Fee collection by batch" sub="Share of each batch's billed fees collected so far" link="/batches">
          <HBars data={a.batches} pctScale valueLabel={(d) => `${d.value}% · ${d.note}`} empty="No batches yet" />
        </ChartCard>
      )}
    </div>
  );
}

function build(db: DB, range: [string, string]) {
  const today = todayIST();
  const live = db.students.filter((s) => s.status !== 'Refunded' && s.status !== 'Dropped');
  let paid = 0, pending = 0, overdue = 0;
  for (const s of live) for (const l of financeFor(db, s.id, today).lines) { paid += l.paid; if (l.status === 'Overdue') overdue += l.remaining; else pending += l.remaining; }

  const pays = effectivePayments(db.payments).filter((p) => inRange(p.date, range));
  const byMethod = PAY_METHODS.map((m, i) => ({ name: m, value: pays.filter((p) => p.method === m).reduce((t, p) => t + p.amount, 0), color: SLOT[i] }));

  const statusColor: Record<string, string> = { Active: SLOT[0], Completed: SLOT[2], Inactive: SLOT[3], Dropped: SLOT[1], Refunded: SLOT[4] };
  const byStatus = STUDENT_STATUSES.map((st) => ({ name: st, value: db.students.filter((s) => s.status === st).length, color: statusColor[st] }));

  const leads = db.leads.filter((l) => inRange(l.createdAt, range));
  const sources = [...new Set(leads.map((l) => l.source))].map((src) => {
    const x = leads.filter((l) => l.source === src), c = x.filter((l) => l.status === 'Converted').length;
    return { name: src, value: x.length, note: `${x.length ? Math.round((c / x.length) * 100) : 0}% converted` };
  }).sort((p, q) => q.value - p.value);

  const exp = new Map<string, number>();
  for (const e of db.expenses) if (e.status === 'Approved' && inRange(e.date, range)) exp.set(e.category, (exp.get(e.category) ?? 0) + expenseAmount(e));
  let expenses = [...exp].map(([name, value]) => ({ name, value, note: '' })).sort((p, q) => q.value - p.value);
  if (expenses.length > 7) expenses = [...expenses.slice(0, 6), { name: 'Other', value: expenses.slice(6).reduce((t, e) => t + e.value, 0), note: '' }];

  const batches = db.batches.filter((b) => b.status !== 'cancelled').map((b) => {
    const fs = db.students.filter((s) => s.batchId === b.id && s.status !== 'Refunded' && s.status !== 'Dropped').map((s) => financeFor(db, s.id, today));
    const billed = fs.reduce((t, f) => t + f.total, 0), got = fs.reduce((t, f) => t + f.paid, 0);
    return { name: b.name, value: billed ? Math.round((got / billed) * 100) : 0, note: `${fs.length} students` };
  }).filter((b) => b.note !== '0 students').sort((p, q) => q.value - p.value);

  return {
    feeStatus: [{ name: 'Collected', value: paid, color: GOOD }, { name: 'Pending (not yet due)', value: pending, color: WARN }, { name: 'Overdue', value: overdue, color: BAD }] as Slice[],
    byMethod: byMethod as Slice[], byStatus: byStatus as Slice[], sources, expenses, batches,
  };
}

function ChartCard({ title, sub, link, className, children }: { title: string; sub: string; link?: string; className?: string; children: ReactNode }) {
  return (
    <Card className={`@container overflow-hidden shadow-[0_1px_3px_rgba(15,35,65,.05)] ${className ?? ''}`}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div><h3 className="font-semibold text-[14px] text-navy">{title}</h3><p className="text-xs text-muted mt-0.5">{sub}</p></div>
        {link && <Link to={link} className="text-[12px] font-medium text-accent hover:underline whitespace-nowrap">View →</Link>}
      </div>
      {children}
    </Card>
  );
}

/** Donut + legend list with value and share (identity never by colour alone). */
function Donut({ data, money, center, empty = 'No data yet' }: { data: Slice[]; money?: boolean; center: string; empty?: string }) {
  const total = data.reduce((t, d) => t + d.value, 0);
  const fmt = (v: number) => (money ? fmtINR(v) : v.toLocaleString('en-IN'));
  if (!total) return <Empty title={empty} />;
  const shown = data.filter((d) => d.value > 0);
  return (
    // doughnut above the legend in narrow cards, side by side when the card is wide enough for full amounts
    <div className="flex flex-col @[520px]:flex-row items-center gap-4 px-4 pb-5">
      <div className="relative w-44 h-44 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={shown} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="96%" paddingAngle={shown.length > 1 ? 2 : 0} stroke="#fff" strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={false}>
              {shown.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip {...tip} formatter={(v: number, n: string) => [`${fmt(v)} · ${Math.round((v / total) * 100)}%`, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div><div className="text-[10.5px] uppercase tracking-wider text-muted font-semibold">{center}</div><div className="font-bold text-navy tabular text-[15px] leading-tight">{money ? fmtINRShort(total) : total}</div></div>
        </div>
      </div>
      <ul className="flex-1 w-full space-y-2">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2.5 text-[13px]">
            <span className="size-2.5 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="flex-1 min-w-0 text-zinc-700">{d.name}</span>
            <span className="font-semibold tabular text-zinc-900 whitespace-nowrap">{fmt(d.value)}</span>
            <span className="w-10 text-right text-xs text-muted tabular">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars with the value written at the end of each bar. */
function HBars({ data, money, pctScale, valueLabel, empty }: { data: { name: string; value: number; note: string }[]; money?: boolean; pctScale?: boolean; valueLabel?: (d: { value: number; note: string }) => string; empty: string }) {
  if (!data.length || data.every((d) => !d.value && !pctScale)) return <Empty title={empty} />;
  const label = (d: { value: number; note: string }) => (valueLabel ? valueLabel(d) : money ? fmtINR(d.value) : String(d.value));
  return (
    <div className="px-2 pb-3" style={{ height: Math.max(160, data.length * 38 + 30) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 120, top: 4, bottom: 4 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke="#f0f0f2" />
          <XAxis type="number" hide domain={pctScale ? [0, 100] : [0, 'dataMax']} />
          <YAxis type="category" dataKey="name" tick={{ ...axis, fill: '#3f3f46' }} axisLine={false} tickLine={false} width={120} />
          <Tooltip {...tip} cursor={{ fill: '#f4f4f5' }} formatter={(_v: number, _n: string, p: { payload?: { value: number; note: string } }) => [p.payload ? label(p.payload) : '', '']} separator="" />
          <Bar dataKey="value" fill={SLOT[0]} radius={[0, 10, 10, 0]} maxBarSize={20} background={pctScale ? { fill: '#f4f3ee', radius: 10 } : undefined}>
            <LabelList dataKey="value" position="right" content={(p) => {
              const { x = 0, y = 0, width = 0, height = 0, index = 0 } = p as { x?: number; y?: number; width?: number; height?: number; index?: number };
              return <text x={Number(x) + Number(width) + 8} y={Number(y) + Number(height) / 2} dy={4} fontSize={11.5} fill="#27272a" fontWeight={600}>{label(data[index])}</text>;
            }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}


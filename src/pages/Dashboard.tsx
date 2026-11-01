import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as S from '../store/store';
import { Button, Card, CardHeader, Empty, PageHeader, cx } from '../ui/kit';
import { useRange } from '../ui/shell';
import { financeFor, periodFigures } from '../domain/finance';
import { addDays, fmtDate, fmtINR, fmtINRShort, fmtMonth, inRange, monthOf, monthRange, monthsBetween, RANGE_LABELS, todayIST } from '../domain/util';
import type { DB } from '../domain/types';

export const C = { brand: '#028a02', brandSoft: '#b9e3b6', ink: '#181818', info: '#2563eb', green: '#05b200', orange: '#ea7a2b', red: '#dc2626', gray: '#a1a1aa', grid: '#f0f0f2' };
const axis = { fontSize: 11, fill: '#71717a' };
const money = (v: number) => fmtINRShort(v);
const tip = { contentStyle: { borderRadius: 8, border: '1px solid #e7e7ea', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,.06)' } };

/**
 * Two kinds of figure, labelled on every tile:
 *  - period: follows the global date filter (admissions, leads, collections, revenue, expenses, profit)
 *  - today:  a live snapshot (active students, pending/overdue fees, follow-ups, upcoming batches)
 */
export function useAnalytics(db: DB, range: [string, string]) {
  return useMemo(() => {
    const today = todayIST();
    const fig = periodFigures(db, range[0], range[1], today);

    // fees owed right now — same rules as Collections (dropped/refunded students excluded)
    let pending = 0, overdue = 0, due7 = 0, overdueStudents = 0, pendingStudents = 0;
    for (const s of db.students) {
      if (s.status === 'Refunded' || s.status === 'Dropped') continue;
      const f = financeFor(db, s.id, today);
      // a student can be in both counts: one instalment overdue, a later one still pending
      if (f.lines.some((l) => l.status === 'Overdue')) overdueStudents++;
      if (f.lines.some((l) => l.remaining > 0 && l.status !== 'Overdue')) pendingStudents++;
      for (const l of f.lines) {
        if (l.remaining <= 0) continue;
        if (l.status === 'Overdue') overdue += l.remaining;
        else { pending += l.remaining; if (l.dueDate <= addDays(today, 7)) due7 += l.remaining; }
      }
    }

    const leadsIn = db.leads.filter((l) => inRange(l.createdAt, range));
    const converted = leadsIn.filter((l) => l.status === 'Converted').length;
    const admitted = db.students.filter((s) => inRange(s.admissionDate, range));
    const payments = db.payments.filter((p) => p.kind === 'payment' && p.verified && inRange(p.date, range)).length;
    const followups = db.leads.filter((l) => l.nextFollowUp && l.nextFollowUp <= today && l.status !== 'Converted' && l.status !== 'Lost');
    const upcoming = db.batches.filter((b) => b.status === 'upcoming' || (b.status === 'running' && b.startDate > today)).sort((a, b) => a.startDate.localeCompare(b.startDate));

    // monthly series for the charts: the months of the filter, at least the last 6
    const start = range[0] > addDays(range[1], -150) ? `${monthOf(addDays(range[1], -150))}-01` : range[0];
    const months = monthsBetween(start < '2000-02-01' ? firstActivity(db) : start, range[1]).slice(-24);
    const monthly = months.map((ym) => {
      const [a, b] = monthRange(ym);
      const f = periodFigures(db, a, b, today);
      return {
        ym, label: fmtMonth(ym), revenue: f.earned, expenses: f.totalExpenses,
        admitted: db.students.filter((s) => inRange(s.admissionDate, [a, b])).length,
        enrolled: db.students.filter((s) => s.admissionDate <= b && !['Dropped', 'Refunded'].includes(s.status)).length,
      };
    });

    return {
      fig, today, monthly,
      // student overview
      active: db.students.filter((s) => s.status === 'Active').length,
      totalStudents: db.students.length,
      completed: db.students.filter((s) => s.status === 'Completed').length,
      admissions: admitted.length, fromLeads: admitted.filter((s) => s.leadId).length,
      leads: leadsIn.length,
      contacted: leadsIn.filter((l) => l.lastCallAt || l.status === 'Converted').length,
      openLeads: leadsIn.filter((l) => l.status !== 'Converted' && l.status !== 'Lost').length,
      converted, lost: leadsIn.filter((l) => l.status === 'Lost').length,
      conv: leadsIn.length ? (converted / leadsIn.length) * 100 : null,
      // fee overview
      payments, pending, due7, overdue, overdueStudents, pendingStudents,
      // operations
      followupsDue: followups.length, followupsToday: followups.filter((l) => l.nextFollowUp === today).length,
      upcoming: upcoming.length, nextBatch: upcoming[0],
      upcomingEnrolled: db.students.filter((s) => s.status === 'Active' && upcoming.some((b) => b.id === s.batchId)).length,
    };
  }, [db, range[0], range[1]]);
}
const firstActivity = (db: DB) => [...db.students.map((s) => s.admissionDate), ...db.payments.map((p) => p.date), ...db.expenses.map((e) => e.date)].sort()[0] ?? todayIST();

export default function Dashboard() {
  const db = S.useDB();
  const { key, range } = useRange();
  const nav = useNavigate();
  const a = useAnalytics(db, range);
  const fin = S.allowed('fees', 'view', db) || S.allowed('profit', 'view', db);
  const hasData = db.students.length || db.leads.length || db.expenses.length;

  if (!hasData) return (
    <>
      <PageHeader title="Dashboard" />
      <Card><Empty title="No business data yet" body="Admit your first student or import leads. The dashboard fills in from real records — nothing here is a placeholder." action={
        <div className="flex gap-2 justify-center flex-wrap">
          <Button variant="primary" onClick={() => nav('/admissions')}>New admission</Button>
          <Button onClick={() => nav('/leads?view=import')}>Import leads</Button>
          {S.currentUser()?.role === 'super_admin' && <Button onClick={() => nav('/settings?tab=data')}>Load demo data</Button>}
        </div>} /></Card>
    </>
  );

  const P = RANGE_LABELS[key]; // period figures follow the date filter
  const T = 'As of today';     // snapshot figures
  const profitTone = a.fig.netProfit >= 0 ? '#15803d' : '#b91c1c';
  return (
    <>
      <PageHeader title="Dashboard" sub={`${P} · ${fmtDate(range[0])} – ${fmtDate(range[1])}`} />

      <Section title="Student overview">
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatTile color="#15803d" icon="students" label="Active students" scope={T} value={a.active} to="/students?status=Active"
            subs={[['All students', a.totalStudents], ['Completed', a.completed]]} />
          <StatTile color="#1d4ed8" icon="userPlus" label="New admissions" scope={P} value={a.admissions} to={`/students?from=${range[0]}&to=${range[1]}`}
            subs={[['From leads', a.fromLeads], ['Direct', a.admissions - a.fromLeads]]} />
          <StatTile color="#0f766e" icon="leads" label="Total leads" scope={P} value={a.leads} to="/leads"
            subs={[['Contacted', a.contacted], ['Still open', a.openLeads]]} />
          <StatTile color="#6d28d9" icon="target" label="Conversion rate" scope={P} value={a.conv === null ? '—' : `${a.conv.toFixed(1)}%`} to="/leads?status=Converted"
            subs={[['Converted', `${a.converted} of ${a.leads}`], ['Lost', a.lost]]} />
        </div>
      </Section>

      {fin && <>
        <Section title="Fee overview">
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <StatTile color="#047857" icon="rupee" label="Fees collected" scope={P} value={fmtINR(a.fig.collected)} to="/collections?view=all"
              subs={[['Payments', a.payments], ['Refunds', fmtINR(a.fig.refunds)]]} />
            <StatTile color="#c2410c" icon="clock" label="Pending fees" scope={T} value={fmtINR(a.pending)} to="/collections?view=due7"
              subs={[['Students', a.pendingStudents], ['Due in 7 days', fmtINR(a.due7)]]} />
            <StatTile color="#b91c1c" icon="alert" label="Overdue fees" scope={T} value={fmtINR(a.overdue)} to="/collections?view=overdue"
              subs={[['Students', a.overdueStudents], ['Of all owed', pctOf(a.overdue, a.overdue + a.pending)]]} />
          </div>
        </Section>

        <Section title="Financial overview">
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatTile color="#047857" icon="wallet" label="Total revenue" scope={P} value={fmtINR(a.fig.earned)} to="/profit"
              subs={[['Collected', fmtINR(a.fig.collected)], ['Refunds & GST', fmtINR(a.fig.refunds + a.fig.gst)]]} />
            <StatTile color="#6d28d9" icon="receipt" label="Total expenses" scope={P} value={fmtINR(a.fig.totalExpenses)} to="/expenses"
              subs={[['Fixed', fmtINR(a.fig.fixedExpenses)], ['Variable', fmtINR(a.fig.variableExpenses)]]} />
            <StatTile color={profitTone} icon="trend" label="Net profit" scope={P} value={fmtINR(a.fig.netProfit)} to="/profit" note="Revenue minus expenses" />
            <StatTile color={profitTone} icon="percent" label="Profit margin" scope={P} value={pctOf(a.fig.netProfit, a.fig.earned)} to="/profit" note="Net profit as a share of revenue" />
          </div>
        </Section>
      </>}

      <Section title="Operations">
        <div className="grid sm:grid-cols-2 gap-4">
          <StatTile color="#0f766e" icon="phone" label="Follow-ups due" scope={T} value={a.followupsDue} to="/leads?view=calling"
            subs={[['Due today', a.followupsToday], ['Missed earlier', a.followupsDue - a.followupsToday]]} />
          <StatTile color="#1d4ed8" icon="calendar" label="Upcoming batches" scope={T} value={a.upcoming} to="/batches"
            subs={[['Next start', a.nextBatch ? `${fmtDate(a.nextBatch.startDate)}` : '—'], ['Students enrolled', a.upcomingEnrolled]]} />
        </div>
      </Section>

      <div className="grid lg:grid-cols-2 gap-4">
        {fin && (
          <Card>
            <CardHeader title="Revenue vs expenses" sub="Monthly revenue (after refunds & GST) against approved expenses" />
            <Chart>
              <BarChart data={a.monthly} onClick={(e: any) => e?.activePayload && nav(`/reports?r=revenue&m=${e.activePayload[0].payload.ym}`)}>
                <CartesianGrid vertical={false} stroke={C.grid} /><XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} interval={0} /><YAxis tickFormatter={money} tick={axis} axisLine={false} tickLine={false} width={56} />
                <Tooltip {...tip} formatter={(v: number) => fmtINR(v)} cursor={{ fill: '#f4f4f5' }} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="revenue" name="Revenue" fill={C.brand} radius={[4, 4, 0, 0]} maxBarSize={28} className="cursor-pointer" />
                <Bar dataKey="expenses" name="Expenses" fill={C.gray} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </Chart>
          </Card>
        )}
        <Card className={fin ? undefined : 'lg:col-span-2'}>
          <CardHeader title="Student admissions & growth" sub="New admissions each month and total enrolled students" />
          <Chart>
            <ComposedChart data={a.monthly} onClick={(e: any) => { const m = e?.activePayload?.[0]?.payload.ym; if (m) { const [f, t] = monthRange(m); nav(`/students?from=${f}&to=${t}`); } }}>
              <CartesianGrid vertical={false} stroke={C.grid} /><XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} interval={0} />
              <YAxis yAxisId="n" allowDecimals={false} tick={axis} axisLine={false} tickLine={false} width={32} />
              <YAxis yAxisId="t" orientation="right" allowDecimals={false} tick={axis} axisLine={false} tickLine={false} width={36} />
              <Tooltip {...tip} cursor={{ fill: '#f4f4f5' }} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="n" dataKey="admitted" name="New admissions" fill={C.brand} radius={[4, 4, 0, 0]} maxBarSize={28} className="cursor-pointer" />
              <Line yAxisId="t" dataKey="enrolled" name="Total enrolled" stroke={C.ink} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </Chart>
        </Card>
      </div>
    </>
  );
}

const pctOf = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');

const ICONS: Record<string, string> = {
  students: 'M16 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 2c-3.3 0-7 1.6-7 4.5V21h14v-2.5c0-2.9-3.7-4.5-7-4.5ZM8 14c-.6 0-1.3.1-2 .2C3.6 14.7 1 16 1 18v3h6v-2.5c0-1.6.8-2.9 2-3.9-.3-.4-.7-.6-1-.6Z',
  leads: 'M3 4h18l-7 8.5V19l-4 2v-8.5L3 4Z',
  rupee: 'M6 4h12M6 8.5h12M6 4h3.5a4.5 4.5 0 0 1 0 9H6l8 7',
  alert: 'M12 3 2 20h20L12 3Zm0 6v5m0 3.2v.1',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2',
  receipt: 'M6 2h12v20l-3-2-3 2-3-2-3 2V2Zm3 6h6m-6 4h6m-6 4h3',
  trend: 'M3 17l6-6 4 4 8-8m0 0h-5m5 0v5',
  phone: 'M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2Z',
  userPlus: 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1M19 8v6M16 11h6',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  wallet: 'M3 6h15a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H3V6Zm0 0 13-3v3m-1 8h.01',
  percent: 'M19 5 5 19M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm9 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  calendar: 'M4 5h16v16H4V5Zm0 5h16M8 3v4m8-4v4',
};
const FILLED = new Set(['students', 'leads']);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-6"><h2 className="text-[12px] font-bold uppercase tracking-wider text-zinc-500 mb-2.5">{title}</h2>{children}</section>
);

/** Solid coloured KPI tile: big icon left, headline number right, two sub-stats (or a one-line note) below. Click opens the filtered records. */
export function StatTile({ color, icon, label, value, subs, note, scope, to }: { color: string; icon: string; label: string; value: React.ReactNode; subs?: [string, React.ReactNode][]; note?: string; scope?: string; to?: string }) {
  const filled = FILLED.has(icon);
  const three = subs?.length === 3;
  // ponytail: soft tint of the accent colour; text stays dark ink for contrast
  const cls = cx('@container block h-full rounded-xl text-ink p-4 border shadow-[0_1px_2px_rgba(0,0,0,.06),0_2px_8px_rgba(0,0,0,.04)] transition-all', to && 'hover:shadow-[0_4px_14px_rgba(0,0,0,.10)] hover:-translate-y-px');
  const style = { background: `color-mix(in srgb, ${color} 15%, white)`, borderColor: `color-mix(in srgb, ${color} 32%, white)` };
  const body = (
    <>
      <div className="flex items-center gap-4 @max-[260px]:gap-3">
        <svg viewBox="0 0 24 24" className="size-14 @max-[260px]:size-10 shrink-0" style={{ color }} fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[icon]} /></svg>
        <div className="min-w-0">
          <div className="text-[11.5px] font-bold uppercase tracking-wider" style={{ color }}>{label}</div>
          <div className="text-[30px] @max-[260px]:text-[24px] leading-tight font-bold text-zinc-950 tabular truncate">{value}</div>
          {scope && <div className="text-[11px] font-medium text-zinc-500">{scope}</div>}
        </div>
      </div>
      <div className={cx('grid gap-3 mt-4 pt-3 border-t min-h-[54px]', three ? 'grid-cols-3 @max-[260px]:gap-2' : 'grid-cols-2')} style={{ borderColor: `color-mix(in srgb, ${color} 28%, white)` }}>
        {note && <div className="col-span-2 self-center text-[12.5px] font-medium text-zinc-600">{note}</div>}
        {subs?.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <div className={cx('text-[10.5px] font-semibold uppercase text-zinc-600 truncate', three ? 'tracking-normal @max-[260px]:text-[9.5px]' : 'tracking-wider @max-[260px]:tracking-normal')}>{k}</div>
            <div className={cx('font-bold text-zinc-900 tabular truncate', three ? 'text-[15px] @max-[260px]:text-[14px]' : 'text-[17px] @max-[260px]:text-[15px]')}>{v}</div>
          </div>
        ))}
      </div>
    </>
  );
  return to ? <Link to={to} className={cls} style={style}>{body}</Link> : <div className={cls} style={style}>{body}</div>;
}

export const Chart = ({ children, h = 240 }: { children: React.ReactElement; h?: number }) => (
  <div className="px-2 pb-3" style={{ height: h }}><ResponsiveContainer>{children}</ResponsiveContainer></div>
);

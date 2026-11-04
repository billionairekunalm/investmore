import { useEffect, useId, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as S from '../store/store';
import { cloudEnabled } from '../store/cloud';
import { Button, Card, CardHeader, Empty, PageHeader, cx } from '../ui/kit';
import { useRange } from '../ui/shell';
import { financeFor, periodFigures } from '../domain/finance';
import { addDays, daysBetween, fmtDate, fmtINR, fmtINRShort, fmtMonth, inRange, monthOf, monthRange, monthsBetween, RANGE_LABELS, todayIST } from '../domain/util';
import type { DB } from '../domain/types';
import { ReportsPanel } from './Reports';

export const C = { brand: '#028a02', brandSoft: '#b9e3b6', lime: '#9ee27f', ink: '#181818', info: '#2563eb', green: '#05b200', orange: '#ea7a2b', red: '#dc2626', gray: '#c9c7bd', grid: '#efede7', track: '#f4f3ee' };
const axis = { fontSize: 11, fill: '#8a8a80' };
const money = (v: number) => fmtINRShort(v);
const tip = { contentStyle: { borderRadius: 14, border: 'none', background: '#151715', color: '#fff', fontSize: 12, boxShadow: '0 10px 24px rgba(0,0,0,.18)' }, itemStyle: { color: '#fff' }, labelStyle: { color: '#b6f09c', fontWeight: 600 } };

/**
 * Two kinds of figure, labelled on every tile:
 *  - period: follows the global date filter (admissions, leads, collections, revenue, expenses, profit)
 *  - today:  a live snapshot (active students, pending/overdue fees)
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
    };
  }, [db, range[0], range[1]]);
}
const firstActivity = (db: DB) => [...db.students.map((s) => s.admissionDate), ...db.payments.map((p) => p.date), ...db.expenses.map((e) => e.date)].sort()[0] ?? todayIST();

export default function Dashboard() {
  const [sp] = useSearchParams();
  useEffect(() => { if (sp.get('r') || sp.get('view') || location.hash === '#reports') setTimeout(() => document.getElementById('reports')?.scrollIntoView({ behavior: 'smooth' }), 150); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const db = S.useDB();
  const { key, range } = useRange();
  const nav = useNavigate();
  const a = useAnalytics(db, range);
  // the same-length period just before the filter, for the change badges on the top tiles ("All time" has none)
  const prev = useMemo(() => {
    if (range[0] < '2000-02-01') return null;
    const p: [string, string] = [addDays(range[0], -(daysBetween(range[0], range[1]) + 1)), addDays(range[0], -1)];
    const leads = db.leads.filter((l) => inRange(l.createdAt, p));
    return { fig: periodFigures(db, p[0], p[1], todayIST()), admissions: db.students.filter((s) => inRange(s.admissionDate, p)).length, leads: leads.length,
      conv: leads.length ? (leads.filter((l) => l.status === 'Converted').length / leads.length) * 100 : null };
  }, [db, range[0], range[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const fin = S.allowed('fees', 'view', db) || S.allowed('profit', 'view', db);
  const hasData = db.students.length || db.leads.length || db.expenses.length;

  if (!hasData) return (
    <>
      <PageHeader title="Dashboard" />
      <Card><Empty title="No business data yet" body="Admit your first student or import leads. The dashboard fills in from real records — nothing here is a placeholder." action={
        <div className="flex gap-2 justify-center flex-wrap">
          <Button variant="primary" onClick={() => nav('/admissions')}>New admission</Button>
          <Button onClick={() => nav('/leads?view=import')}>Import leads</Button>
          {!cloudEnabled && S.currentUser()?.role === 'super_admin' && <Button onClick={() => nav('/settings?tab=backup')}>Add sample data</Button>}
        </div>} /></Card>
    </>
  );

  const P = RANGE_LABELS[key]; // period figures follow the date filter
  const T = 'As of today';     // snapshot figures
  return (
    <>
      <PageHeader title={`Welcome back, ${S.currentUser()?.name.split(' ')[0] ?? ''}`} sub={`Here’s how the academy is doing · ${P} · ${fmtDate(range[0])} – ${fmtDate(range[1])}`} />

      <Section title="Student overview">
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <HeroTile tone="violet" icon="students" art="people" label="Active students" scope={T} value={a.active} to="/students?status=Active"
            subs={[['All', a.totalStudents], ['Completed', a.completed]]} />
          <HeroTile tone="mint" icon="userPlus" art="clipboard" label="New admissions" scope={P} value={a.admissions} to={`/students?from=${range[0]}&to=${range[1]}`}
            trend={prev && change(a.admissions, prev.admissions)} subs={[['From leads', a.fromLeads], ['Direct', a.admissions - a.fromLeads]]} />
          <HeroTile tone="peach" icon="leads" art="bars" label="Total leads" scope={P} value={a.leads} to="/leads"
            trend={prev && change(a.leads, prev.leads)} subs={[['Contacted', a.contacted], ['Still open', a.openLeads]]} />
          <HeroTile tone="sky" icon="target" art="donut" label="Conversion rate" scope={P} value={a.conv === null ? '—' : `${a.conv.toFixed(1)}%`} to="/leads?status=Converted"
            trend={prev && a.conv !== null && prev.conv !== null ? { text: `${a.conv - prev.conv >= 0 ? '+' : ''}${(a.conv - prev.conv).toFixed(1)} pts`, up: a.conv >= prev.conv } : null}
            subs={[['Converted', `${a.converted} of ${a.leads}`], ['Lost', a.lost]]} />
        </div>
      </Section>

      {fin && <>
        <Section title="Fee overview">
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <HeroTile tone="mint" icon="rupee" art="coins" label="Fees collected" scope={P} value={fmtINR(a.fig.collected)} to="/collections?view=all"
              trend={prev && change(a.fig.collected, prev.fig.collected)} subs={[['Payments', a.payments], ['Refunds', fmtINR(a.fig.refunds)]]} />
            <HeroTile tone="peach" icon="clock" art="clock" label="Pending fees" scope={T} value={fmtINR(a.pending)} to="/collections?view=due7"
              subs={[['Students', a.pendingStudents], ['Due in 7 days', fmtINR(a.due7)]]} />
            <HeroTile tone="rose" icon="alert" art="alert" label="Overdue fees" scope={T} value={fmtINR(a.overdue)} to="/collections?view=overdue"
              subs={[['Students', a.overdueStudents], ['Of all owed', pctOf(a.overdue, a.overdue + a.pending)]]} />
          </div>
        </Section>

        <Section title="Financial overview">
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <HeroTile tone="sky" icon="wallet" art="wallet" label="Total revenue" scope={P} value={fmtINR(a.fig.earned)} to="/profit"
              trend={prev && change(a.fig.earned, prev.fig.earned)} subs={[['Collected', fmtINR(a.fig.collected)], ['Refunds & GST', fmtINR(a.fig.refunds + a.fig.gst)]]} />
            <HeroTile tone="stone" icon="receipt" art="receipt" label="Total expenses" scope={P} value={fmtINR(a.fig.totalExpenses)} to="/expenses"
              trend={prev && change(a.fig.totalExpenses, prev.fig.totalExpenses, true)} subs={[['Fixed', fmtINR(a.fig.fixedExpenses)], ['Variable', fmtINR(a.fig.variableExpenses)]]} />
            <HeroTile tone={a.fig.netProfit >= 0 ? 'mint' : 'rose'} icon="trend" art="trend" label="Net profit" scope={P} value={fmtINR(a.fig.netProfit)} to="/profit"
              trend={prev && prev.fig.netProfit > 0 ? change(a.fig.netProfit, prev.fig.netProfit) : null} note="Revenue minus expenses" />
            <HeroTile tone="violet" icon="percent" art="pie" label="Profit margin" scope={P} value={pctOf(a.fig.netProfit, a.fig.earned)} to="/profit" note="Net profit as a share of revenue" />
          </div>
        </Section>
      </>}

      <div className="grid lg:grid-cols-2 gap-4">
        {fin && (
          <Card>
            <CardHeader title="Revenue vs expenses" sub="Monthly revenue (after refunds & GST) against approved expenses" />
            <Chart>
              <BarChart data={a.monthly} onClick={(e: any) => e?.activePayload && nav(`/?r=revenue#reports`)}>
                <CartesianGrid vertical={false} stroke={C.grid} /><XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} interval={0} /><YAxis tickFormatter={money} tick={axis} axisLine={false} tickLine={false} width={56} />
                <Tooltip {...tip} formatter={(v: number) => fmtINR(v)} cursor={{ fill: 'transparent' }} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="revenue" name="Revenue" fill={C.ink} radius={[10, 10, 10, 10]} maxBarSize={22} className="cursor-pointer" />
                <Bar dataKey="expenses" name="Expenses" fill={C.lime} radius={[10, 10, 10, 10]} maxBarSize={22} />
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
              <Tooltip {...tip} cursor={{ fill: 'transparent' }} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="n" dataKey="admitted" name="New admissions" fill={C.ink} background={{ fill: C.track, radius: 12 } as any} radius={[12, 12, 12, 12]} maxBarSize={26} className="cursor-pointer" />
              <Line yAxisId="t" type="monotone" dataKey="enrolled" name="Total enrolled" stroke={C.green} strokeWidth={3} dot={{ r: 4, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} />
            </ComposedChart>
          </Chart>
        </Card>
      </div>

      {S.allowed('reports', 'view', db) && <ReportsPanel />}
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
  flame: 'M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8a7 7 0 0 0 7 7Z',
  check: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 3 3 5-6',
};
const FILLED = new Set(['students', 'leads']);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-7"><h2 className="text-[16px] font-bold tracking-tight mb-3">{title}</h2>{children}</section>
);

/**
 * Brand skins for KPI tiles (logo charcoal + greens, warm neutrals). Callers keep passing their semantic colour;
 * ponytail: mapped here so every tile in the app restyles at once. Orange/red stay warm so money owed still reads as a warning.
 */
const SKIN: Record<string, { bg: string; fg: string; accent: string; chip: string; dark?: boolean }> = {
  '#1d4ed8': { bg: '#151715', fg: '#ffffff', accent: '#b6f09c', chip: 'rgba(255,255,255,.08)', dark: true }, // charcoal hero
  '#15803d': { bg: '#dcf2d0', fg: '#181818', accent: '#028a02', chip: 'rgba(255,255,255,.55)' },            // mint
  '#047857': { bg: '#dcf2d0', fg: '#181818', accent: '#028a02', chip: 'rgba(255,255,255,.55)' },
  '#0f766e': { bg: '#f3e9cc', fg: '#181818', accent: '#8a6510', chip: 'rgba(255,255,255,.55)' },            // sand
  '#6d28d9': { bg: '#e6e5dd', fg: '#181818', accent: '#181818', chip: 'rgba(255,255,255,.6)' },             // stone
  '#c2410c': { bg: '#fbe3cf', fg: '#181818', accent: '#c2410c', chip: 'rgba(255,255,255,.55)' },            // peach (pending)
  '#b91c1c': { bg: '#f9d9d6', fg: '#181818', accent: '#b91c1c', chip: 'rgba(255,255,255,.55)' },            // rose (overdue / loss)
};

/** KPI tile: icon chip, label, big number, two sub-stats (or a one-line note). Click opens the filtered records. */
export function StatTile({ color, icon, label, value, subs, note, scope, to }: { color: string; icon: string; label: string; value: React.ReactNode; subs?: [string, React.ReactNode][]; note?: string; scope?: string; to?: string }) {
  const filled = FILLED.has(icon);
  const three = subs?.length === 3;
  const k = SKIN[color] ?? { bg: `color-mix(in srgb, ${color} 16%, white)`, fg: '#181818', accent: color, chip: 'rgba(255,255,255,.55)' };
  const soft = k.dark ? 'text-zinc-400' : 'text-zinc-600';
  const cls = cx('@container relative overflow-hidden block h-full rounded-3xl p-5 transition-all duration-200', to && 'hover:-translate-y-1 hover:shadow-[0_16px_30px_-16px_rgba(24,24,24,.35)]');
  const body = (
    <>
      {/* soft decorative ring, top-right */}
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full border-[18px] opacity-[.12]" style={{ borderColor: k.accent }} />
      <div className="flex items-start justify-between gap-3">
        <span className="size-11 shrink-0 grid place-items-center rounded-2xl" style={{ background: k.chip, color: k.accent }}>
          <svg viewBox="0 0 24 24" className="size-[22px]" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[icon]} /></svg>
        </span>
        {scope && <span className="relative rounded-full px-2.5 py-1 text-[10.5px] font-semibold whitespace-nowrap" style={{ background: k.chip }}>{scope}</span>}
      </div>
      <div className={cx('mt-4 text-[13px] font-medium', soft)}>{label}</div>
      <div className="text-[30px] @max-[260px]:text-[24px] leading-tight font-bold tracking-tight tabular truncate">{value}</div>
      <div className={cx('grid gap-3 mt-4 pt-3 border-t min-h-[50px]', three ? 'grid-cols-3 @max-[260px]:gap-2' : 'grid-cols-2')} style={{ borderColor: k.dark ? 'rgba(255,255,255,.1)' : 'rgba(24,24,24,.08)' }}>
        {note && <div className={cx('col-span-2 self-center text-[12.5px] font-medium', soft)}>{note}</div>}
        {subs?.map(([lbl, v]) => (
          <div key={lbl} className="min-w-0">
            <div className={cx('text-[11px] font-medium truncate', soft)}>{lbl}</div>
            <div className={cx('font-bold tabular truncate', three ? 'text-[15px] @max-[260px]:text-[14px]' : 'text-[17px] @max-[260px]:text-[15px]')}>{v}</div>
          </div>
        ))}
      </div>
    </>
  );
  const style = { background: k.bg, color: k.fg };
  return to ? <Link to={to} className={cls} style={style}>{body}</Link> : <div className={cls} style={style}>{body}</div>;
}

/** Soft pastel themes + small illustrations for the top "Student overview" tiles. */
const HERO = {
  violet: { bg: 'linear-gradient(135deg,#f6f1ff 0%,#e9defe 100%)', icon: '#7c3aed', chip: '#ede4ff' },
  mint: { bg: 'linear-gradient(135deg,#effbf1 0%,#d6f3dc 100%)', icon: '#15803d', chip: '#dcf5e1' },
  peach: { bg: 'linear-gradient(135deg,#fff7ec 0%,#ffe6c9 100%)', icon: '#ea7a2b', chip: '#ffecd6' },
  sky: { bg: 'linear-gradient(135deg,#f1f6ff 0%,#dde8ff 100%)', icon: '#2563eb', chip: '#e2ebff' },
  rose: { bg: 'linear-gradient(135deg,#fff3f2 0%,#fddcd8 100%)', icon: '#dc2626', chip: '#fee4e1' },
  stone: { bg: 'linear-gradient(135deg,#f7f6f2 0%,#e8e6de 100%)', icon: '#52525b', chip: '#efeee8' },
} as const;
export type Art = 'people' | 'clipboard' | 'bars' | 'donut' | 'coins' | 'clock' | 'alert' | 'wallet' | 'receipt' | 'trend' | 'pie' | 'funnel' | 'phone' | 'flame' | 'badge' | 'gift';
export type HeroTone = keyof typeof HERO;

function Illustration({ kind }: { kind: Art }) {
  const uid = useId().replace(/:/g, ''); // gradient ids must be unique on the page, or url(#…) can pick a hidden copy
  const g = (id: string, a: string, b: string) => <linearGradient id={uid + id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>;
  const u = (id: string) => `url(#${uid}${id})`;
  return (
    <svg viewBox="0 0 96 80" className="w-[92px] h-[76px] @max-[250px]:w-[60px] @max-[250px]:h-[50px] drop-shadow-[0_10px_14px_rgba(24,24,24,.14)]" aria-hidden>
      {kind === 'people' && <><defs>{g('pp', '#a78bfa', '#6d28d9')}{g('pb', '#ddd6fe', '#a78bfa')}</defs>
        <circle cx="24" cy="34" r="9" fill={u('pb')} /><path d="M8 66c0-10 7-17 16-17s16 7 16 17Z" fill={u('pb')} />
        <circle cx="72" cy="34" r="9" fill={u('pb')} /><path d="M56 66c0-10 7-17 16-17s16 7 16 17Z" fill={u('pb')} />
        <circle cx="48" cy="26" r="13" fill={u('pp')} /><path d="M26 70c0-14 10-24 22-24s22 10 22 24Z" fill={u('pp')} /></>}
      {kind === 'clipboard' && <><defs>{g('cg', '#4ade80', '#15803d')}</defs>
        <rect x="22" y="10" width="52" height="64" rx="10" fill={u('cg')} transform="rotate(6 48 42)" />
        <rect x="29" y="18" width="40" height="50" rx="6" fill="#fff" transform="rotate(6 48 42)" />
        <rect x="38" y="6" width="22" height="10" rx="4" fill="#166534" transform="rotate(6 48 42)" />
        <g transform="rotate(6 48 42)" stroke="#16a34a" strokeWidth="3.2" strokeLinecap="round" fill="none"><path d="m34 31 3 3 5-6M34 45l3 3 5-6M34 59l3 3 5-6" /><path d="M47 32h15M47 46h15M47 60h11" stroke="#bbf7d0" /></g></>}
      {kind === 'bars' && <><defs>{g('bo', '#fdba74', '#ea580c')}</defs>
        <rect x="14" y="48" width="18" height="24" rx="4" fill={u('bo')} /><rect x="39" y="32" width="18" height="40" rx="4" fill={u('bo')} /><rect x="64" y="12" width="18" height="60" rx="4" fill={u('bo')} />
        <rect x="10" y="72" width="76" height="3" rx="1.5" fill="#fdba74" /></>}
      {kind === 'donut' && <><defs>{g('dg', '#60a5fa', '#1d4ed8')}</defs>
        <circle cx="48" cy="40" r="26" fill="none" stroke="#dbeafe" strokeWidth="14" />
        <circle cx="48" cy="40" r="26" fill="none" stroke={u('dg')} strokeWidth="14" strokeLinecap="round" strokeDasharray="122 163" transform="rotate(-90 48 40)" /></>}
      {kind === 'coins' && <><defs>{g('co', '#4ade80', '#15803d')}</defs>
        {[62, 52, 42].map((y) => <g key={y}><ellipse cx="34" cy={y + 6} rx="20" ry="7" fill="#166534" /><ellipse cx="34" cy={y} rx="20" ry="7" fill={u('co')} /></g>)}
        <circle cx="66" cy="34" r="20" fill={u('co')} /><circle cx="66" cy="34" r="14.5" fill="none" stroke="#bbf7d0" strokeWidth="2" />
        <text x="66" y="41" textAnchor="middle" fontSize="20" fontWeight="800" fill="#fff">₹</text></>}
      {kind === 'clock' && <><defs>{g('ck', '#fdba74', '#ea580c')}</defs>
        <circle cx="48" cy="40" r="30" fill={u('ck')} /><circle cx="48" cy="40" r="23" fill="#fff" />
        <path d="M48 26v14l9 6" stroke="#ea580c" strokeWidth="4.5" strokeLinecap="round" fill="none" /><circle cx="48" cy="40" r="3" fill="#ea580c" /></>}
      {kind === 'alert' && <><defs>{g('al', '#fca5a5', '#dc2626')}</defs>
        <path d="M48 8 86 72H10Z" fill={u('al')} stroke={u('al')} strokeWidth="8" strokeLinejoin="round" />
        <path d="M48 32v18" stroke="#fff" strokeWidth="7" strokeLinecap="round" /><circle cx="48" cy="61" r="4.2" fill="#fff" /></>}
      {kind === 'wallet' && <><defs>{g('wa', '#60a5fa', '#1d4ed8')}</defs>
        <rect x="18" y="12" width="44" height="26" rx="5" fill="#86efac" transform="rotate(-10 40 25)" />
        <rect x="10" y="24" width="76" height="48" rx="11" fill={u('wa')} />
        <rect x="58" y="38" width="28" height="20" rx="7" fill="#1e3a8a" /><circle cx="68" cy="48" r="4" fill="#bfdbfe" /></>}
      {kind === 'receipt' && <><defs>{g('rc', '#e4e4e7', '#a1a1aa')}</defs>
        <path d="M24 6h48v68l-8-6-8 6-8-6-8 6-8-6-8 6Z" fill={u('rc')} /><path d="M30 12h36v52l-6-4-6 4-6-4-6 4-6-4-6 4Z" fill="#fff" />
        <path d="M37 24h22M37 34h22M37 44h14" stroke="#a1a1aa" strokeWidth="3.5" strokeLinecap="round" /></>}
      {kind === 'trend' && <><defs>{g('tr', '#4ade80', '#15803d')}</defs>
        {[[14, 54, 14], [34, 44, 24], [54, 36, 32], [74, 24, 44]].map(([x, y, hh]) => <rect key={x} x={x} y={y} width="12" height={hh + 4} rx="3" fill="#bbf7d0" />)}
        <path d="M10 56 32 38l16 10 34-34" stroke={u('tr')} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M66 12h18v18" stroke="#15803d" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>}
      {kind === 'pie' && <><defs>{g('pi', '#a78bfa', '#6d28d9')}</defs>
        <circle cx="44" cy="42" r="30" fill="#ddd6fe" /><path d="M44 42V12a30 30 0 1 1-28.5 39.3Z" fill={u('pi')} />
        <path d="M50 36V8a30 30 0 0 1 28 28Z" fill="#c4b5fd" transform="translate(4 -2)" /></>}
      {kind === 'funnel' && <><defs>{g('fu', '#a78bfa', '#6d28d9')}</defs>
        <path d="M12 10h72L58 42v24l-20 8V42Z" fill={u('fu')} stroke={u('fu')} strokeWidth="6" strokeLinejoin="round" />
        <path d="M22 16h52" stroke="#ddd6fe" strokeWidth="4" strokeLinecap="round" /></>}
      {kind === 'phone' && <><defs>{g('ph', '#4ade80', '#15803d')}</defs>
        <path d="M24 10h14l6 16-8 5a38 38 0 0 0 19 19l5-8 16 6v14a7 7 0 0 1-7 7A55 55 0 0 1 17 17a7 7 0 0 1 7-7Z" fill={u('ph')} />
        <path d="M60 10a22 22 0 0 1 20 20M60 22a10 10 0 0 1 8 8" stroke="#16a34a" strokeWidth="4.5" strokeLinecap="round" fill="none" /></>}
      {kind === 'flame' && <><defs>{g('fl', '#fca5a5', '#dc2626')}{g('fi', '#fde68a', '#f59e0b')}</defs>
        <path d="M48 76c16 0 26-11 26-25 0-15-11-22-15-38-7 7-10 14-10 21-4-4-7-8-7-14-8 8-20 19-20 31 0 14 10 25 26 25Z" fill={u('fl')} />
        <path d="M48 76c8 0 13-6 13-13 0-8-6-11-8-19-4 4-6 8-6 12-2-2-4-4-4-7-4 4-8 9-8 14 0 7 5 13 13 13Z" fill={u('fi')} /></>}
      {kind === 'gift' && <><defs>{g('gb', '#4ade80', '#15803d')}</defs>
        <rect x="16" y="34" width="64" height="40" rx="7" fill={u('gb')} /><rect x="12" y="24" width="72" height="16" rx="5" fill="#22c55e" />
        <rect x="43" y="24" width="10" height="50" fill="#fde68a" />
        <path d="M48 24c-4-12-20-14-20-4 0 5 9 6 20 4Zm0 0c4-12 20-14 20-4 0 5-9 6-20 4Z" fill="none" stroke="#fbbf24" strokeWidth="5" strokeLinejoin="round" /></>}
      {kind === 'badge' && <><defs>{g('bd', '#fcd34d', '#d97706')}</defs>
        <path d="M34 50 26 76l14-6 8 10 4-28M62 50l8 26-14-6-8 10-4-28" fill="#f59e0b" />
        <circle cx="48" cy="34" r="26" fill={u('bd')} /><circle cx="48" cy="34" r="19" fill="none" stroke="#fef3c7" strokeWidth="2.5" />
        <path d="m38 34 7 7 13-14" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>}
    </svg>
  );
}

/** Top-row KPI: pastel card, icon chip, big number, change vs the previous period, illustration on the right. */
type Trend = { text: string; up: boolean; good?: boolean } | null;
/** Pastel KPI card (Dashboard, Leads, Students). Opens `to`, or runs `onClick`, or is plain when neither is given. */
export function HeroTile({ tone, icon, art, label, value, trend, scope, subs, note, to, onClick }: { tone: HeroTone; icon: string; art: Art; label: string; value: React.ReactNode; trend?: Trend; scope?: string; subs?: [string, React.ReactNode][]; note?: string; to?: string; onClick?: () => void }) {
  const t = HERO[tone];
  const cls = cx('@container relative overflow-hidden block w-full h-full text-left rounded-3xl p-5 border border-white/70 shadow-[0_10px_30px_-18px_rgba(24,24,24,.35)] transition-all duration-200', (to || onClick) && 'hover:-translate-y-1 hover:shadow-[0_18px_34px_-16px_rgba(24,24,24,.35)]');
  const style = { background: t.bg };
  const body = (<>
      <span aria-hidden className="pointer-events-none absolute -right-8 -bottom-12 size-40 rounded-full bg-white/35" />
      <div className="relative flex items-start justify-between gap-2">
        <span className="size-11 shrink-0 grid place-items-center rounded-full shadow-[0_6px_14px_-8px_rgba(24,24,24,.4)]" style={{ background: t.chip, color: t.icon }}>
          <svg viewBox="0 0 24 24" className="size-[22px]" fill={FILLED.has(icon) ? 'currentColor' : 'none'} stroke={FILLED.has(icon) ? 'none' : 'currentColor'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[icon]} /></svg>
        </span>
        {scope && <span className="rounded-full bg-white/70 px-2.5 py-1 text-[10.5px] font-semibold text-zinc-600 whitespace-nowrap">{scope}</span>}
      </div>
      <div className="relative flex items-end justify-between gap-2 mt-3">
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium text-zinc-700">{label}</div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="text-[34px] @max-[260px]:text-[28px] leading-none font-bold tracking-tight tabular text-ink">{value}</span>
            {trend && <span className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-bold tabular', (trend.good ?? trend.up) ? 'bg-white/80 text-[#15803d]' : 'bg-white/80 text-[#b91c1c]')}>{trend.up ? '↗' : '↘'} {trend.text}</span>}
          </div>
        </div>
        <span className="shrink-0 -mr-1 -mb-1"><Illustration kind={art} /></span>
      </div>
      {(note || subs) && <div className="relative mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-zinc-600">
        {note && <span className="truncate">{note}</span>}
        {subs?.map(([l, v]) => <span key={l} className="truncate">{l} <b className="text-ink tabular">{v}</b></span>)}
      </div>}
    </>);
  return to ? <Link to={to} className={cls} style={style}>{body}</Link>
    : onClick ? <button type="button" onClick={onClick} className={cls} style={style}>{body}</button>
      : <div className={cls} style={style}>{body}</div>;
}

/** Change vs the previous period of the same length; none for "all time" or when there is nothing to compare.
 *  `lowerIsBetter` (expenses): a rise shows red. */
function change(now: number, before: number, lowerIsBetter = false): Trend {
  if (!before) return null;
  const p = ((now - before) / before) * 100;
  return { text: `${p >= 0 ? '+' : ''}${Math.round(p)}%`, up: p >= 0, good: lowerIsBetter ? p <= 0 : p >= 0 };
}

export const Chart = ({ children, h = 260 }: { children: React.ReactElement; h?: number }) => (
  <div className="px-3 pb-4" style={{ height: h }}><ResponsiveContainer>{children}</ResponsiveContainer></div>
);

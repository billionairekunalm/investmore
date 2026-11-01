import type { ISODate, Paise } from './types';

// ---- money: integer paise only ----
export const rupees = (r: number): Paise => Math.round(r * 100);
export const toRupees = (p: Paise) => p / 100;
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const fmtINR = (p: Paise) => inr.format(p / 100);
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const upTo99 = (n: number) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
const upTo999 = (n: number) => [n >= 100 && `${ONES[Math.floor(n / 100)]} Hundred`, n % 100 && upTo99(n % 100)].filter(Boolean).join(' ');
const words = (n: number): string => {
  if (!n) return 'Zero';
  const crore = Math.floor(n / 1e7), lakh = Math.floor(n / 1e5) % 100, th = Math.floor(n / 1e3) % 100, rest = n % 1000;
  return [crore && `${words(crore)} Crore`, lakh && `${upTo99(lakh)} Lakh`, th && `${upTo99(th)} Thousand`, rest && upTo999(rest)].filter(Boolean).join(' ');
};
/** Indian-system amount in words for invoices: 850050 paise → "Rupees Eight Thousand Five Hundred and Fifty Paise Only". */
export const inWords = (p: Paise) => { const r = Math.floor(Math.abs(p) / 100), ps = Math.abs(p) % 100; return `Rupees ${words(r)}${ps ? ` and ${upTo99(ps)} Paise` : ''} Only`; };
export const fmtINRShort = (p: Paise) => {
  const r = Math.abs(p / 100), s = p < 0 ? '-' : '';
  if (r >= 1e7) return `${s}₹${(r / 1e7).toFixed(2)}Cr`;
  if (r >= 1e5) return `${s}₹${(r / 1e5).toFixed(2)}L`;
  if (r >= 1e3) return `${s}₹${(r / 1e3).toFixed(1)}K`;
  return `${s}₹${r.toFixed(0)}`;
};
/** Parses a rupee string typed by staff ("3,000.50") into paise. Returns null if invalid. */
export function parseRupees(s: string): Paise | null {
  const t = s.replace(/[,₹\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  return Number(w) * 100 + Number(f.padEnd(2, '0'));
}

// ---- dates: calendar days in IST ----
const istFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
export const todayIST = (now = new Date()): ISODate => istFmt.format(now);
export const nowISO = () => new Date().toISOString();
export function addDays(d: ISODate, n: number): ISODate {
  const dt = new Date(d + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
export const daysBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export const monthOf = (d: ISODate) => d.slice(0, 7);
export function monthRange(ym: string): [ISODate, ISODate] {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`];
}
export function monthsBetween(from: ISODate, to: ISODate): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const end = to.slice(0, 7);
  for (let i = 0; i < 240; i++) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    out.push(ym);
    if (ym >= end) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
const dFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtDate = (d?: ISODate) => (d ? dFmt.format(new Date(d + 'T00:00:00Z')) : '—');
const dtFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
export const fmtDateTime = (iso?: string) => (iso ? dtFmt.format(new Date(iso)) : '—');
export const fmtMonth = (ym: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(ym + '-01T00:00:00Z'));

export type RangeKey = 'today' | '7d' | 'month' | 'last_month' | 'quarter' | 'fy' | 'all' | 'custom';
export const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Today', '7d': 'Last 7 days', month: 'This month', last_month: 'Last month', quarter: 'This quarter',
  fy: 'This financial year', all: 'All time', custom: 'Custom',
};
export function resolveRange(k: RangeKey, today: ISODate, custom?: [ISODate, ISODate]): [ISODate, ISODate] {
  const [y, m] = today.split('-').map(Number);
  switch (k) {
    case 'today': return [today, today];
    case '7d': return [addDays(today, -6), today];
    case 'month': return [monthRange(today.slice(0, 7))[0], today];
    case 'last_month': { const lm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; return monthRange(lm); }
    case 'quarter': { const qm = Math.floor((m - 1) / 3) * 3 + 1; return [`${y}-${String(qm).padStart(2, '0')}-01`, today]; }
    case 'fy': return [m >= 4 ? `${y}-04-01` : `${y - 1}-04-01`, today];
    case 'all': return ['2000-01-01', today];
    case 'custom': return custom ?? [today, today];
  }
}
export const inRange = (d: string | undefined, [a, b]: [ISODate, ISODate]) => !!d && d.slice(0, 10) >= a && d.slice(0, 10) <= b;

// ---- phones (India) ----
/** Returns a 10-digit Indian mobile or null. Accepts +91, 91, 0 prefixes, spaces, dashes. */
export function normalizePhone(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}
export const fmtPhone = (p: string) => (p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p);

export const uid = () => crypto.randomUUID();

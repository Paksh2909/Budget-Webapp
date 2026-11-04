// Recurring-charge detection, end-of-month forecast, and "unusual this month" insights.
// All computed on-device from your own transaction history; simple statistics, no external services.

import { category, type CategoryId } from './categories';
import { addDays, daysBetween, monthStart, today as todayFn, toDate } from './period';
import type { Txn } from './types';

// ---------- helpers ----------

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const isSpend = (t: Txn) => t.category !== 'transfer' && t.category !== 'income';

export function merchantKey(t: Pick<Txn, 'merchant_name' | 'name'>): string {
  return (t.merchant_name ?? t.name)
    .toLowerCase()
    .replace(/\b(pos|debit|purchase|recurring|payment|autopay|ach|online|www|com)\b/g, ' ')
    .replace(/[#*]?\d{2,}/g, ' ') // store numbers, ref ids
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const displayMerchant = (t: Pick<Txn, 'merchant_name' | 'name'>) => t.merchant_name ?? t.name;

function monthEnd(d: string): string {
  return monthStart(addDays(monthStart(d), 32)); // exclusive
}

// ---------- recurring ----------

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

const CADENCES: { id: Cadence; period: number; min: number; max: number; label: string }[] = [
  { id: 'weekly', period: 7, min: 5, max: 9, label: 'Weekly' },
  { id: 'biweekly', period: 14, min: 12, max: 17, label: 'Every 2 weeks' },
  { id: 'monthly', period: 30.44, min: 26, max: 35, label: 'Monthly' },
  { id: 'quarterly', period: 91.3, min: 80, max: 100, label: 'Quarterly' },
  { id: 'yearly', period: 365.25, min: 350, max: 380, label: 'Yearly' },
];
export const cadenceLabel = (c: Cadence) => CADENCES.find((x) => x.id === c)!.label;

// Categories where a varying amount still means a real bill (utilities, insurance, payroll...).
const VARIABLE_OK = new Set<CategoryId>(['bills', 'housing', 'vehicle', 'health', 'investment', 'income']);

export interface Recurring {
  key: string;
  name: string;
  category: CategoryId;
  kind: 'expense' | 'income';
  cadence: Cadence;
  period: number;
  amount: number; // latest (fixed) or typical (variable), always positive
  variable: boolean;
  monthly: number; // normalized to a monthly cost
  last: string;
  next: string;
  status: 'active' | 'late';
  priceChange?: { from: number; to: number };
  count: number;
  txnIds: Set<string>;
}

export function detectRecurring(txns: Txn[], today = todayFn()): Recurring[] {
  const since = addDays(today, -400);
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.pending || t.category === 'transfer' || t.date < since || t.amount === 0) continue;
    const kind = t.amount > 0 ? 'expense' : 'income';
    if (kind === 'income' && t.category !== 'income') continue; // refunds aren't income streams
    const key = `${kind}:${merchantKey(t)}`;
    if (key.endsWith(':')) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    // One charge per day (merge same-day duplicates/splits).
    const byDay: { date: string; amount: number; latest: Txn }[] = [];
    for (const t of list) {
      const last = byDay[byDay.length - 1];
      if (last && last.date === t.date) {
        last.amount += Math.abs(t.amount);
        last.latest = t;
      } else byDay.push({ date: t.date, amount: Math.abs(t.amount), latest: t });
    }
    if (byDay.length < 2) continue;

    const intervals = byDay.slice(1).map((c, i) => daysBetween(byDay[i]!.date, c.date));
    const m = median(intervals);
    const cad = CADENCES.find((c) => m >= c.min && m <= c.max);
    if (!cad) continue;
    if (cad.id !== 'yearly' && byDay.length < 3) continue; // need 3+ charges except for yearly
    const tol = Math.max(3, cad.period * 0.25);
    const regular = intervals.filter((d) => Math.abs(d - cad.period) <= tol).length / intervals.length;
    if (regular < 0.7) continue;

    const amounts = byDay.map((c) => c.amount);
    const med = median(amounts);
    const within = (pct: number) => amounts.filter((a) => Math.abs(a - med) <= med * pct).length / amounts.length;
    const latest = byDay[byDay.length - 1]!;
    const cat = latest.latest.category;
    const fixed = within(0.2) >= 0.7;
    const variable = !fixed && within(0.5) >= 0.7 && VARIABLE_OK.has(cat) && cad.period >= 28;
    if (!fixed && !variable) continue;

    const next = addDays(latest.date, Math.round(cad.period));
    const grace = Math.max(5, Math.round(cad.period * 0.3));
    const lateBy = daysBetween(next, today);
    if (lateBy > Math.round(cad.period) + grace) continue; // missed 2+ cycles: probably ended
    const status: Recurring['status'] = lateBy > grace ? 'late' : 'active';

    // Price change: find where the current price started (it may have been a few charges ago).
    const same = (a: number, b: number) => Math.abs(a - b) < Math.max(0.5, b * 0.02);
    let firstAtPrice = byDay.length - 1;
    while (firstAtPrice > 0 && same(byDay[firstAtPrice - 1]!.amount, latest.amount)) firstAtPrice--;
    const before = firstAtPrice > 0 ? byDay[firstAtPrice - 1]! : null;
    const changed = fixed && before !== null && daysBetween(byDay[firstAtPrice]!.date, today) <= 75;
    const amount = fixed ? latest.amount : med;

    out.push({
      key,
      name: displayMerchant(latest.latest),
      category: cat,
      kind: key.startsWith('income') ? 'income' : 'expense',
      cadence: cad.id,
      period: cad.period,
      amount,
      variable,
      monthly: amount * (30.44 / cad.period),
      last: latest.date,
      next,
      status,
      priceChange: changed && before ? { from: before.amount, to: latest.amount } : undefined,
      count: byDay.length,
      txnIds: new Set(list.map((t) => t.id)),
    });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

/** Expected charge dates for a series within [start, end). */
function occurrencesIn(r: Recurring, start: string, end: string): string[] {
  const dates: string[] = [];
  for (let i = 1; i < 60; i++) {
    const d = addDays(r.last, Math.round(r.period * i));
    if (d >= end) break;
    if (d >= start) dates.push(d);
  }
  return dates;
}

export interface Upcoming {
  r: Recurring;
  date: string;
}

export function upcomingCharges(recurring: Recurring[], days: number, today = todayFn()): Upcoming[] {
  // Late charges are still "upcoming" (they usually post a few days late).
  const start = addDays(today, -31);
  const end = addDays(today, days + 1);
  const list: Upcoming[] = [];
  for (const r of recurring) {
    if (r.kind !== 'expense') continue;
    for (const date of occurrencesIn(r, start, end)) list.push({ r, date });
  }
  return list.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---------- end-of-month forecast ----------

export interface Forecast {
  spent: number; // month to date
  projected: number; // expected total by month end
  upcomingRecurring: number;
  upcoming: Upcoming[];
  dailyRate: number; // blended variable spending per day
  daysLeft: number;
  daysInMonth: number;
  lastMonth: number; // last month's total for comparison
  confidence: 'low' | 'ok';
}

export function forecastMonth(
  txns: Txn[],
  recurring: Recurring[],
  opts: { categories?: Set<string>; today?: string } = {},
): Forecast {
  const today = opts.today ?? todayFn();
  const start = monthStart(today);
  const end = monthEnd(today);
  const daysInMonth = daysBetween(start, end);
  const elapsed = daysBetween(start, today) + 1;
  const daysLeft = daysInMonth - elapsed;
  const inScope = (t: { category: string }) => !opts.categories || opts.categories.size === 0 || opts.categories.has(t.category);

  const spendTxns = txns.filter((t) => isSpend(t) && inScope(t));
  const recurringIds = new Set<string>();
  for (const r of recurring) if (r.kind === 'expense') r.txnIds.forEach((id) => recurringIds.add(id));

  let spent = 0;
  let variableSoFar = 0;
  const thisMonthVariable: number[] = [];
  for (const t of spendTxns) {
    if (t.date < start || t.date >= end || t.date > today) continue;
    spent += t.amount;
    if (!recurringIds.has(t.id)) thisMonthVariable.push(t.amount);
  }

  // Historical variable pace: the 90 days before this month (or whatever history exists).
  const histStart = addDays(start, -90);
  const earliest = spendTxns.reduce<string | null>((m, t) => (!m || t.date < m ? t.date : m), null);
  const histFrom = earliest && earliest > histStart ? earliest : histStart;
  const histDays = earliest && earliest < start ? daysBetween(histFrom, start) : 0;
  const hist: number[] = [];
  for (const t of spendTxns) if (t.date >= histFrom && t.date < start && !recurringIds.has(t.id)) hist.push(t.amount);

  // One-off big purchases count toward "spent" but shouldn't set the pace for the rest of the month.
  const typical = median([...hist, ...thisMonthVariable].filter((a) => a > 0));
  const cap = Math.max(300, typical * 5);
  for (const a of thisMonthVariable) variableSoFar += Math.min(a, cap);
  const histTotal = hist.reduce((s, a) => s + Math.min(a, cap), 0);

  const thisRate = variableSoFar / elapsed;
  const histRate = histDays >= 14 ? histTotal / histDays : thisRate;
  const w = elapsed / daysInMonth; // trust this month more as it goes on
  const dailyRate = Math.max(0, w * thisRate + (1 - w) * histRate);

  // Recurring charges still expected this month. Series that are already overdue past their grace
  // period are probably cancelled, so they don't add to the projection.
  const upcoming: Upcoming[] = [];
  for (const r of recurring) {
    if (r.kind !== 'expense' || r.status === 'late' || !inScope(r)) continue;
    for (const date of occurrencesIn(r, start, end)) upcoming.push({ r, date });
  }
  upcoming.sort((a, b) => (a.date < b.date ? -1 : 1));
  const upcomingRecurring = upcoming.reduce((s, u) => s + u.r.amount, 0);

  const lmStart = monthStart(addDays(start, -1));
  const lastMonth = spendTxns.filter((t) => t.date >= lmStart && t.date < start).reduce((s, t) => s + t.amount, 0);

  return {
    spent,
    projected: Math.max(spent, spent + upcomingRecurring + dailyRate * daysLeft),
    upcomingRecurring,
    upcoming,
    dailyRate,
    daysLeft,
    daysInMonth,
    lastMonth,
    confidence: histDays >= 30 || elapsed >= 10 ? 'ok' : 'low',
  };
}

// ---------- unusual this month ----------

export interface Insight {
  id: string;
  tone: 'warn' | 'good' | 'info';
  title: string;
  detail: string;
  category?: CategoryId;
  recurringKey?: string;
}

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const fmtCents = (n: number) => '$' + n.toFixed(2);

export function unusualInsights(txns: Txn[], recurring: Recurring[], today = todayFn()): Insight[] {
  const start = monthStart(today);
  const day = toDate(today).getUTCDate();
  const out: Insight[] = [];
  const spend = txns.filter(isSpend);
  const earliest = spend.reduce<string | null>((m, t) => (!m || t.date < m ? t.date : m), null);

  // 1) Category pace vs. the same point in the last 3 months (needs a few days of data).
  if (day >= 5 && earliest) {
    const months: { from: string; to: string }[] = [];
    let ms = start;
    for (let i = 0; i < 3; i++) {
      ms = monthStart(addDays(ms, -1));
      if (ms < monthStart(earliest)) break;
      const len = daysBetween(ms, monthEnd(ms));
      months.push({ from: ms, to: addDays(ms, Math.min(day, len)) }); // same day-of-month window
    }
    if (months.length >= 2) {
      const cur = new Map<CategoryId, number>();
      const past = new Map<CategoryId, number>();
      for (const t of spend) {
        if (t.date >= start && t.date <= today) cur.set(t.category, (cur.get(t.category) ?? 0) + t.amount);
        for (const w of months) if (t.date >= w.from && t.date < w.to) past.set(t.category, (past.get(t.category) ?? 0) + t.amount / months.length);
      }
      const ups: (Insight & { gap: number })[] = [];
      const downs: (Insight & { gap: number })[] = [];
      for (const id of new Set([...cur.keys(), ...past.keys()])) {
        const c = cur.get(id) ?? 0;
        const p = past.get(id) ?? 0;
        const label = category(id).label;
        if (c - p >= 50 && (p === 0 || c >= p * 1.3)) {
          ups.push({
            gap: c - p,
            id: `up-${id}`,
            tone: 'warn',
            category: id,
            title: p > 0 ? `${label} is up ${Math.round((c / p - 1) * 100)}%` : `More ${label} than usual`,
            detail: `${fmt(c)} so far vs. about ${fmt(p)} by this point in a typical month`,
          });
        } else if (p >= 100 && c <= p * 0.6) {
          downs.push({
            gap: p - c,
            id: `down-${id}`,
            tone: 'good',
            category: id,
            title: `${label} is down ${Math.round((1 - c / p) * 100)}%`,
            detail: `${fmt(c)} so far vs. about ${fmt(p)} usually`,
          });
        }
      }
      const strip = ({ gap: _gap, ...i }: Insight & { gap: number }): Insight => i;
      out.push(
        ...ups.sort((a, b) => b.gap - a.gap).slice(0, 3).map(strip),
        ...downs.sort((a, b) => b.gap - a.gap).slice(0, 1).map(strip),
      );
    }
  }

  // 2) Price increases and missing recurring charges.
  for (const r of recurring) {
    if (r.kind !== 'expense') continue;
    if (r.priceChange && r.priceChange.to > r.priceChange.from) {
      out.push({
        id: `price-${r.key}`,
        tone: 'warn',
        recurringKey: r.key,
        title: `${r.name} went up ${fmtCents(r.priceChange.to - r.priceChange.from)}`,
        detail: `${fmtCents(r.priceChange.from)} → ${fmtCents(r.priceChange.to)} (${cadenceLabel(r.cadence).toLowerCase()})`,
      });
    }
    if (r.status === 'late' && r.amount >= 5) {
      const d = toDate(r.next);
      out.push({
        id: `late-${r.key}`,
        tone: 'info',
        recurringKey: r.key,
        title: `No ${r.name} charge yet`,
        detail: `Usually around ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}. Cancelled, or just late?`,
      });
    }
  }

  // 3) Biggest purchase and first-time merchants this month.
  const recurringIds = new Set<string>();
  recurring.forEach((r) => r.txnIds.forEach((id) => recurringIds.add(id)));
  const thisMonth = spend.filter((t) => t.date >= start && t.date <= today && t.amount > 0 && !recurringIds.has(t.id));
  const biggest = thisMonth.reduce<Txn | null>((m, t) => (!m || t.amount > m.amount ? t : m), null);
  if (biggest && biggest.amount >= 100) {
    out.push({
      id: `big-${biggest.id}`,
      tone: 'info',
      category: biggest.category,
      title: `Largest purchase: ${fmt(biggest.amount)}`,
      detail: `${displayMerchant(biggest)} · ${category(biggest.category).label}`,
    });
  }
  if (earliest && daysBetween(earliest, start) >= 60) {
    const seen = new Set(spend.filter((t) => t.date < start && t.date >= addDays(start, -180)).map(merchantKey));
    const fresh = new Map<string, { name: string; total: number }>();
    for (const t of thisMonth) {
      const k = merchantKey(t);
      if (seen.has(k)) continue;
      const e = fresh.get(k) ?? { name: displayMerchant(t), total: 0 };
      e.total += t.amount;
      fresh.set(k, e);
    }
    const top = [...fresh.values()].filter((e) => e.total >= 75).sort((a, b) => b.total - a.total)[0];
    if (top && top.name !== (biggest && displayMerchant(biggest))) {
      out.push({ id: `new-${top.name}`, tone: 'info', title: `New: ${top.name}`, detail: `${fmt(top.total)} this month, first time in 6 months` });
    }
  }

  return out.slice(0, 6);
}

// End-of-month forecast and "unusual this month" insights (recurring detection lives in recurring.ts).
// All computed on-device from your own transaction history; simple statistics, no external services.

import { category, type CategoryId } from './categories';
import { addDays, daysBetween, monthStart, today as todayFn, toDate } from './period';
import {
  cadenceLabel,
  displayMerchant,
  median,
  merchantKey,
  occurrencesIn,
  type Recurring,
  type Upcoming,
} from './recurring';
import type { Txn } from './types';

export * from './recurring';

const isSpend = (t: Txn) => t.category !== 'transfer' && t.category !== 'income';

function monthEnd(d: string): string {
  return monthStart(addDays(monthStart(d), 32)); // exclusive
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
  elapsed: number;
  lastMonth: number; // last month's total for comparison
  confidence: 'low' | 'ok';
  // How the daily pace was worked out (shown in the forecast details):
  thisRate: number; // this month's variable $/day
  histRate: number; // recent 90-day variable $/day
  histDays: number;
  weight: number; // share of the pace taken from this month (grows through the month)
  cap: number; // purchases above this count toward "spent" but not the pace
  oneOffs: Txn[];
  variableSoFar: number;
  // Cumulative spending by day of month, for the chart:
  actualByDay: number[]; // index 0 = day 1, through today
  projectedByDay: number[]; // index 0 = today, through month end
  lastMonthByDay: number[];
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
  const thisMonthVariable: Txn[] = [];
  const perDay = new Array<number>(daysInMonth).fill(0);
  for (const t of spendTxns) {
    if (t.date < start || t.date >= end || t.date > today) continue;
    spent += t.amount;
    perDay[daysBetween(start, t.date)]! += t.amount;
    if (!recurringIds.has(t.id)) thisMonthVariable.push(t);
  }

  // Historical variable pace: the 90 days before this month (or whatever history exists).
  const histStart = addDays(start, -90);
  const earliest = spendTxns.reduce<string | null>((m, t) => (!m || t.date < m ? t.date : m), null);
  const histFrom = earliest && earliest > histStart ? earliest : histStart;
  const histDays = earliest && earliest < start ? daysBetween(histFrom, start) : 0;
  const hist: number[] = [];
  for (const t of spendTxns) if (t.date >= histFrom && t.date < start && !recurringIds.has(t.id)) hist.push(t.amount);

  // One-off big purchases count toward "spent" but shouldn't set the pace for the rest of the month.
  const typical = median([...hist, ...thisMonthVariable.map((t) => t.amount)].filter((a) => a > 0));
  const cap = Math.max(300, typical * 5);
  let variableSoFar = 0;
  for (const t of thisMonthVariable) variableSoFar += Math.min(t.amount, cap);
  const oneOffs = thisMonthVariable.filter((t) => t.amount > cap).sort((a, b) => b.amount - a.amount);
  const histTotal = hist.reduce((s, a) => s + Math.min(a, cap), 0);

  const thisRate = variableSoFar / elapsed;
  const histRate = histDays >= 14 ? histTotal / histDays : thisRate;
  const weight = elapsed / daysInMonth; // trust this month more as it goes on
  const dailyRate = Math.max(0, weight * thisRate + (1 - weight) * histRate);

  // Recurring charges still expected this month. Late series (probably cancelled) and transfers
  // (not counted as spending) don't add to the projection.
  const upcoming: Upcoming[] = [];
  for (const r of recurring) {
    if (r.kind !== 'expense' || r.status === 'late' || r.category === 'transfer' || !inScope(r)) continue;
    for (const date of occurrencesIn(r, start, end)) upcoming.push({ r, date });
  }
  upcoming.sort((a, b) => (a.date < b.date ? -1 : 1));
  const upcomingRecurring = upcoming.reduce((s, u) => s + u.r.amount, 0);

  // Cumulative series for the chart.
  const actualByDay: number[] = [];
  let run = 0;
  for (let i = 0; i < elapsed; i++) actualByDay.push((run += perDay[i]!));
  let proj = spent;
  // Expected charges dated today or earlier that haven't posted yet land "today".
  for (const u of upcoming) if (u.date <= today) proj += u.r.amount;
  const projectedByDay: number[] = [proj];
  for (let d = 1; d <= daysLeft; d++) {
    const date = addDays(today, d);
    proj += dailyRate;
    for (const u of upcoming) if (u.date === date) proj += u.r.amount;
    projectedByDay.push(proj);
  }

  const lmStart = monthStart(addDays(start, -1));
  const lmDays = daysBetween(lmStart, start);
  const lmPer = new Array<number>(lmDays).fill(0);
  let lastMonth = 0;
  for (const t of spendTxns) {
    if (t.date < lmStart || t.date >= start) continue;
    lastMonth += t.amount;
    lmPer[daysBetween(lmStart, t.date)]! += t.amount;
  }
  let lmRun = 0;
  const lastMonthByDay = lmPer.map((v) => (lmRun += v));

  return {
    spent,
    projected: Math.max(spent, proj),
    upcomingRecurring,
    upcoming,
    dailyRate,
    daysLeft,
    daysInMonth,
    elapsed,
    lastMonth,
    confidence: histDays >= 30 || elapsed >= 10 ? 'ok' : 'low',
    thisRate,
    histRate,
    histDays,
    weight,
    cap,
    oneOffs,
    variableSoFar,
    actualByDay,
    projectedByDay,
    lastMonthByDay,
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
    if (r.change && daysBetween(r.last, today) <= 45) {
      const c = r.change;
      const was = `${fmtCents(c.fromAmount)} ${cadenceLabel(c.fromCadence).toLowerCase()}`;
      const now = `${fmtCents(c.toAmount)} ${cadenceLabel(c.toCadence).toLowerCase()}`;
      const monthlyNow = r.monthly;
      const monthlyWas = c.fromAmount * (30.44 / ({ weekly: 7, biweekly: 14, monthly: 30.44, quarterly: 91.3, yearly: 365.25 }[c.fromCadence]));
      out.push({
        id: `change-${r.key}`,
        tone: 'info',
        recurringKey: r.key,
        title: `${r.name} changed`,
        detail: `${was} → ${now} (${monthlyNow >= monthlyWas ? '+' : '−'}${fmt(Math.abs(monthlyNow - monthlyWas))}/mo)`,
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

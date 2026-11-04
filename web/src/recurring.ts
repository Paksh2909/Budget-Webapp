// Recurring-charge detection (adaptive to recent changes), tracked bills, and expected charge dates.

import type { CategoryId } from './categories';
import { addDays, daysBetween, monthStart, today as todayFn, toDate } from './period';
import { matchText } from './rules';
import type { TrackedBill, Txn } from './types';

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

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

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

const CADENCES: { id: Cadence; period: number; min: number; max: number; label: string }[] = [
  { id: 'weekly', period: 7, min: 5, max: 9, label: 'Weekly' },
  { id: 'biweekly', period: 14, min: 12, max: 17, label: 'Every 2 weeks' },
  { id: 'monthly', period: 30.44, min: 26, max: 35, label: 'Monthly' },
  { id: 'quarterly', period: 91.3, min: 80, max: 100, label: 'Quarterly' },
  { id: 'yearly', period: 365.25, min: 350, max: 380, label: 'Yearly' },
];
export const cadenceLabel = (c: Cadence) => CADENCES.find((x) => x.id === c)!.label;
const cadenceFor = (days: number) => CADENCES.find((c) => days >= c.min && days <= c.max);

// Categories where a varying amount still means a real bill (utilities, insurance, payroll...).
const VARIABLE_OK = new Set<CategoryId>(['bills', 'housing', 'vehicle', 'health', 'investment', 'income']);

/** Schedule and amount come from the most recent charges, so changes are picked up within ~2 cycles. */
const RECENT_INTERVALS = 3;
const RECENT_AMOUNTS = 3;
const REGULARITY_INTERVALS = 5;

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
  /** Pattern shift vs. older history, e.g. $250 weekly → $400 every 2 weeks. */
  change?: { fromAmount: number; toAmount: number; fromCadence: Cadence; toCadence: Cadence };
  count: number;
  txnIds: Set<string>;
  accountId: string; // account the latest charge came from
  /** Set for bills you track by hand (e.g. rent); due somewhere in this day-of-month window. */
  trackedBillId?: string;
  window?: { dayStart: number; dayEnd: number };
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
    const recentIv = intervals.slice(-RECENT_INTERVALS);
    const cad = cadenceFor(median(recentIv));
    if (!cad) continue;
    if (cad.id !== 'yearly' && byDay.length < 3) continue; // need 3+ charges except for yearly
    const fits = (d: number, c: { period: number }) => Math.abs(d - c.period) <= Math.max(3, c.period * 0.25);
    // Regularity is checked over a slightly longer window than the cadence itself, so a merchant you
    // simply visit often (random gaps that happen to average a week) doesn't look like a subscription.
    const checkIv = intervals.slice(-REGULARITY_INTERVALS);
    let regular = checkIv.filter((d) => fits(d, cad)).length / checkIv.length >= 0.6;
    if (!regular) {
      // ...unless it's a clean schedule switch: the latest gaps all fit the new schedule and the
      // gaps before them consistently fit a different one (e.g. weekly → every 2 weeks).
      let run = 0;
      for (let i = intervals.length - 1; i >= 0 && fits(intervals[i]!, cad); i--) run++;
      const older = intervals.slice(0, intervals.length - run);
      const oldCad = older.length >= 2 ? cadenceFor(median(older)) : undefined;
      const olderTail = older.slice(-REGULARITY_INTERVALS);
      regular =
        run >= 2 && !!oldCad && oldCad.id !== cad.id && olderTail.filter((d) => fits(d, oldCad)).length / olderTail.length >= 0.6;
    }
    if (!regular) continue;

    const recentAmts = byDay.slice(-RECENT_AMOUNTS).map((c) => c.amount);
    const med = median(recentAmts);
    const within = (pct: number) => recentAmts.filter((a) => Math.abs(a - med) <= med * pct).length / recentAmts.length;
    const latest = byDay[byDay.length - 1]!;
    const cat = latest.latest.category;
    // "Fixed" also needs at least two recent charges at (nearly) the exact same amount, like a real
    // subscription or scheduled transfer, not just similar-sized purchases.
    const exactPair = recentAmts.some((a, i) => recentAmts.some((b, j) => i !== j && Math.abs(a - b) <= Math.max(0.5, a * 0.03)));
    const fixed = within(0.2) >= 0.6 && exactPair;
    const variable = !fixed && within(0.5) >= 0.6 && VARIABLE_OK.has(cat) && cad.period >= 28;
    if (!fixed && !variable) continue;

    const next = addDays(latest.date, Math.round(cad.period));
    const grace = Math.max(5, Math.round(cad.period * 0.3));
    const lateBy = daysBetween(next, today);
    if (lateBy > Math.round(cad.period) + grace) continue; // missed 2+ cycles: probably ended
    const status: Recurring['status'] = lateBy > grace ? 'late' : 'active';

    // Subscription-style price step: where did the current exact price start?
    const same = (a: number, b: number) => Math.abs(a - b) < Math.max(0.5, b * 0.02);
    let firstAtPrice = byDay.length - 1;
    while (firstAtPrice > 0 && same(byDay[firstAtPrice - 1]!.amount, latest.amount)) firstAtPrice--;
    const before = firstAtPrice > 0 ? byDay[firstAtPrice - 1]! : null;
    const priceChanged = fixed && before !== null && daysBetween(byDay[firstAtPrice]!.date, today) <= 75;
    const amount = fixed ? latest.amount : med;

    // Broader pattern change vs. older history. A schedule change wins over a plain price step,
    // so "$250 weekly → $400 every 2 weeks" isn't reported as just "up from $250".
    let change: Recurring['change'];
    let priceStep = priceChanged && before ? { from: before.amount, to: latest.amount } : undefined;
    const olderIv = intervals.slice(0, -RECENT_INTERVALS);
    const olderAmts = byDay.slice(0, -RECENT_AMOUNTS).map((c) => c.amount);
    if (olderIv.length >= 2 && olderAmts.length >= 2) {
      const oldCad = cadenceFor(median(olderIv)) ?? cad;
      const oldAmt = median(olderAmts);
      const amountMoved = Math.abs(oldAmt - amount) > Math.max(1, amount * 0.1);
      if (oldCad.id !== cad.id || (amountMoved && !priceStep)) {
        change = { fromAmount: oldAmt, toAmount: amount, fromCadence: oldCad.id, toCadence: cad.id };
        priceStep = undefined;
      }
    }

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
      priceChange: priceStep,
      change,
      count: byDay.length,
      txnIds: new Set(list.map((t) => t.id)),
      accountId: latest.latest.account_id,
    });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
/** Day `d` of month (y, m), clamped to the month's length (e.g. the 31st in February → the 28th). */
export const clampDay = (y: number, m: number, d: number) =>
  fmtDate(new Date(Date.UTC(y, m, Math.min(d, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()))));

/** Transactions a tracked bill matches: outgoing, description contains the pattern, from its account. */
export function billMatches(b: Pick<TrackedBill, 'pattern' | 'account_id'>, txns: Txn[]): Txn[] {
  const p = b.pattern.trim().toLowerCase();
  if (p.length < 2) return [];
  return txns
    .filter((t) => t.amount > 0 && !t.pending && matchText(t).includes(p) && (!b.account_id || t.account_id === b.account_id))
    .sort((x, y) => (x.date < y.date ? -1 : 1));
}

/** Bills you track by hand become recurring series with a day-of-month window (e.g. rent, 1st–5th). */
export function trackedRecurring(bills: TrackedBill[], txns: Txn[], today = todayFn()): Recurring[] {
  return bills.map((b) => {
    const matches = billMatches(b, txns);
    const latest = matches[matches.length - 1];
    const recent = matches.slice(-3).map((t) => t.amount);
    const amount = recent.length ? recent.reduce((s, a) => s + a, 0) / recent.length : 0;

    // The first window (this month or later) that hasn't been paid yet.
    const t = toDate(today);
    let next = '';
    let status: Recurring['status'] = 'active';
    for (let i = 0; i < 3 && !next; i++) {
      const y = t.getUTCFullYear();
      const m = t.getUTCMonth() + i;
      const ws = clampDay(y, m, b.day_start);
      const we = clampDay(y, m, b.day_end);
      const paid = matches.some((x) => x.date >= addDays(ws, -7) && x.date <= addDays(we, 7));
      if (paid) continue;
      next = ws;
      if (we < today) status = 'late';
    }
    return {
      key: `bill:${b.id}`,
      name: b.name,
      category: latest?.category ?? 'housing',
      kind: 'expense' as const,
      cadence: 'monthly' as const,
      period: 30.44,
      amount,
      variable: true,
      monthly: amount,
      last: latest?.date ?? addDays(next, -30),
      next,
      status,
      count: matches.length,
      txnIds: new Set(matches.map((x) => x.id)),
      accountId: b.account_id ?? latest?.account_id ?? '',
      trackedBillId: b.id,
      window: { dayStart: b.day_start, dayEnd: b.day_end },
    };
  });
}

/** Detected series plus tracked bills; a tracked bill replaces any detected series for the same charges. */
export function allRecurring(txns: Txn[], bills: TrackedBill[], today = todayFn()): Recurring[] {
  const tracked = trackedRecurring(bills, txns, today);
  const claimed = new Set<string>();
  tracked.forEach((r) => r.txnIds.forEach((id) => claimed.add(id)));
  const detected = detectRecurring(txns, today).filter((r) => ![...r.txnIds].some((id) => claimed.has(id)));
  return [...tracked, ...detected].sort((a, b) => b.monthly - a.monthly);
}

/** Expected charge dates for a series within [start, end). */
export function occurrencesIn(r: Recurring, start: string, end: string): string[] {
  const dates: string[] = [];
  if (r.window) {
    // Tracked bills: the start of each unpaid window (the earliest the money could leave).
    let m = toDate(monthStart(start));
    for (let i = 0; i < 24; i++) {
      const ws = clampDay(m.getUTCFullYear(), m.getUTCMonth(), r.window.dayStart);
      if (ws >= end) break;
      if (ws >= start && ws >= r.next) dates.push(ws);
      m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
    }
    return dates;
  }
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

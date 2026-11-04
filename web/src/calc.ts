import type { CategoryId } from './categories';
import { addDays, daysBetween, fmt, inRange, today, toDate, type Range } from './period';
import type { Account, Txn } from './types';

export const MANUAL_ACCOUNT_ID = 'cash';

const isLiability = (a: Account) => a.type === 'credit' || a.type === 'loan';

/** Signed balance as it contributes to net worth (credit cards / loans are negative). */
export function accountBalance(a: Account): number {
  const v = a.current_balance ?? 0;
  return isLiability(a) ? -v : v;
}

export const accountName = (a: Account) => a.display_name || a.name;

export function netWorth(accounts: Account[]): number {
  return accounts.filter((a) => !a.hidden).reduce((s, a) => s + accountBalance(a), 0);
}

/** Transactions on visible accounts (manual cash entries are always included). */
export function visibleTxns(txns: Txn[], accounts: Account[]): Txn[] {
  const hidden = new Set(accounts.filter((a) => a.hidden).map((a) => a.account_id));
  return txns.filter((t) => !hidden.has(t.account_id));
}

export const isTransfer = (t: Txn) => t.category === 'transfer';
export const isIncome = (t: Txn) => t.category === 'income';

export interface Cashflow {
  income: number;
  expense: number;
  net: number;
}

export function cashflow(txns: Txn[], r: Range): Cashflow {
  let income = 0;
  let expense = 0;
  for (const t of txns) {
    if (!inRange(t.date, r) || isTransfer(t)) continue;
    if (isIncome(t)) income += -t.amount;
    else expense += t.amount; // refunds (negative) reduce spending
  }
  return { income, expense, net: income - expense };
}

export interface CategoryTotal {
  id: CategoryId;
  total: number;
  share: number;
}

export function byCategory(txns: Txn[], r: Range, kind: 'expense' | 'income' = 'expense'): CategoryTotal[] {
  const totals = new Map<CategoryId, number>();
  for (const t of txns) {
    if (!inRange(t.date, r) || isTransfer(t)) continue;
    if (kind === 'income' ? !isIncome(t) : isIncome(t)) continue;
    const v = kind === 'income' ? -t.amount : t.amount;
    totals.set(t.category, (totals.get(t.category) ?? 0) + v);
  }
  const list = [...totals.entries()].filter(([, v]) => v > 0.005);
  const sum = list.reduce((s, [, v]) => s + v, 0);
  return list
    .map(([id, total]) => ({ id, total, share: sum ? total / sum : 0 }))
    .sort((a, b) => b.total - a.total);
}

function earliestDate(txns: Txn[]): string | null {
  let min: string | null = null;
  for (const t of txns) if (!min || t.date < min) min = t.date;
  return min;
}

/** Effective [first, last] days to chart for a range, clamped to today and to available data. */
export function chartBounds(txns: Txn[], r: Range): { first: string; last: string } | null {
  const t = today();
  const first = r.start ?? earliestDate(txns) ?? t;
  const last = r.end ? (addDays(r.end, -1) < t ? addDays(r.end, -1) : t) : t;
  return first > last ? null : { first, last };
}

/**
 * Reconstructs daily net worth by walking back from today's balances through posted transactions.
 * Investment market moves aren't in transaction data, so those balances are treated as flat.
 */
export function balanceSeries(accounts: Account[], txns: Txn[], r: Range) {
  const visible = accounts.filter((a) => !a.hidden);
  const ids = new Set(visible.map((a) => a.account_id));
  const relevant = txns
    .filter((t) => t.source === 'plaid' && !t.pending && ids.has(t.account_id))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const bounds = chartBounds(relevant, r);
  const now = netWorth(visible);
  if (!bounds) return { dates: [] as string[], values: [] as number[], baseline: now, current: now };

  const startBaseline = addDays(bounds.first, -1);
  const dates: string[] = [];
  const values: number[] = [];
  let acc = 0;
  let i = 0;
  let baseline = now;
  for (let d = today(); d >= startBaseline; d = addDays(d, -1)) {
    while (i < relevant.length && relevant[i]!.date > d) acc += relevant[i++]!.amount;
    const v = now + acc;
    if (d === startBaseline) baseline = v;
    else if (d <= bounds.last) {
      dates.push(d);
      values.push(v);
    }
  }
  dates.reverse();
  values.reverse();
  return { dates, values, baseline, current: values[values.length - 1] ?? now };
}

export type Granularity = 'day' | 'month';

export function flowSeries(txns: Txn[], r: Range, granularity: Granularity) {
  const bounds = chartBounds(txns, r);
  if (!bounds) return { keys: [] as string[], income: [] as number[], expense: [] as number[] };
  const keyOf = (d: string) => (granularity === 'day' ? d : d.slice(0, 7));
  const keys: string[] = [];
  if (granularity === 'day') {
    for (let d = bounds.first; d <= bounds.last; d = addDays(d, 1)) keys.push(d);
  } else {
    const s = toDate(bounds.first);
    const e = bounds.last.slice(0, 7);
    for (let y = s.getUTCFullYear(), m = s.getUTCMonth(); ; m++) {
      const k = fmt(new Date(Date.UTC(y, m, 1))).slice(0, 7);
      if (k > e) break;
      keys.push(k);
    }
  }
  const idx = new Map(keys.map((k, i) => [k, i]));
  const income = new Array<number>(keys.length).fill(0);
  const expense = new Array<number>(keys.length).fill(0);
  for (const t of txns) {
    if (!inRange(t.date, r) || isTransfer(t)) continue;
    const i = idx.get(keyOf(t.date));
    if (i === undefined) continue;
    if (isIncome(t)) income[i]! += -t.amount;
    else expense[i]! += t.amount;
  }
  return { keys, income, expense };
}

export function averages(txns: Txn[], r: Range) {
  const bounds = chartBounds(txns, r);
  const days = bounds ? daysBetween(bounds.first, bounds.last) + 1 : 1;
  const cf = cashflow(txns, r);
  const perDay = (v: number) => v / Math.max(days, 1);
  return {
    day: { income: perDay(cf.income), expense: perDay(cf.expense) },
    week: { income: perDay(cf.income) * 7, expense: perDay(cf.expense) * 7 },
    month: { income: perDay(cf.income) * 30.437, expense: perDay(cf.expense) * 30.437 },
  };
}

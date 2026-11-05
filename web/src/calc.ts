import type { CategoryId } from './categories';
import { addDays, daysBetween, fmt, inRange, today, toDate, type Range } from './period';
import type { Account, BalanceSnapshot, Txn } from './types';

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
 * Daily net worth, per account:
 *  - on days with a recorded snapshot, that real balance is used (this captures market moves,
 *    interest, and anything else that doesn't show up as a transaction);
 *  - between snapshots and before the first one, the balance is reconstructed by walking back
 *    from the next known balance (snapshot, or today's balance) through posted transactions.
 */
export function balanceSeries(accounts: Account[], txns: Txn[], r: Range, snapshots: BalanceSnapshot[] = []) {
  const visible = accounts.filter((a) => !a.hidden);
  const ids = new Set(visible.map((a) => a.account_id));
  const relevant = txns.filter((t) => t.source === 'plaid' && !t.pending && ids.has(t.account_id));
  const snaps = snapshots.filter((s) => ids.has(s.account_id));
  const firstSnap = snaps.reduce<string | null>((m, s) => (!m || s.date < m ? s.date : m), null);
  // The chart can start at the earliest transaction or snapshot.
  const bounds = chartBounds(
    firstSnap ? [...relevant, { date: firstSnap } as Txn] : relevant,
    r,
  );
  const now = netWorth(visible);
  if (!bounds) return { dates: [] as string[], values: [] as number[], baseline: now, current: now, firstSnapshot: firstSnap };

  const t = today();
  const startBaseline = addDays(bounds.first, -1);
  const span = daysBetween(startBaseline, t) + 1; // index 0 = today, going back
  const total = new Array<number>(span).fill(0);

  // Per-account: transaction effect by date and snapshots by date (both signed for net worth).
  const txByAcct = new Map<string, Map<string, number>>();
  for (const x of relevant) {
    const m = txByAcct.get(x.account_id) ?? new Map<string, number>();
    m.set(x.date, (m.get(x.date) ?? 0) + x.amount);
    txByAcct.set(x.account_id, m);
  }
  const snapByAcct = new Map<string, Map<string, number>>();
  for (const s of snaps) {
    const m = snapByAcct.get(s.account_id) ?? new Map<string, number>();
    m.set(s.date, s.current_balance);
    snapByAcct.set(s.account_id, m);
  }

  for (const a of visible) {
    const sign = isLiability(a) ? -1 : 1;
    const tx = txByAcct.get(a.account_id);
    const sn = snapByAcct.get(a.account_id);
    let v = accountBalance(a); // today
    let d = t;
    for (let i = 0; i < span; i++) {
      if (i > 0) {
        // Step back one day: undo what posted on the day after.
        const next = d;
        d = addDays(d, -1);
        v += tx?.get(next) ?? 0;
      }
      const snap = sn?.get(d);
      if (snap !== undefined && d !== t) v = sign * snap;
      total[i]! += v;
    }
  }

  const dates: string[] = [];
  const values: number[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const d = addDays(t, -i);
    if (d >= bounds.first && d <= bounds.last) {
      dates.push(d);
      values.push(total[i]!);
    }
  }
  return {
    dates,
    values,
    baseline: total[span - 1]!,
    current: values[values.length - 1] ?? now,
    firstSnapshot: firstSnap,
  };
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

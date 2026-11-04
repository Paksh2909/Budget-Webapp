// "Can I cover it?": will the bill-pay account (e.g. Amex HYSA) cover upcoming card payments,
// rent and investments over the next 30 days?

import { accountName } from './calc';
import { addDays, daysBetween, today as todayFn, toDate } from './period';
import { clampDay, median, occurrencesIn, type Recurring } from './recurring';
import type { Account, AppData, CardStatement, Txn } from './types';

export const HORIZON_DAYS = 30;
export const DEFAULT_CUSHION = 500;

export type CoverageEventKind = 'card' | 'bill' | 'recurring' | 'deposit';

export interface CoverageEvent {
  date: string;
  name: string;
  amount: number; // positive = money out, negative = money in
  kind: CoverageEventKind;
  /** How sure we are: 'statement' = from your card statement; 'estimate' = from history. */
  source: 'statement' | 'tracked' | 'detected' | 'estimate';
  detail: string;
  late?: boolean;
}

export interface Coverage {
  account: Account | null;
  accountAuto: boolean; // picked automatically (not set in settings)
  start: number;
  cushion: number;
  events: CoverageEvent[];
  endBalance: number;
  low: { balance: number; date: string };
  status: 'ok' | 'tight' | 'short';
  /** Running balance per day from today (index 0) to the horizon, for the chart. */
  daily: number[];
  cardsWithoutStatements: number;
}

const PAYMENT_TEXT = /\b(payment|pymt|autopay|auto pay|epay|e-pay|thank you|card)\b/i;

/** Card-payment-like transfers leaving a cash account (how the bills actually get paid). */
function isCardPaymentOut(t: Txn): boolean {
  return t.category === 'transfer' && t.amount > 0 && PAYMENT_TEXT.test(`${t.merchant_name ?? ''} ${t.name}`);
}

/** The account card payments come from most often in the last 120 days; else the biggest cash account. */
export function guessBillPayAccount(accounts: Account[], txns: Txn[], today = todayFn()): Account | null {
  const cash = accounts.filter((a) => a.type === 'depository' && !a.hidden);
  const since = addDays(today, -120);
  const counts = new Map<string, number>();
  for (const t of txns) if (t.date >= since && isCardPaymentOut(t)) counts.set(t.account_id, (counts.get(t.account_id) ?? 0) + 1);
  const best = cash.filter((a) => counts.has(a.account_id)).sort((a, b) => counts.get(b.account_id)! - counts.get(a.account_id)!)[0];
  return best ?? [...cash].sort((a, b) => (b.current_balance ?? 0) - (a.current_balance ?? 0))[0] ?? null;
}

/** Payments made to a card (money coming in on the card's side) on or after a date. */
function paidSince(cardId: string, txns: Txn[], from: string): number {
  return txns
    .filter((t) => t.account_id === cardId && t.amount < 0 && t.date > from && t.category === 'transfer')
    .reduce((s, t) => s - t.amount, 0);
}

function cardEvents(card: Account, stmt: CardStatement | undefined, txns: Txn[], today: string, end: string): CoverageEvent[] {
  const name = accountName(card);
  const fmtShort = (d: string) => toDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  if (stmt?.next_payment_due_date && stmt.last_statement_balance !== null) {
    const issued = stmt.last_statement_issue_date ?? addDays(stmt.next_payment_due_date, -25);
    const paid = paidSince(card.account_id, txns, issued);
    const remaining = Math.max(0, stmt.last_statement_balance - paid);
    const out: CoverageEvent[] = [];
    if (remaining >= 1) {
      const due = stmt.next_payment_due_date;
      if (due < end) {
        out.push({
          date: due < today ? today : due,
          name,
          amount: remaining,
          kind: 'card',
          source: 'statement',
          late: due < today || !!stmt.is_overdue,
          detail:
            paid > 0
              ? `Statement ${fmtMoney(stmt.last_statement_balance)} − ${fmtMoney(paid)} paid · due ${fmtShort(due)}`
              : `Statement balance · due ${fmtShort(due)}`,
        });
      }
    } else {
      // This statement is paid. The next one closes about a month after the last; charges since
      // then (the current balance) are the best estimate, due ~1 month after this due date.
      const nextDue = addDays(stmt.next_payment_due_date, 30);
      const estimate = Math.max(0, card.current_balance ?? 0);
      if (nextDue < end && nextDue >= today && estimate >= 1) {
        out.push({ date: nextDue, name, amount: estimate, kind: 'card', source: 'estimate', detail: `Next statement (est. from current balance) · ~${fmtShort(nextDue)}` });
      }
    }
    return out;
  }

  // No statement data: estimate from the current balance and the usual payment day.
  const balance = Math.max(0, card.current_balance ?? 0);
  if (balance < 1) return [];
  const payDays = txns
    .filter((t) => t.account_id === card.account_id && t.amount < 0 && t.category === 'transfer')
    .map((t) => toDate(t.date).getUTCDate());
  const t = toDate(today);
  let date = addDays(today, HORIZON_DAYS - 1);
  let detail = 'Current balance · due date unknown (allow statement access for exact dates)';
  if (payDays.length >= 2) {
    const day = Math.round(median(payDays));
    let d = clampDay(t.getUTCFullYear(), t.getUTCMonth(), day);
    if (d < today) d = clampDay(t.getUTCFullYear(), t.getUTCMonth() + 1, day);
    date = d;
    detail = `Current balance · usually paid around the ${ordinal(day)}`;
  }
  return date < end ? [{ date, name, amount: balance, kind: 'card', source: 'estimate', detail }] : [];
}

const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10] ?? 'th');
const fmtMoney = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function computeCoverage(data: AppData, txns: Txn[], recurring: Recurring[], today = todayFn()): Coverage {
  const accounts = data.accounts;
  const chosen = data.settings.billPayAccount ? accounts.find((a) => a.account_id === data.settings.billPayAccount) : undefined;
  const account = chosen ?? guessBillPayAccount(accounts, txns, today);
  const cushion = data.settings.cushion ?? DEFAULT_CUSHION;
  const end = addDays(today, HORIZON_DAYS + 1);
  const start = account ? (account.available_balance ?? account.current_balance ?? 0) : 0;

  const events: CoverageEvent[] = [];
  const statements = new Map(data.statements.map((s) => [s.account_id, s]));
  const cards = accounts.filter((a) => a.type === 'credit' && !a.hidden);
  for (const card of cards) events.push(...cardEvents(card, statements.get(card.account_id), txns, today, end));

  if (account) {
    // Bills and recurring charges paid from this account; recurring deposits into it.
    for (const r of recurring) {
      if (r.accountId !== account.account_id) continue;
      if (r.status === 'late' && !r.trackedBillId) continue; // probably cancelled
      for (const date of occurrencesIn(r, addDays(today, -31), end)) {
        const when = date < today ? today : date;
        if (r.kind === 'income') {
          if (date < today) continue; // a missed deposit isn't counted on
          events.push({ date: when, name: r.name, amount: -r.amount, kind: 'deposit', source: 'detected', detail: 'Recurring deposit' });
        } else {
          const tracked = !!r.trackedBillId;
          const detail = tracked
            ? `Usually ${ordinal(r.window!.dayStart)}–${ordinal(r.window!.dayEnd)} · avg of recent payments`
            : `${r.variable ? 'About ' : ''}${fmtMoney(r.amount)} ${r.cadence}`;
          events.push({
            date: when,
            name: r.name,
            amount: r.amount,
            kind: tracked ? 'bill' : 'recurring',
            source: tracked ? 'tracked' : 'detected',
            detail,
            late: date < today,
          });
        }
      }
    }
  }

  events.sort((a, b) => (a.date === b.date ? b.amount - a.amount : a.date < b.date ? -1 : 1));

  // Running balance by day.
  const daily: number[] = [];
  let bal = start;
  let low = { balance: start, date: today };
  for (let d = 0; d <= HORIZON_DAYS; d++) {
    const date = addDays(today, d);
    for (const e of events) if (e.date === date) bal -= e.amount;
    daily.push(bal);
    if (bal < low.balance) low = { balance: bal, date };
  }
  const status: Coverage['status'] = low.balance < 0 ? 'short' : low.balance < cushion ? 'tight' : 'ok';

  return {
    account: account ?? null,
    accountAuto: !chosen,
    start,
    cushion,
    events,
    endBalance: bal,
    low,
    status,
    daily,
    cardsWithoutStatements: cards.filter((c) => !statements.get(c.account_id)?.next_payment_due_date).length,
  };
}

export const daysFromToday = (d: string, today = todayFn()) => daysBetween(today, d);

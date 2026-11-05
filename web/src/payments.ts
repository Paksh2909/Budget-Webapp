// Pairs a card payment leaving a cash account (e.g. "AMEX EPAYMENT" out of the HYSA) with the
// card's "payment received" for the same amount a few days later.

import { addDays, daysBetween } from './period';
import type { Account, Item, Txn } from './types';

export const MATCH_WINDOW_DAYS = 5;
const PAYMENT_TEXT = /\b(payment|pymt|pmt|autopay|auto pay|epay|e-pay|thank you|card|crd)\b/i;

/** Map of transaction id → id of its paired transaction (both directions). */
export function matchCardPayments(txns: Txn[], accounts: Account[]): Map<string, string> {
  const type = new Map(accounts.map((a) => [a.account_id, a.type]));
  // Cash side: money out of a checking/savings account. Card side: money into a credit card.
  const outs = txns.filter((t) => t.amount > 0 && type.get(t.account_id) === 'depository' && t.source === 'plaid');
  const ins = txns.filter((t) => t.amount < 0 && type.get(t.account_id) === 'credit' && t.source === 'plaid');
  const insByCents = new Map<number, Txn[]>();
  for (const t of ins) {
    const k = Math.round(-t.amount * 100);
    if (!insByCents.has(k)) insByCents.set(k, []);
    insByCents.get(k)!.push(t);
  }

  // Candidate pairs, best (closest dates, payment-looking text) first, then taken greedily so each
  // transaction is used once.
  const candidates: { out: Txn; inn: Txn; score: number }[] = [];
  for (const out of outs) {
    for (const inn of insByCents.get(Math.round(out.amount * 100)) ?? []) {
      const gap = daysBetween(out.date, inn.date); // card side usually posts same day or a bit later
      if (gap < -2 || gap > MATCH_WINDOW_DAYS) continue;
      const looksLikePayment = PAYMENT_TEXT.test(`${out.merchant_name ?? ''} ${out.name}`) || out.category === 'transfer';
      candidates.push({ out, inn, score: Math.abs(gap) + (looksLikePayment ? 0 : 10) });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  const pair = new Map<string, string>();
  for (const c of candidates) {
    if (pair.has(c.out.id) || pair.has(c.inn.id)) continue;
    pair.set(c.out.id, c.inn.id);
    pair.set(c.inn.id, c.out.id);
  }
  return pair;
}

/** Matched payments always count as transfers, unless you picked a category by hand. */
export function applyPaymentMatches(txns: Txn[], accounts: Account[]): Txn[] {
  const pair = matchCardPayments(txns, accounts);
  if (!pair.size) return txns;
  return txns.map((t) => {
    const partner = pair.get(t.id);
    if (!partner) return t;
    const forced = t.cat_overridden ? {} : { category: 'transfer' as const, subcategory: 'Credit Card Payment' };
    return { ...t, ...forced, matched_with: partner };
  });
}

// Keywords that tie a payment's description to a card issuer, for payments still in transit.
const ISSUER_ALIASES: Record<string, string[]> = {
  'american express': ['amex', 'american express'],
  'capital one': ['capital one', 'capone', 'cap one'],
  chase: ['chase'],
  citi: ['citi', 'citibank'],
  discover: ['discover'],
  'bank of america': ['bank of america', 'bofa', 'bk of amer'],
  'wells fargo': ['wells fargo'],
  'u.s. bank': ['us bank', 'u.s. bank', 'usbank'],
  barclays: ['barclay'],
  bilt: ['bilt'],
  apple: ['apple card', 'gs bank', 'goldman'],
};

function issuerKeywords(institution: string | null): string[] {
  const name = (institution ?? '').toLowerCase();
  for (const [k, v] of Object.entries(ISSUER_ALIASES)) if (name.includes(k)) return v;
  const first = name.split(/\s+/)[0];
  return first && first.length >= 4 ? [first] : [];
}

export interface InTransit {
  out: Txn;
  cardId: string;
}

/**
 * Card payments that have left the cash account but haven't shown up on the card yet. Attributed
 * to a card by issuer name in the description; when an issuer has several cards, the amount must
 * equal that card's remaining statement balance.
 */
export function paymentsInTransit(
  txns: Txn[],
  accounts: Account[],
  items: Item[],
  remainingByCard: Map<string, number>,
  today: string,
): InTransit[] {
  const since = addDays(today, -MATCH_WINDOW_DAYS);
  const institution = new Map(items.map((i) => [i.item_id, i.institution_name]));
  const cards = accounts.filter((a) => a.type === 'credit' && !a.hidden);
  const cash = new Set(accounts.filter((a) => a.type === 'depository').map((a) => a.account_id));
  const out: InTransit[] = [];
  for (const t of txns) {
    if (t.matched_with || t.date < since || t.amount <= 0 || !cash.has(t.account_id)) continue;
    const text = `${t.merchant_name ?? ''} ${t.name}`.toLowerCase();
    if (!PAYMENT_TEXT.test(text)) continue;
    const candidates = cards.filter((c) => issuerKeywords(institution.get(c.item_id) ?? null).some((k) => text.includes(k)));
    const exact = candidates.filter((c) => Math.abs((remainingByCard.get(c.account_id) ?? -1) - t.amount) < 0.01);
    const card = candidates.length === 1 ? candidates[0] : exact.length === 1 ? exact[0] : undefined;
    if (card) out.push({ out: t, cardId: card.account_id });
  }
  return out;
}

import type { CategoryId } from './categories';
import type { Txn } from './types';

export type TxnType = 'income' | 'expense' | 'transfer';

export interface Filters {
  types: TxnType[]; // empty = all types
  accounts: string[]; // empty = all accounts
  categories: CategoryId[]; // whole categories
  subcategories: string[]; // "category::Subcategory" keys
}

export const EMPTY_FILTERS: Filters = { types: [], accounts: [], categories: [], subcategories: [] };

export const subKey = (category: string, sub: string) => `${category}::${sub}`;

export function txnType(t: Txn): TxnType {
  if (t.category === 'transfer') return 'transfer';
  if (t.category === 'income') return 'income';
  return 'expense';
}

export function isFiltered(f: Filters): boolean {
  return f.types.length > 0 || f.accounts.length > 0 || f.categories.length > 0 || f.subcategories.length > 0;
}

export function applyFilters(txns: Txn[], f: Filters): Txn[] {
  if (!isFiltered(f)) return txns;
  const types = new Set(f.types);
  const accounts = new Set(f.accounts);
  const cats = new Set<string>(f.categories);
  const subs = new Set(f.subcategories);
  const anyCat = cats.size > 0 || subs.size > 0;
  return txns.filter((t) => {
    if (types.size && !types.has(txnType(t))) return false;
    if (accounts.size && !accounts.has(t.account_id)) return false;
    if (anyCat && !cats.has(t.category) && !(t.subcategory && subs.has(subKey(t.category, t.subcategory)))) return false;
    return true;
  });
}

export function filterSummary(f: Filters): string {
  const parts: string[] = [];
  if (f.types.length) parts.push(f.types.map((t) => (t === 'expense' ? 'Expenses' : t === 'income' ? 'Income' : 'Transfers')).join(', '));
  if (f.accounts.length) parts.push(`${f.accounts.length} account${f.accounts.length > 1 ? 's' : ''}`);
  const c = f.categories.length + f.subcategories.length;
  if (c) parts.push(`${c} categor${c > 1 ? 'ies' : 'y'}`);
  return parts.join(' · ');
}

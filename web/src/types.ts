import type { CategoryId } from './categories';

export interface Item {
  item_id: string;
  institution_name: string | null;
  status: 'ok' | 'login_required' | 'error';
  error_code: string | null;
  last_synced_at: string | null;
}

export interface Account {
  account_id: string;
  item_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: 'depository' | 'credit' | 'loan' | 'investment' | 'other' | string;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  currency: string | null;
  display_name: string | null;
  hidden: number;
}

/** amount uses Plaid's sign: positive = money out, negative = money in. */
export interface Txn {
  id: string;
  account_id: string;
  amount: number;
  date: string;
  datetime: string | null;
  name: string;
  merchant_name: string | null;
  logo_url: string | null;
  pending: number;
  category: CategoryId;
  auto_category: CategoryId;
  overridden: number;
  subcategory: string | null; // effective (user override or Plaid)
  auto_subcategory: string | null; // Plaid's
  note: string | null;
  source: 'plaid' | 'manual';
  cat_overridden: number; // user picked the category by hand
  sub_overridden: number; // user picked the subcategory by hand
  rule_id?: string; // set when an auto-categorize rule decided the category
}

export interface Rule {
  id: string;
  pattern: string;
  category: CategoryId;
  subcategory: string | null;
}

export interface Budget {
  id: string;
  name: string;
  amount: number;
  categories: CategoryId[];
}

export interface AppData {
  items: Item[];
  accounts: Account[];
  transactions: Txn[];
  budgets: Budget[];
  rules: Rule[];
}

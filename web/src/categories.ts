import {
  ArrowLeftRight,
  Banknote,
  Calculator,
  Car,
  Ellipsis,
  HeartPulse,
  House,
  Infinity as InfinityIcon,
  Plane,
  ShoppingBag,
  Sparkles,
  BusFront,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';

// Keep ids in sync with worker/src/categories.ts.
export type CategoryId =
  | 'food'
  | 'shopping'
  | 'housing'
  | 'transport'
  | 'vehicle'
  | 'lifestyle'
  | 'health'
  | 'travel'
  | 'bills'
  | 'investment'
  | 'income'
  | 'transfer'
  | 'other';

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  color: string;
  icon: LucideIcon;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: 'food', label: 'Food & Drinks', color: '#e5584f', icon: UtensilsCrossed },
  { id: 'shopping', label: 'Shopping', color: '#e0457b', icon: ShoppingBag },
  { id: 'housing', label: 'Housing', color: '#6366f1', icon: House },
  { id: 'transport', label: 'Transport', color: '#1e90b0', icon: BusFront },
  { id: 'vehicle', label: 'Vehicle', color: '#9d4edd', icon: Car },
  { id: 'lifestyle', label: 'Lifestyle', color: '#e6499c', icon: Sparkles },
  { id: 'health', label: 'Health', color: '#14b8a6', icon: HeartPulse },
  { id: 'travel', label: 'Travel', color: '#f59e0b', icon: Plane },
  { id: 'bills', label: 'Bills', color: '#16a34a', icon: Calculator },
  { id: 'investment', label: 'Investment', color: '#d946ef', icon: InfinityIcon },
  { id: 'income', label: 'Income', color: '#22c55e', icon: Banknote },
  { id: 'transfer', label: 'Transfer', color: '#64748b', icon: ArrowLeftRight },
  { id: 'other', label: 'Other', color: '#55657e', icon: Ellipsis },
];

const BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, CategoryMeta>;

export function category(id: string): CategoryMeta {
  return BY_ID[id as CategoryId] ?? BY_ID.other;
}

/** Suggested subcategories; merged with whatever subcategories appear in your data. */
export const DEFAULT_SUBCATEGORIES: Record<CategoryId, string[]> = {
  food: ['Restaurant', 'Coffee', 'Groceries', 'Fast Food', 'Snacks', 'Alcohol and Bars'],
  shopping: ['Clothing and Accessories', 'Electronics', 'Online Marketplaces', 'Gifts', 'Home Goods'],
  housing: ['Rent', 'Mortgage', 'Maintenance', 'Furniture', 'Home Insurance'],
  transport: ['Public Transit', 'Taxis and Ride Shares', 'Long Distance'],
  vehicle: ['Gas', 'Parking', 'Maintenance', 'Insurance', 'Car Payment'],
  lifestyle: ['Entertainment', 'Sports', 'Hobbies', 'Personal Care', 'Music and Audio'],
  health: ['Pharmacy', 'Doctor', 'Dental', 'Fitness'],
  travel: ['Flights', 'Lodging', 'Rental Cars', 'Trips and Holidays'],
  bills: ['Mobile', 'Internet', 'Subscriptions', 'Utilities', 'Insurance', 'Taxes'],
  investment: ['Brokerage', 'Retirement', 'Crypto'],
  income: ['Salary', 'Refunds', 'Interest', 'Dividends', 'Other'],
  transfer: ['Credit Card Payment', 'Between Accounts'],
  other: [],
};

/** Categories a budget can track (spending only). */
export const EXPENSE_CATEGORIES = CATEGORIES.filter((c) => c.id !== 'income' && c.id !== 'transfer');

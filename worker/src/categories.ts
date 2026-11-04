// Maps Plaid personal_finance_category values to the app's categories.
// Keep CATEGORY_IDS in sync with web/src/categories.ts.

export const CATEGORY_IDS = [
  'food',
  'shopping',
  'housing',
  'transport',
  'vehicle',
  'lifestyle',
  'health',
  'travel',
  'bills',
  'investment',
  'income',
  'transfer',
  'other',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export function isCategoryId(v: unknown): v is CategoryId {
  return typeof v === 'string' && (CATEGORY_IDS as readonly string[]).includes(v);
}

const PRIMARY_MAP: Record<string, CategoryId> = {
  INCOME: 'income',
  TRANSFER_IN: 'transfer',
  TRANSFER_OUT: 'transfer',
  LOAN_PAYMENTS: 'bills',
  BANK_FEES: 'bills',
  ENTERTAINMENT: 'lifestyle',
  FOOD_AND_DRINK: 'food',
  GENERAL_MERCHANDISE: 'shopping',
  HOME_IMPROVEMENT: 'housing',
  MEDICAL: 'health',
  PERSONAL_CARE: 'lifestyle',
  GENERAL_SERVICES: 'bills',
  GOVERNMENT_AND_NON_PROFIT: 'other',
  TRANSPORTATION: 'transport',
  TRAVEL: 'travel',
  RENT_AND_UTILITIES: 'bills',
  OTHER: 'other',
};

const DETAILED_MAP: Record<string, CategoryId> = {
  TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS: 'investment',
  TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS: 'transfer',
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: 'transfer', // avoid double counting card spend
  LOAN_PAYMENTS_CAR_PAYMENT: 'vehicle',
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: 'housing',
  RENT_AND_UTILITIES_RENT: 'housing',
  TRANSPORTATION_GAS: 'vehicle',
  TRANSPORTATION_PARKING: 'vehicle',
  TRANSPORTATION_TOLLS: 'vehicle',
};

const SMALL_WORDS = new Set(['and', 'or', 'of', 'the', 'to', 'for']);

function prettify(primary: string, detailed: string): string | null {
  const rest = detailed.startsWith(primary + '_') ? detailed.slice(primary.length + 1) : detailed;
  if (!rest || rest === 'OTHER' || rest.startsWith('OTHER_')) return null;
  return rest
    .toLowerCase()
    .split('_')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function mapCategory(pfc: { primary: string; detailed: string } | null): {
  category: CategoryId;
  subcategory: string | null;
} {
  if (!pfc) return { category: 'other', subcategory: null };
  const category = DETAILED_MAP[pfc.detailed] ?? PRIMARY_MAP[pfc.primary] ?? 'other';
  return { category, subcategory: prettify(pfc.primary, pfc.detailed) };
}

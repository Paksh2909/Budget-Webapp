import type { Rule, Txn } from './types';

/** Text a rule's pattern is matched against (case-insensitive "contains"). */
export const matchText = (t: Pick<Txn, 'merchant_name' | 'name'>) => `${t.merchant_name ?? ''} ${t.name}`.toLowerCase();

/** Longest pattern wins, so "costco gas" beats "costco". */
export function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => b.pattern.length - a.pattern.length);
}

export function findRule(t: Pick<Txn, 'merchant_name' | 'name'>, sorted: Rule[]): Rule | undefined {
  const text = matchText(t);
  return sorted.find((r) => text.includes(r.pattern.toLowerCase()));
}

/**
 * Applies rules to transactions the user hasn't categorized by hand.
 * The rule's category becomes the transaction's "automatic" category, so the edit sheet treats it
 * as the default (choosing it again just follows the rule; Reset goes back to the rule).
 */
export function applyRules(txns: Txn[], rules: Rule[]): Txn[] {
  if (!rules.length) return txns;
  const sorted = sortRules(rules);
  return txns.map((t) => {
    if (t.cat_overridden) return t;
    const r = findRule(t, sorted);
    if (!r) return t;
    const sameCategory = r.category === t.auto_category;
    // Keep a hand-picked subcategory; otherwise use the rule's, or Plaid's if the category didn't change.
    const autoSub = r.subcategory ?? (sameCategory ? t.auto_subcategory : null);
    return {
      ...t,
      category: r.category,
      auto_category: r.category,
      auto_subcategory: autoSub,
      subcategory: t.sub_overridden ? t.subcategory : autoSub,
      rule_id: r.id,
    };
  });
}

/** Suggested pattern for "always categorize like this": the merchant, else the cleaned description. */
export function suggestPattern(t: Pick<Txn, 'merchant_name' | 'name'>): string {
  if (t.merchant_name) return t.merchant_name.trim().slice(0, 80);
  return t.name
    .replace(/[#*]?\d{3,}.*$/, '') // drop store numbers / reference ids
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

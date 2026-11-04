import { Check, ChevronDown, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { accountBalance, accountName, MANUAL_ACCOUNT_ID } from '../calc';
import { CATEGORIES, type CategoryId } from '../categories';
import { useData } from '../data';
import { EMPTY_FILTERS, subKey, type Filters, type TxnType } from '../filters';
import { money } from '../format';
import { AccountIcon, CategoryIcon, Sheet } from './ui';

const TYPES: { value: TxnType; label: string }[] = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expenses' },
  { value: 'transfer', label: 'Transfers' },
];

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Checkbox({ checked, partial = false }: { checked: boolean; partial?: boolean }) {
  return (
    <span className={'checkbox' + (checked ? ' on' : partial ? ' partial' : '')} aria-hidden="true">
      {checked && <Check size={18} strokeWidth={3} />}
      {!checked && partial && <span className="partial-bar" />}
    </span>
  );
}

export function FiltersSheet({ onClose, showTypes = true }: { onClose: () => void; showTypes?: boolean }) {
  const { data, filters, setFilters } = useData();
  const [draft, setDraft] = useState<Filters>(filters);
  const [tab, setTab] = useState<'accounts' | 'categories'>('accounts');
  const [expanded, setExpanded] = useState<CategoryId | null>(null);

  const accounts = data?.accounts ?? [];
  const hasCash = useMemo(() => (data?.transactions ?? []).some((t) => t.account_id === MANUAL_ACCOUNT_ID), [data]);

  // Subcategories that actually appear in your transactions, per category.
  const subsByCat = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const t of data?.transactions ?? []) {
      if (!t.subcategory) continue;
      if (!m.has(t.category)) m.set(t.category, new Set());
      m.get(t.category)!.add(t.subcategory);
    }
    return m;
  }, [data]);

  const toggleCategory = (id: CategoryId) => {
    const on = draft.categories.includes(id);
    setDraft({
      ...draft,
      categories: toggle(draft.categories, id),
      // Selecting the whole category supersedes individual subcategories.
      subcategories: on ? draft.subcategories : draft.subcategories.filter((k) => !k.startsWith(id + '::')),
    });
  };

  const toggleSub = (id: CategoryId, sub: string) => {
    const key = subKey(id, sub);
    if (draft.categories.includes(id)) {
      // Turning one sub off within a fully-selected category: switch to "all other subs".
      const others = [...(subsByCat.get(id) ?? [])].filter((s) => s !== sub).map((s) => subKey(id, s));
      setDraft({ ...draft, categories: draft.categories.filter((c) => c !== id), subcategories: [...draft.subcategories, ...others] });
    } else {
      setDraft({ ...draft, subcategories: toggle(draft.subcategories, key) });
    }
  };

  return (
    <Sheet
      title="Filters"
      full
      onClose={onClose}
      headerAction={
        <button className="btn ghost small" onClick={() => setDraft(EMPTY_FILTERS)}>
          Reset
        </button>
      }
    >
      {showTypes && (
        <div className="segmented multi" role="group" aria-label="Transaction types">
          {TYPES.map((t) => (
            <button
              key={t.value}
              aria-pressed={draft.types.includes(t.value)}
              className={draft.types.includes(t.value) ? 'active' : ''}
              onClick={() => setDraft({ ...draft, types: toggle(draft.types, t.value) })}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="tabs" role="tablist">
        {(['accounts', 'categories'] as const).map((t) => {
          const count = t === 'accounts' ? draft.accounts.length : draft.categories.length + draft.subcategories.length;
          return (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'accounts' ? 'Accounts' : 'Categories'}
              {count > 0 && <span className="tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'accounts' ? (
        <ul className="check-list" role="list">
          {accounts.map((a) => {
            const on = draft.accounts.includes(a.account_id);
            return (
              <li key={a.account_id}>
                <button className="check-row" role="checkbox" aria-checked={on} onClick={() => setDraft({ ...draft, accounts: toggle(draft.accounts, a.account_id) })}>
                  <AccountIcon account={a} size={40} />
                  <span className="check-text">
                    <span>{accountName(a)}</span>
                    <span className="muted">{money(accountBalance(a))}</span>
                  </span>
                  <Checkbox checked={on} />
                </button>
              </li>
            );
          })}
          {hasCash && (
            <li>
              <button
                className="check-row"
                role="checkbox"
                aria-checked={draft.accounts.includes(MANUAL_ACCOUNT_ID)}
                onClick={() => setDraft({ ...draft, accounts: toggle(draft.accounts, MANUAL_ACCOUNT_ID) })}
              >
                <span className="acct-icon" style={{ background: '#16a34a', width: 40, height: 40 }} aria-hidden="true">
                  <Wallet size={20} color="#fff" />
                </span>
                <span className="check-text">
                  <span>Cash</span>
                  <span className="muted">Manual entries</span>
                </span>
                <Checkbox checked={draft.accounts.includes(MANUAL_ACCOUNT_ID)} />
              </button>
            </li>
          )}
          {!accounts.length && !hasCash && <li className="empty">No accounts yet.</li>}
        </ul>
      ) : (
        <ul className="check-list" role="list">
          {CATEGORIES.map((c) => {
            const on = draft.categories.includes(c.id);
            const subs = [...(subsByCat.get(c.id) ?? [])].sort();
            const someSubs = draft.subcategories.some((k) => k.startsWith(c.id + '::'));
            const open = expanded === c.id;
            return (
              <li key={c.id}>
                <div className="check-row-wrap">
                  <button className="check-row" role="checkbox" aria-checked={on ? true : someSubs ? 'mixed' : false} onClick={() => toggleCategory(c.id)}>
                    <CategoryIcon id={c.id} size={40} />
                    <span className="check-text">
                      <span>{c.label}</span>
                      {subs.length > 0 && <span className="muted small">{subs.length} subcategor{subs.length === 1 ? 'y' : 'ies'}</span>}
                    </span>
                    <Checkbox checked={on} partial={someSubs} />
                  </button>
                  {subs.length > 0 && (
                    <button
                      className={'icon-btn expand' + (open ? ' open' : '')}
                      onClick={() => setExpanded(open ? null : c.id)}
                      aria-expanded={open}
                      aria-label={`${open ? 'Hide' : 'Show'} ${c.label} subcategories`}
                    >
                      <ChevronDown size={22} />
                    </button>
                  )}
                </div>
                {open && (
                  <ul className="sub-list" role="list">
                    {subs.map((s) => {
                      const subOn = on || draft.subcategories.includes(subKey(c.id, s));
                      return (
                        <li key={s}>
                          <button className="check-row sub" role="checkbox" aria-checked={subOn} onClick={() => toggleSub(c.id, s)}>
                            <span className="sub-dot" style={{ background: c.color }} aria-hidden="true" />
                            <span className="check-text">
                              <span>{s}</span>
                            </span>
                            <Checkbox checked={subOn} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button
        className="fab-apply"
        onClick={() => {
          setFilters(draft);
          onClose();
        }}
      >
        <Check size={22} aria-hidden="true" /> Apply
      </button>
    </Sheet>
  );
}

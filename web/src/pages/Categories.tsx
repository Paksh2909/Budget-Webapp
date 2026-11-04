import { ChevronDown, Pencil, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { byCategory, cashflow, isIncome, isTransfer } from '../calc';
import { category, type CategoryId } from '../categories';
import { Donut } from '../components/Donut';
import { FiltersSheet } from '../components/FiltersSheet';
import { ActiveFilters, CategoryIcon, FilterButton, PageHeader, PeriodBar, Segmented } from '../components/ui';
import { useData } from '../data';
import { applyFilters, subKey } from '../filters';
import { money } from '../format';
import { inRange, range } from '../period';
import { navigate } from '../router';

export function Categories() {
  const { txns: allTxns, period, filters, setFilters } = useData();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [expanded, setExpanded] = useState<CategoryId | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const r = range(period);
  const txns = useMemo(() => applyFilters(allTxns, filters), [allTxns, filters]);
  const cats = useMemo(() => byCategory(txns, r, kind), [txns, r.start, r.end, kind]);
  const cf = useMemo(() => cashflow(txns, r), [txns, r.start, r.end]);
  // The expanded row doubles as the highlighted slice.
  const selectedIndex = cats.findIndex((c) => c.id === expanded);
  const selectedCat = selectedIndex >= 0 ? cats[selectedIndex] : null;

  // Subcategory totals for the expanded category.
  const subs = useMemo(() => {
    if (!expanded) return [];
    const m = new Map<string, number>();
    for (const t of txns) {
      if (t.category !== expanded || !inRange(t.date, r) || isTransfer(t)) continue;
      const v = isIncome(t) ? -t.amount : t.amount;
      const k = t.subcategory ?? 'Uncategorized';
      m.set(k, (m.get(k) ?? 0) + v);
    }
    const list = [...m.entries()].filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
    const sum = list.reduce((s, [, v]) => s + v, 0);
    return list.map(([name, total]) => ({ name, total, share: sum ? total / sum : 0 }));
  }, [txns, expanded, r.start, r.end]);

  const viewTransactions = (id: CategoryId, sub?: string) => {
    setFilters({
      ...filters,
      categories: sub && sub !== 'Uncategorized' ? [] : [id],
      subcategories: sub && sub !== 'Uncategorized' ? [subKey(id, sub)] : [],
    });
    navigate('/transactions');
  };

  return (
    <div className="page">
      <PageHeader
        title="Categories"
        actions={
          <>
            <button className="icon-btn" onClick={() => navigate('/rules')} aria-label="Auto-categorize rules">
              <Wand2 size={22} />
            </button>
            <button className="icon-btn" onClick={() => navigate('/budgets')} aria-label="Edit budgets">
              <Pencil size={22} />
            </button>
          </>
        }
      />
      <PeriodBar right={<FilterButton onClick={() => setShowFilters(true)} />} />
      <ActiveFilters />
      <Segmented
        ariaLabel="Show"
        value={kind}
        onChange={(v) => {
          setKind(v);
          setExpanded(null);
        }}
        options={[
          { value: 'expense', label: 'Expenses' },
          { value: 'income', label: 'Income' },
        ]}
      />

      <Donut
        size={248}
        thickness={18}
        segments={cats.map((c) => ({ value: c.total, color: category(c.id).color, label: category(c.id).label }))}
        selected={selectedIndex >= 0 ? selectedIndex : null}
        onSelect={(i) => setExpanded(i === null ? null : (cats[i]?.id ?? null))}
        center={
          selectedCat ? (
            <span className="donut-sel" aria-live="polite">
              <span className="donut-sel-name" style={{ color: category(selectedCat.id).color }}>
                {category(selectedCat.id).label}
              </span>
              <span className={'donut-total strong ' + (kind === 'expense' ? 'neg' : 'pos')}>{money(selectedCat.total)}</span>
              <span className="muted small">{Math.round(selectedCat.share * 100)}% of {kind === 'expense' ? 'spending' : 'income'}</span>
            </span>
          ) : (
            <>
              <span className={'donut-total neg' + (kind === 'expense' ? ' strong' : '')}>{money(cf.expense)}</span>
              <span className={'donut-total pos' + (kind === 'income' ? ' strong' : '')}>{money(cf.income)}</span>
              {cats.length > 0 && <span className="muted tiny-hint">Tap a slice</span>}
            </>
          )
        }
        ariaLabel={`${kind === 'expense' ? 'Spending' : 'Income'} by category. ${cats
          .map((c) => `${category(c.id).label} ${Math.round(c.share * 100)}%`)
          .join(', ')}`}
      />

      <ul className="cat-list">
        {cats.map((c) => {
          const meta = category(c.id);
          const open = expanded === c.id;
          return (
            <li key={c.id} id={`cat-${c.id}`} className={expanded && !open ? 'cat-dim' : ''}>
              <div className="cat-row-wrap">
                <button
                  className="cat-row"
                  onClick={() => setExpanded(open ? null : c.id)}
                  aria-expanded={open}
                  aria-label={`${meta.label}, ${money(c.total)}, ${Math.round(c.share * 100)} percent. ${open ? 'Hide' : 'Show'} subcategories`}
                >
                  <CategoryIcon id={c.id} size={46} />
                  <span className="cat-body">
                    <span className="cat-line">
                      <span className="cat-name">{meta.label}</span>
                      <span className={kind === 'expense' ? 'neg' : 'pos'}>{money(c.total)}</span>
                    </span>
                    <span className="cat-bar-row">
                      <span className="cat-bar">
                        <span style={{ width: `${Math.max(c.share * 100, 2)}%`, background: meta.color }} />
                      </span>
                      <span className="cat-pct">{Math.round(c.share * 100)}%</span>
                    </span>
                  </span>
                  <ChevronDown size={20} className={'chev muted' + (open ? ' open' : '')} aria-hidden="true" />
                </button>
              </div>
              {open && (
                <ul className="sub-breakdown">
                  {subs.map((s) => (
                    <li key={s.name}>
                      <button className="sub-row" onClick={() => viewTransactions(c.id, s.name)}>
                        <span className="sub-name">{s.name}</span>
                        <span className="cat-bar">
                          <span style={{ width: `${Math.max(s.share * 100, 2)}%`, background: meta.color }} />
                        </span>
                        <span className={kind === 'expense' ? 'neg' : 'pos'}>{money(s.total)}</span>
                      </button>
                    </li>
                  ))}
                  <li>
                    <button className="btn ghost small" onClick={() => viewTransactions(c.id)}>
                      View all {meta.label} transactions
                    </button>
                  </li>
                </ul>
              )}
            </li>
          );
        })}
        {!cats.length && <li className="empty">No {kind === 'expense' ? 'spending' : 'income'} in this period.</li>}
      </ul>
      {showFilters && <FiltersSheet onClose={() => setShowFilters(false)} showTypes={false} />}
    </div>
  );
}

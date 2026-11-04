import { ListFilter, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { byCategory, cashflow } from '../calc';
import { category } from '../categories';
import { Donut } from '../components/Donut';
import { CategoryIcon, PageHeader, PeriodBar } from '../components/ui';
import { useData } from '../data';
import { money } from '../format';
import { range } from '../period';
import { navigate } from '../router';

export function Categories() {
  const { txns, period } = useData();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const r = range(period);
  const cats = useMemo(() => byCategory(txns, r, kind), [txns, r.start, r.end, kind]);
  const cf = useMemo(() => cashflow(txns, r), [txns, r.start, r.end]);

  return (
    <div className="page">
      <PageHeader
        title="Categories"
        actions={
          <button className="icon-btn" onClick={() => navigate('/budgets')} aria-label="Edit budgets">
            <Pencil size={22} />
          </button>
        }
      />
      <PeriodBar
        right={
          <button
            className="icon-btn"
            onClick={() => setKind(kind === 'expense' ? 'income' : 'expense')}
            aria-label={`Showing ${kind}. Switch to ${kind === 'expense' ? 'income' : 'expenses'}`}
          >
            <ListFilter size={22} />
          </button>
        }
      />

      <Donut
        showLabels
        size={300}
        segments={cats.map((c) => ({ value: c.total, color: category(c.id).color, label: category(c.id).label }))}
        center={
          <>
            <span className={'donut-total neg' + (kind === 'expense' ? ' strong' : '')}>{money(cf.expense)}</span>
            <span className={'donut-total pos' + (kind === 'income' ? ' strong' : '')}>{money(cf.income)}</span>
          </>
        }
        ariaLabel={`${kind === 'expense' ? 'Spending' : 'Income'} by category`}
      />

      <ul className="cat-list">
        {cats.map((c) => {
          const meta = category(c.id);
          return (
            <li key={c.id}>
              <button
                className="cat-row"
                onClick={() => navigate(`/transactions?category=${c.id}`)}
                aria-label={`${meta.label}, ${money(c.total)}, ${Math.round(c.share * 100)} percent. View transactions`}
              >
                <CategoryIcon id={c.id} size={56} />
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
              </button>
            </li>
          );
        })}
        {!cats.length && <li className="empty">No {kind === 'expense' ? 'spending' : 'income'} in this period.</li>}
      </ul>
    </div>
  );
}

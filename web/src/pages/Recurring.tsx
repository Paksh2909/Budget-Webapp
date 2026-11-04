import { AlertTriangle, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { CategoryIcon, PageHeader } from '../components/ui';
import { useData } from '../data';
import { money } from '../format';
import { cadenceLabel, upcomingCharges, type Recurring as R } from '../insights';
import { today, toDate } from '../period';
import { navigate } from '../router';
import { useInsights } from '../useInsights';

const shortDate = (d: string) => toDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function relDay(d: string): string {
  const diff = Math.round((toDate(d).getTime() - toDate(today()).getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 0) return `${-diff}d late`;
  if (diff < 7) return `In ${diff} days`;
  return shortDate(d);
}

function Row({ r, onOpen }: { r: R; onOpen: () => void }) {
  return (
    <li>
      <button className="rec-row" onClick={onOpen} aria-label={`${r.name}, ${money(r.amount)} ${cadenceLabel(r.cadence)}. View transactions`}>
        <CategoryIcon id={r.category} size={36} />
        <span className="rec-main">
          <span className="rec-name">{r.name}</span>
          <span className="muted small">
            {cadenceLabel(r.cadence)}
            {r.variable ? ' · varies' : ''} · next {shortDate(r.next)}
          </span>
          {r.priceChange && r.priceChange.to > r.priceChange.from && (
            <span className="rec-flag warn">
              <TrendingUp size={12} aria-hidden="true" /> Up from {money(r.priceChange.from)}
            </span>
          )}
          {r.status === 'late' && (
            <span className="rec-flag info">
              <AlertTriangle size={12} aria-hidden="true" /> Missed {shortDate(r.next)}?
            </span>
          )}
        </span>
        <span className="rec-side">
          <span className={r.kind === 'income' ? 'pos' : 'neg'}>
            {r.variable ? '~' : ''}
            {money(r.amount)}
          </span>
          {r.cadence !== 'monthly' && <span className="muted small">{money(r.monthly)}/mo</span>}
        </span>
      </button>
    </li>
  );
}

export function Recurring() {
  const { setPeriod } = useData();
  const { recurring } = useInsights();
  const expenses = recurring.filter((r) => r.kind === 'expense');
  const income = recurring.filter((r) => r.kind === 'income');
  const monthly = expenses.reduce((s, r) => s + r.monthly, 0);
  const monthlyIncome = income.reduce((s, r) => s + r.monthly, 0);
  const upcoming = useMemo(() => upcomingCharges(recurring, 14), [recurring]);

  const open = (r: R) => {
    setPeriod({ kind: 'all', anchor: today() });
    navigate(`/transactions?q=${encodeURIComponent(r.name)}`);
  };

  return (
    <div className="page">
      <PageHeader title="Recurring" onBack={() => navigate('/')} />

      <section className="card">
        <div className="row-between">
          <span className="muted">Bills &amp; subscriptions</span>
          <span className="big-number small-big neg">{money(monthly)}/mo</span>
        </div>
        {monthlyIncome > 0 && (
          <div className="row-between">
            <span className="muted">Recurring income</span>
            <span className="pos">{money(monthlyIncome)}/mo</span>
          </div>
        )}
        <p className="muted small">Found automatically from charges that repeat on a regular schedule at a similar amount.</p>
      </section>

      {upcoming.length > 0 && (
        <section className="card">
          <h2 className="card-title">Next 2 weeks</h2>
          <ul className="upcoming-list">
            {upcoming.map((u) => (
              <li key={u.r.key + u.date}>
                <span className={'up-when' + (u.date < today() ? ' late' : '')}>{relDay(u.date)}</span>
                <span className="up-name">{u.r.name}</span>
                <span className="neg">{money(u.r.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">Bills &amp; subscriptions</h2>
        {expenses.length ? (
          <ul className="rec-list">
            {expenses.map((r) => (
              <Row key={r.key} r={r} onOpen={() => open(r)} />
            ))}
          </ul>
        ) : (
          <p className="empty">Nothing recurring yet. It takes about 3 charges for a pattern to show up.</p>
        )}
      </section>

      {income.length > 0 && (
        <section className="card">
          <h2 className="card-title">Income</h2>
          <ul className="rec-list">
            {income.map((r) => (
              <Row key={r.key} r={r} onOpen={() => open(r)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

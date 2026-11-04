import { AlertTriangle, ChevronRight, Info, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { ForecastSheet } from './ForecastSheet';
import { useData } from '../data';
import { EMPTY_FILTERS } from '../filters';
import { money } from '../format';
import type { Forecast, Insight, Recurring } from '../insights';
import { upcomingCharges } from '../insights';
import { monthLong } from '../format';
import { today, toDate } from '../period';
import { navigate } from '../router';

export function ForecastCard({ forecast, budgetTotal }: { forecast: Forecast; budgetTotal: number | null }) {
  const f = forecast;
  const month = monthLong(toDate(today()).getUTCMonth());
  const scale = Math.max(f.projected, budgetTotal ?? 0, f.lastMonth, 1);
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  const vsLast = f.lastMonth > 0 ? f.projected - f.lastMonth : null;
  const over = budgetTotal !== null ? f.projected - budgetTotal : null;
  const [open, setOpen] = useState(false);

  return (
    <>
    <section className="card" aria-labelledby="forecast-title">
      <button className="card-hit" onClick={() => setOpen(true)} aria-label="Show forecast details" />
      <div className="row-between">
        <div>
          <h2 id="forecast-title" className="card-title">
            {month} forecast
          </h2>
          <p className="card-sub">
            {f.daysLeft === 0 ? 'Last day of the month' : `${f.daysLeft} day${f.daysLeft === 1 ? '' : 's'} left`}
            {f.confidence === 'low' ? ' · rough estimate' : ''}
          </p>
        </div>
        <div className="forecast-total">
          <span className="muted small">On pace for</span>
          <span className="big-number small-big neg">{money(f.projected)}</span>
        </div>
      </div>

      <div className="forecast-bar" role="img" aria-label={`Spent ${money(f.spent)} of a projected ${money(f.projected)}${budgetTotal ? `, budget ${money(budgetTotal)}` : ''}`}>
        <span className="fb-projected" style={{ width: pct(f.projected) }} />
        <span className="fb-spent" style={{ width: pct(f.spent) }} />
        {budgetTotal !== null && <span className="fb-budget" style={{ left: pct(budgetTotal) }} />}
      </div>

      <div className="forecast-legend">
        <span>
          <i className="dot spent" /> Spent {money(f.spent)}
        </span>
        <span>
          <i className="dot bills" /> Recurring {money(f.upcomingRecurring)}
        </span>
        <span>
          <i className="dot pace" /> ~{money(f.dailyRate)}/day
        </span>
      </div>

      {(over !== null || vsLast !== null) && (
        <p className={'forecast-note ' + (over !== null && over > 0 ? 'neg' : 'muted')}>
          {over !== null
            ? over > 0
              ? `About ${money(over)} over your ${money(budgetTotal!)} budget at this pace.`
              : `About ${money(-over)} under your ${money(budgetTotal!)} budget.`
            : ''}
          {over !== null && vsLast !== null ? ' ' : ''}
          {vsLast !== null && `${vsLast >= 0 ? '+' : '−'}${money(Math.abs(vsLast))} vs. last month.`}
        </p>
      )}
      <span className="card-more muted small" aria-hidden="true">
        Details <ChevronRight size={14} />
      </span>
    </section>
    {open && <ForecastSheet f={f} budget={budgetTotal} onClose={() => setOpen(false)} />}
    </>
  );
}

const ICON = { warn: AlertTriangle, good: TrendingDown, info: Info } as const;

export function InsightsCard({ insights }: { insights: Insight[] }) {
  const { setFilters } = useData();
  if (!insights.length) return null;
  const open = (i: Insight) => {
    if (i.category) {
      setFilters({ ...EMPTY_FILTERS, categories: [i.category] });
      navigate('/transactions');
    } else if (i.recurringKey) navigate('/recurring');
  };
  return (
    <section className="card" aria-labelledby="insights-title">
      <h2 id="insights-title" className="card-title card-title-icon">
        <Sparkles size={18} aria-hidden="true" /> This month
      </h2>
      <ul className="insight-list">
        {insights.map((i) => {
          const Icon = i.id.startsWith('up-') || i.id.startsWith('price-') ? TrendingUp : ICON[i.tone];
          const clickable = !!(i.category || i.recurringKey);
          const body = (
            <>
              <span className={`insight-icon ${i.tone}`} aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="insight-text">
                <span className="insight-title">{i.title}</span>
                <span className="muted small">{i.detail}</span>
              </span>
              {clickable && <ChevronRight size={18} className="muted" aria-hidden="true" />}
            </>
          );
          return (
            <li key={i.id}>
              {clickable ? (
                <button className="insight-row" onClick={() => open(i)}>
                  {body}
                </button>
              ) : (
                <div className="insight-row">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function RecurringCard({ recurring }: { recurring: Recurring[] }) {
  const expenses = recurring.filter((r) => r.kind === 'expense');
  const monthly = expenses.reduce((s, r) => s + r.monthly, 0);
  const next = upcomingCharges(recurring, 10).filter((u) => u.date >= today()).slice(0, 3);
  return (
    <section className="card">
      <button className="card-title-row" onClick={() => navigate('/recurring')}>
        <div>
          <h2 className="card-title">Recurring</h2>
          <p className="card-sub">
            {expenses.length
              ? `${expenses.length} bills & subscriptions · ${money(monthly)}/mo`
              : 'Detected automatically after a few repeat charges'}
          </p>
        </div>
        <ChevronRight size={22} aria-hidden="true" />
      </button>
      {next.length > 0 && (
        <ul className="upcoming-list">
          {next.map((u) => (
            <li key={u.r.key + u.date}>
              <span className="up-when">
                {toDate(u.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
              </span>
              <span className="up-name">{u.r.name}</span>
              <span className="neg">{money(u.r.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

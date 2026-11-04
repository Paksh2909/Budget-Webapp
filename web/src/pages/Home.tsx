import { ArrowDownCircle, ArrowUpCircle, ChevronLeft, ChevronRight, LayoutGrid, RefreshCw, Settings } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import { HomeEditor } from '../components/HomeEditor';
import { resolveLayout, type TileId } from '../homeLayout';
import { accountBalance, accountName, balanceSeries, byCategory } from '../calc';
import { category } from '../categories';
import { Donut } from '../components/Donut';
import { CoverageCard } from '../components/Coverage';
import { ForecastCard, InsightsCard, RecurringCard } from '../components/HomeCards';
import { LineChart } from '../components/LineChart';
import { LinkBankButton } from '../components/PlaidLink';
import { AccountIcon, CategoryIcon, PageHeader, Segmented } from '../components/ui';
import { useData } from '../data';
import { money, monthShort, relativeTime, signedMoney } from '../format';
import { isCurrent, label, range, shift, today, toDate, type PeriodKind } from '../period';
import { navigate } from '../router';
import { useInsights } from '../useInsights';

export function CashflowRows({ income, expense }: { income: number; expense: number }) {
  const net = income - expense;
  return (
    <div className="cashflow">
      <div className="cf-row">
        <ArrowUpCircle size={22} className="pos" fill="currentColor" stroke="var(--card)" />
        <span>Income</span>
        <span className="pos">{money(income)}</span>
      </div>
      <div className="cf-row">
        <ArrowDownCircle size={22} className="neg" fill="currentColor" stroke="var(--card)" />
        <span>Expenses</span>
        <span className="neg">{money(expense)}</span>
      </div>
      <div className="cf-total">
        <span>Total:</span>
        <span className={net >= 0 ? 'pos' : 'neg'}>{signedMoney(net)}</span>
      </div>
    </div>
  );
}

function shortDate(d: string) {
  const x = toDate(d);
  return `${monthShort(x.getUTCMonth())} ${String(x.getUTCDate()).padStart(2, '0')}`;
}

export function Home() {
  const { data, txns, period, setPeriod, syncing, syncAll, reload, showToast } = useData();
  const saved = useMemo(() => resolveLayout(data?.settings.homeLayout ?? null), [data]);
  const [editing, setEditing] = useState<{ order: TileId[]; hidden: Set<TileId> } | null>(null);
  const layout = editing ?? saved;

  const finishEditing = async () => {
    if (!editing) return;
    const draft = editing;
    setEditing(null);
    try {
      await api('/api/settings', { method: 'PUT', body: { homeLayout: { order: draft.order, hidden: [...draft.hidden] } } });
      await reload();
    } catch (e) {
      showToast(`Couldn't save layout: ${(e as Error).message}`);
    }
  };
  const r = range(period);
  const accounts = useMemo(() => (data?.accounts ?? []).filter((a) => !a.hidden), [data]);
  const series = useMemo(() => balanceSeries(data?.accounts ?? [], data?.transactions ?? [], r), [data, r.start, r.end]);
  const cats = useMemo(() => byCategory(txns, r), [txns, r.start, r.end]);
  const { recurring, forecast, insights, coverage } = useInsights();
  const lastSync = data?.items.length
    ? data.items.map((i) => i.last_synced_at).sort().reverse()[0] ?? null
    : null;

  const xLabels =
    period.kind === 'year' || period.kind === 'all'
      ? series.dates.map((d) => `${monthShort(toDate(d).getUTCMonth())} '${String(toDate(d).getUTCFullYear()).slice(2)}`)
      : series.dates.map(shortDate);
  const change = series.current - series.baseline;

  const tiles: Record<TileId, ReactNode> = {
    balance: (
      <section className="card">
        <h2 className="card-title">Total balance</h2>
        <Segmented<PeriodKind>
          ariaLabel="Balance period"
          value={period.kind}
          onChange={(k) => setPeriod({ kind: k, anchor: today() })}
          options={[
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: 'year', label: 'Year' },
            { value: 'all', label: 'All' },
          ]}
        />
        <div className="balance-head">
          <div>
            <div className="big-number">{money(series.current)}</div>
            <div className="sub">
              <span className={change >= 0 ? 'pos' : 'neg'}>{signedMoney(change)}</span> {label(period)}
            </div>
          </div>
          {period.kind !== 'all' && (
            <div className="period-nav">
              <button className="icon-btn" onClick={() => setPeriod(shift(period, -1))} aria-label="Previous period">
                <ChevronLeft size={22} />
              </button>
              <button className="icon-btn" disabled={isCurrent(period)} onClick={() => setPeriod(shift(period, 1))} aria-label="Next period">
                <ChevronRight size={22} />
              </button>
            </div>
          )}
        </div>
        <LineChart
          series={[{ values: series.values, color: '#79a7f2' }]}
          xLabels={xLabels}
          height={180}
          ariaLabel={`Balance over ${label(period)}, from ${money(series.baseline)} to ${money(series.current)}`}
        />
      </section>
    ),
    forecast: <>{txns.length > 0 ? <ForecastCard forecast={forecast} /> : null}</>,
    bills: <>{coverage && txns.length > 0 ? <CoverageCard coverage={coverage} /> : null}</>,
    insights: <InsightsCard insights={insights} />,
    accounts: (
      <section className="card">
        <button className="card-title-row" onClick={() => navigate('/accounts')}>
          <h2 className="card-title">Accounts</h2>
          <ChevronRight size={22} aria-hidden="true" />
        </button>
        {accounts.length ? (
          <div className="acct-grid">
            {accounts.map((a) => (
              <div key={a.account_id} className="acct-cell">
                <AccountIcon account={a} />
                <div className="acct-text">
                  <span className="acct-name">{accountName(a)}</span>
                  <span className="acct-bal">{money(accountBalance(a))}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <p>Link a bank to pull in balances and transactions.</p>
            <LinkBankButton>Link a bank</LinkBankButton>
          </div>
        )}
      </section>
    ),
    categories: (
      <section className="card">
        <button className="card-title-row" onClick={() => navigate('/categories')}>
          <div>
            <h2 className="card-title">Categories</h2>
            <p className="card-sub">{label(period)}</p>
          </div>
          <ChevronRight size={22} aria-hidden="true" />
        </button>
        <div className="mini-cats">
          <Donut
            size={112}
            thickness={12}
            segments={cats.map((c) => ({ value: c.total, color: category(c.id).color, label: category(c.id).label }))}
            center={<span className="neg small">Expense</span>}
            ariaLabel="Spending by category"
          />
          <ul className="legend">
            {cats.slice(0, 5).map((c) => (
              <li key={c.id}>
                <CategoryIcon id={c.id} size={20} />
                <span className="legend-name">{category(c.id).label}</span>
                <span className="neg">{money(c.total)}</span>
              </li>
            ))}
            {!cats.length && <li className="muted">No spending yet</li>}
          </ul>
        </div>
      </section>
    ),
    recurring: <>{txns.length > 0 ? <RecurringCard recurring={recurring} /> : null}</>,
  };

  return (
    <div className="page">
      <PageHeader
        title="Home"
        actions={
          editing ? (
            <>
              <button className="btn ghost small" onClick={() => setEditing(resolveLayout(null))}>
                Reset
              </button>
              <button className="btn primary small" onClick={finishEditing}>
                Done
              </button>
            </>
          ) : (
          <>
            <button className="icon-btn" onClick={() => setEditing({ order: [...saved.order], hidden: new Set(saved.hidden) })} aria-label="Customize Home">
              <LayoutGrid size={22} />
            </button>
            <button className="icon-btn" onClick={syncAll} disabled={syncing} aria-label={`Sync banks, last synced ${relativeTime(lastSync)}`}>
              <RefreshCw size={24} className={syncing ? 'spin' : ''} />
            </button>
            <button className="icon-btn" onClick={() => navigate('/accounts')} aria-label="Settings and accounts">
              <Settings size={24} />
            </button>
          </>
          )
        }
      />

      {editing && <HomeEditor order={editing.order} hidden={editing.hidden} onChange={(order, hidden) => setEditing({ order, hidden })} />}

      {layout.order
        .filter((id) => !layout.hidden.has(id))
        .map((id) => (
          <div key={id} className="tile">
            {tiles[id]}
          </div>
        ))}
      {layout.order.every((id) => layout.hidden.has(id)) && !editing && (
        <div className="empty card">
          <p>All tiles are hidden.</p>
          <button className="btn primary" onClick={() => setEditing({ order: [...saved.order], hidden: new Set() })}>
            Customize Home
          </button>
        </div>
      )}
    </div>
  );
}

import { AlertTriangle, ArrowRightLeft, CalendarClock, Pencil, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BillSheet } from '../components/BillSheet';
import { CategoryIcon, PageHeader } from '../components/ui';
import { useData } from '../data';
import { money } from '../format';
import { cadenceLabel, upcomingCharges, type Recurring as R } from '../insights';
import type { TrackedBill } from '../types';
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

const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10] ?? 'th');

function changeText(c: NonNullable<R['change']>): string {
  const amt = Math.abs(c.fromAmount - c.toAmount) > 0.5 ? `${money(c.fromAmount)} → ${money(c.toAmount)}` : '';
  const cad = c.fromCadence !== c.toCadence ? `${cadenceLabel(c.fromCadence).toLowerCase()} → ${cadenceLabel(c.toCadence).toLowerCase()}` : '';
  return [amt, cad].filter(Boolean).join(', ');
}

function Row({ r, onOpen, onEdit }: { r: R; onOpen: () => void; onEdit?: () => void }) {
  return (
    <li className="rec-li">
      <button className="rec-row" onClick={onOpen} aria-label={`${r.name}, ${money(r.amount)} ${cadenceLabel(r.cadence)}. View transactions`}>
        <CategoryIcon id={r.category} size={36} />
        <span className="rec-main">
          <span className="rec-name">{r.name}</span>
          <span className="muted small">
            {r.window ? `Monthly, ${ordinal(r.window.dayStart)}–${ordinal(r.window.dayEnd)}` : cadenceLabel(r.cadence)}
            {r.variable && !r.window ? ' · varies' : ''} · next {shortDate(r.next)}
          </span>
          {r.priceChange && r.priceChange.to > r.priceChange.from && (
            <span className="rec-flag warn">
              <TrendingUp size={12} aria-hidden="true" /> Up from {money(r.priceChange.from)}
            </span>
          )}
          {r.change && (
            <span className="rec-flag change">
              <ArrowRightLeft size={12} aria-hidden="true" /> Changed: {changeText(r.change)}
            </span>
          )}
          {r.trackedBillId && (
            <span className="rec-flag tracked">
              <CalendarClock size={12} aria-hidden="true" /> Tracked bill · avg of last {Math.min(3, r.count)} payment{r.count === 1 ? '' : 's'}
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
      {onEdit && (
        <button className="icon-btn rec-edit" onClick={onEdit} aria-label={`Edit ${r.name}`}>
          <Pencil size={16} />
        </button>
      )}
    </li>
  );
}

export function Recurring() {
  const { data, setPeriod } = useData();
  const [editing, setEditing] = useState<TrackedBill | null>(null);
  const billById = (id?: string) => (id ? data?.bills.find((b) => b.id === id) : undefined);
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
        <p className="muted small">
          Found automatically from charges that repeat on a regular schedule, using your most recent payments, so changes show up
          within a couple of cycles. To track something like rent, open one of its transactions and tap “Track as a monthly bill”.
        </p>
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
              <Row
                key={r.key}
                r={r}
                onOpen={() => open(r)}
                onEdit={r.trackedBillId ? () => setEditing(billById(r.trackedBillId) ?? null) : undefined}
              />
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
      {editing && <BillSheet draft={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

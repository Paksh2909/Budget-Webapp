import { money, monthLong, monthShort } from '../format';
import type { Forecast } from '../insights';
import { addDays, today, toDate } from '../period';
import { LineChart, type RefLine } from './LineChart';
import { Sheet } from './ui';

const shortDate = (d: string) => `${monthShort(toDate(d).getUTCMonth())} ${toDate(d).getUTCDate()}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

function Row({ label, value, sub, strong, indent }: { label: string; value?: string; sub?: string; strong?: boolean; indent?: boolean }) {
  return (
    <div className={'math-row' + (strong ? ' strong' : '') + (indent ? ' indent' : '')}>
      <span className="math-label">
        {label}
        {sub && <span className="muted small math-sub">{sub}</span>}
      </span>
      {value && <span className="math-value">{value}</span>}
    </div>
  );
}

export function ForecastSheet({ f, budget, onClose }: { f: Forecast; budget: number | null; onClose: () => void }) {
  const t = today();
  const d = toDate(t);
  const month = monthLong(d.getUTCMonth());
  const monthStart = addDays(t, -(f.elapsed - 1));
  const n = f.daysInMonth;

  // Chart series by day of month (index 0 = the 1st).
  const actual: (number | null)[] = Array.from({ length: n }, (_, i) => (i < f.actualByDay.length ? f.actualByDay[i]! : null));
  const projected: (number | null)[] = Array.from({ length: n }, (_, i) =>
    i >= f.elapsed - 1 ? (f.projectedByDay[i - (f.elapsed - 1)] ?? null) : null,
  );
  const lastMonth: (number | null)[] = Array.from({ length: n }, (_, i) =>
    f.lastMonthByDay.length ? (f.lastMonthByDay[Math.min(i, f.lastMonthByDay.length - 1)] ?? null) : null,
  );
  const xLabels = Array.from({ length: n }, (_, i) => `${monthShort(d.getUTCMonth())} ${i + 1}`);
  const refLines: RefLine[] = budget !== null ? [{ value: budget, color: '#e6e6ea', label: `Budget ${money(budget)}` }] : [];

  const lateDue = f.upcoming.filter((u) => u.date < t);
  const paceTotal = f.dailyRate * f.daysLeft;

  return (
    <Sheet title={`${month} forecast`} onClose={onClose} full>
      <div className="forecast-hero">
        <span className="muted small">On pace for</span>
        <span className="big-number neg">{money(f.projected)}</span>
        {budget !== null && (
          <span className={'small ' + (f.projected > budget ? 'neg' : 'pos')}>
            {f.projected > budget ? `${money(f.projected - budget)} over` : `${money(budget - f.projected)} under`} your {money(budget)} budget
          </span>
        )}
      </div>

      <LineChart
        series={[
          ...(f.lastMonthByDay.length ? [{ values: lastMonth, color: '#7d7f88', fill: false, width: 1.5, opacity: 0.7 }] : []),
          { values: actual, color: '#ea7a5f' },
          { values: projected, color: '#ea7a5f', dashed: true, fill: false },
        ]}
        xLabels={xLabels}
        height={220}
        zeroBased
        refLines={refLines}
        markerIndex={f.elapsed - 1}
        ariaLabel={`Cumulative spending this month: ${money(f.spent)} so far, projected ${money(f.projected)} by month end`}
      />
      <div className="forecast-legend">
        <span>
          <i className="dot spent" /> Spent so far
        </span>
        <span>
          <i className="dash" /> Projected
        </span>
        {f.lastMonthByDay.length > 0 && (
          <span>
            <i className="dot last" /> Last month
          </span>
        )}
      </div>

      <section className="math" aria-label="How the forecast is calculated">
        <h3 className="field-label">How it's calculated</h3>
        <Row label="Spent so far" sub={`${shortDate(monthStart)} – ${shortDate(t)}`} value={money(f.spent)} />

        <Row label="+ Recurring still due" value={money(f.upcomingRecurring)} />
        {f.upcoming.length === 0 && <Row indent label="Nothing else expected this month" />}
        {f.upcoming.map((u, i) => (
          <Row
            key={u.r.key + u.date + i}
            indent
            label={`${u.date < t ? 'Due (not posted yet)' : shortDate(u.date)} · ${u.r.name}`}
            sub={u.r.trackedBillId ? 'tracked bill' : u.r.variable ? 'varies' : undefined}
            value={money(u.r.amount)}
          />
        ))}
        {lateDue.length > 0 && <Row indent label="Charges that are past due but not posted are counted today." />}

        <Row label="+ Day-to-day pace" sub={`${money(f.dailyRate)}/day × ${f.daysLeft} days left`} value={money(paceTotal)} />
        <Row
          indent
          label={`This month: ${money(f.thisRate)}/day`}
          sub={`${money(f.variableSoFar)} non-recurring over ${f.elapsed} days · weighted ${pct(f.weight)}`}
        />
        <Row
          indent
          label={f.histDays >= 14 ? `Last ${f.histDays} days: ${money(f.histRate)}/day` : 'Not enough history yet'}
          sub={f.histDays >= 14 ? `weighted ${pct(1 - f.weight)} · trusts this month more as it goes on` : 'uses this month only'}
        />
        {f.oneOffs.length > 0 && (
          <Row
            indent
            label={`One-offs left out of the pace (over ${money(f.cap)})`}
            sub={f.oneOffs
              .slice(0, 3)
              .map((x) => `${x.merchant_name ?? x.name} ${money(x.amount)}`)
              .join(' · ')}
          />
        )}

        <Row label="= Projected total" value={money(f.projected)} strong />
        {f.lastMonth > 0 && (
          <Row
            label="Last month"
            value={money(f.lastMonth)}
            sub={`${f.projected >= f.lastMonth ? '+' : '−'}${money(Math.abs(f.projected - f.lastMonth))} vs. this month's projection`}
          />
        )}
        <p className="muted small math-note">
          Spending excludes transfers and card payments. Investments and recurring charges come from your own
          history and update as your patterns change. {f.confidence === 'low' ? 'This is a rough estimate until there’s more history.' : ''}
        </p>
      </section>
    </Sheet>
  );
}

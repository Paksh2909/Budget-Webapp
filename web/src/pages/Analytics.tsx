import { useMemo, useState } from 'react';
import { averages, cashflow, flowSeries } from '../calc';
import { LineChart, type Series } from '../components/LineChart';
import { PageHeader, PeriodBar, Segmented } from '../components/ui';
import { useData } from '../data';
import { money, monthShort } from '../format';
import { label, range, toDate } from '../period';
import { CashflowRows } from './Home';

type View = 'income' | 'expense' | 'both' | 'total';
const GREEN = '#5fd07a';
const RED = '#e8735a';

export function Analytics() {
  const { txns, period } = useData();
  const [view, setView] = useState<View>('both');
  const r = range(period);
  const granularity = period.kind === 'week' || period.kind === 'month' ? 'day' : 'month';
  const flows = useMemo(() => flowSeries(txns, r, granularity), [txns, r.start, r.end, granularity]);
  const cf = useMemo(() => cashflow(txns, r), [txns, r.start, r.end]);
  const avg = useMemo(() => averages(txns, r), [txns, r.start, r.end]);

  const xLabels = flows.keys.map((k) => {
    const d = toDate(k.length === 7 ? k + '-01' : k);
    return granularity === 'day'
      ? `${monthShort(d.getUTCMonth())} ${d.getUTCDate()}`
      : `${monthShort(d.getUTCMonth())} ${d.getUTCFullYear()}`;
  });

  const series: Series[] =
    view === 'total'
      ? [{ values: flows.income.map((v, i) => v - flows.expense[i]!), color: '#79a7f2' }]
      : [
          ...(view !== 'expense' ? [{ values: flows.income, color: GREEN }] : []),
          ...(view !== 'income' ? [{ values: flows.expense, color: RED, fill: view === 'expense' }] : []),
        ];

  return (
    <div className="page">
      <PageHeader title="Analytics" />
      <PeriodBar />
      <Segmented<View>
        ariaLabel="Chart data"
        value={view}
        onChange={setView}
        options={[
          { value: 'both', label: 'Both' },
          { value: 'income', label: 'Income' },
          { value: 'expense', label: 'Expenses' },
          { value: 'total', label: 'Total' },
        ]}
      />
      <LineChart
        series={series}
        xLabels={xLabels}
        height={300}
        zeroBased={view !== 'total'}
        ariaLabel={`${view} per ${granularity} for ${label(period)}`}
      />

      <section className="card">
        <h2 className="card-title">Cash flow</h2>
        <p className="card-sub">{label(period)}</p>
        <CashflowRows income={cf.income} expense={cf.expense} />
      </section>

      <section className="card">
        <h2 className="card-title">Average</h2>
        <p className="card-sub">{label(period)}</p>
        <table className="avg-table">
          <tbody>
            {(['day', 'week', 'month'] as const).map((k) => (
              <tr key={k}>
                <th scope="row">{k[0]!.toUpperCase() + k.slice(1)}</th>
                <td className="pos">{money(avg[k].income)}</td>
                <td className="neg">{money(avg[k].expense)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

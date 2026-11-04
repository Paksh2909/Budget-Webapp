import { useMemo } from 'react';
import { computeCoverage } from './coverage';
import { useData } from './data';
import { allRecurring, forecastMonth, unusualInsights } from './insights';

/** Recurring series (incl. tracked bills), forecast, insights and bill coverage, memoized on loaded data. */
export function useInsights() {
  const { data, txns } = useData();
  return useMemo(() => {
    const recurring = allRecurring(txns, data?.bills ?? []);
    return {
      recurring,
      forecast: forecastMonth(txns, recurring),
      insights: unusualInsights(txns, recurring),
      coverage: data ? computeCoverage(data, txns, recurring) : null,
    };
  }, [txns, data]);
}

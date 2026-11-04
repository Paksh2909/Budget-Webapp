import { useMemo } from 'react';
import { useData } from './data';
import { detectRecurring, forecastMonth, unusualInsights } from './insights';

/** Recurring series, this month's forecast, and insights — memoized on the loaded data. */
export function useInsights() {
  const { txns } = useData();
  return useMemo(() => {
    const recurring = detectRecurring(txns);
    return {
      recurring,
      forecast: forecastMonth(txns, recurring),
      insights: unusualInsights(txns, recurring),
    };
  }, [txns]);
}

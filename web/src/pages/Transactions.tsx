import { CalendarClock, LayoutGrid, List, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cashflow, isIncome, isTransfer } from '../calc';
import { category } from '../categories';
import { FiltersSheet } from '../components/FiltersSheet';
import { accountLabel, TxnRow, TxnSheet } from '../components/Transactions';
import { ActiveFilters, FilterButton, PeriodBar, Sheet } from '../components/ui';
import type { CoverageEvent } from '../coverage';
import { useInsights } from '../useInsights';
import { useData } from '../data';
import { applyFilters } from '../filters';
import { monthLong, signedMoney, money, weekday } from '../format';
import { addDays, inRange, monthStart, range, today, toDate } from '../period';
import type { Account, Txn } from '../types';

const PAGE = 150;
const VIEW_KEY = 'budget.txnView';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const compact = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Fits estimates in a calendar cell: 1,688.15 → 1.7k, 400 → 400. */
const short = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(Math.round(v)));

const SOURCE_LABEL: Record<CoverageEvent['source'], string> = { statement: 'Statement', tracked: 'Tracked', detected: 'Recurring', estimate: 'Estimate' };

/** What Upcoming bills expects on a future day (or still due today). */
function ExpectedSheet({ date, events, onClose }: { date: string; events: CoverageEvent[]; onClose: () => void }) {
  const out = events.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const inn = -events.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0);
  const d = toDate(date);
  return (
    <Sheet title={`Expected ${monthLong(d.getUTCMonth())} ${d.getUTCDate()}`} onClose={onClose}>
      <ul className="coverage-list">
        {events.map((e, i) => (
          <li key={e.name + i} className="expected-li">
            <span className="cov-main">
              <span className="up-name">{e.name}</span>
              <span className="muted small cov-detail">{e.detail}</span>
            </span>
            <span className="cov-side">
              <span className={e.amount < 0 ? 'pos' : 'neg'}>
                {e.amount < 0 ? '+' : ''}
                {money(Math.abs(e.amount))}
              </span>
              <span className={`cov-badge ${e.source}`}>{SOURCE_LABEL[e.source]}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        {out > 0 ? `${money(out)} expected out` : ''}
        {out > 0 && inn > 0 ? ' · ' : ''}
        {inn > 0 ? `${money(inn)} expected in` : ''}. From Upcoming bills on Home (next 30 days, bill-pay account).
      </p>
    </Sheet>
  );
}

function CalendarView({
  month,
  txns,
  expected,
  onPickDay,
}: {
  month: string;
  txns: Txn[];
  expected: Map<string, CoverageEvent[]>;
  onPickDay: (d: string) => void;
}) {
  const first = monthStart(month);
  const m = toDate(first).getUTCMonth();
  const lead = (toDate(first).getUTCDay() + 6) % 7; // Monday-first grid
  const gridStart = addDays(first, -lead);
  const days = [...Array(42)].map((_, i) => addDays(gridStart, i));
  const t = today();

  const sums = useMemo(() => {
    const map = new Map<string, { inc: number; exp: number }>();
    for (const x of txns) {
      if (isTransfer(x)) continue;
      const s = map.get(x.date) ?? { inc: 0, exp: 0 };
      if (isIncome(x)) s.inc += -x.amount;
      else s.exp += x.amount;
      map.set(x.date, s);
    }
    return map;
  }, [txns]);

  return (
    <div className="calendar" role="grid" aria-label={`${monthLong(m)} calendar`}>
      <div className="cal-row cal-head" role="row">
        {WEEKDAYS.map((w, i) => (
          <span key={w} role="columnheader" className={i === 6 ? 'sun' : ''}>
            {w}
          </span>
        ))}
      </div>
      {[0, 1, 2, 3, 4, 5].map((w) => (
        <div key={w} className="cal-row" role="row">
          {days.slice(w * 7, w * 7 + 7).map((d, i) => {
            const dd = toDate(d);
            const outside = dd.getUTCMonth() !== m;
            const s = sums.get(d);
            const exp = expected.get(d) ?? [];
            const expOut = exp.filter((e) => e.amount > 0).reduce((a, e) => a + e.amount, 0);
            const expIn = -exp.filter((e) => e.amount < 0).reduce((a, e) => a + e.amount, 0);
            const dayNum = dd.getUTCDate();
            const label = dayNum === 1 && outside ? `${dd.getUTCMonth() + 1}.1` : String(dayNum);
            return (
              <button
                key={d}
                role="gridcell"
                className={'cal-cell' + (outside ? ' outside' : '') + (d > t ? ' future' : '') + (exp.length ? ' has-expected' : '')}
                onClick={() => onPickDay(d)}
                aria-label={`${d}${s ? `, income ${money(s.inc)}, expenses ${money(s.exp)}` : ''}${exp.length ? `, expected ${exp.map((e) => `${e.name} ${money(Math.abs(e.amount))}`).join(', ')}` : ''}`}
              >
                <span className={'cal-day' + (i === 6 ? ' sun' : '') + (d === t ? ' today' : '')}>{label}</span>
                {s && s.inc > 0.005 && <span className="pos cal-amt">{compact.format(s.inc)}</span>}
                {s && s.exp > 0.005 && <span className="neg cal-amt">{compact.format(s.exp)}</span>}
                {s && s.exp < -0.005 && <span className="pos cal-amt">{compact.format(-s.exp)}</span>}
                {expOut > 0.005 && <span className="cal-amt cal-expected neg">~{short(expOut)}</span>}
                {expIn > 0.005 && <span className="cal-amt cal-expected pos">~{short(expIn)}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function Transactions({ initialQuery = '' }: { initialQuery?: string }) {
  const { data, txns, period, setPeriod, filters } = useData();
  const { coverage } = useInsights();
  const [expectedDay, setExpectedDay] = useState<string | null>(null);
  // Upcoming bills events by day: today (still due) and the future. Paid statements are left out.
  const expected = useMemo(() => {
    const m = new Map<string, CoverageEvent[]>();
    const t0 = today();
    for (const e of coverage?.events ?? []) {
      if (e.paid || e.amount === 0 || e.date < t0) continue;
      m.set(e.date, [...(m.get(e.date) ?? []), e]);
    }
    return m;
  }, [coverage]);
  const [query, setQuery] = useState(initialQuery);
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<Txn | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<'list' | 'calendar'>(() => (localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list'));
  const sentinel = useRef<HTMLDivElement>(null);
  const r = range(period);

  const accounts = useMemo(
    () => new Map<string, Account>((data?.accounts ?? []).map((a) => [a.account_id, a])),
    [data],
  );

  // Filters + search (no date limit) — reused by the calendar grid, which shows adjacent days too.
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = applyFilters(txns, filters);
    if (!q) return base;
    return base.filter((t) =>
      [t.name, t.merchant_name, t.note, t.subcategory, category(t.category).label, accountLabel(t, accounts)]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q)),
    );
  }, [txns, filters, query, accounts]);

  const calendarMonth = monthStart(r.start ?? today());
  const filtered = useMemo(() => {
    if (view === 'calendar') {
      const cr = { start: calendarMonth, end: monthStart(addDays(calendarMonth, 32)) };
      return matching.filter((t) => inRange(t.date, cr));
    }
    return matching.filter((t) => inRange(t.date, r));
  }, [matching, r.start, r.end, view, calendarMonth]);

  const totals = useMemo(() => cashflow(filtered, { start: null, end: null }), [filtered]);

  const groups = useMemo(() => {
    const out: { date: string; items: Txn[]; sum: number }[] = [];
    for (const t of filtered.slice(0, limit)) {
      let g = out[out.length - 1];
      if (!g || g.date !== t.date) out.push((g = { date: t.date, items: [], sum: 0 }));
      g.items.push(t);
      if (!isTransfer(t)) g.sum -= t.amount; // net flow for the day
    }
    return out;
  }, [filtered, limit]);

  useEffect(() => setLimit(PAGE), [r.start, r.end, filters, query]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setLimit((l) => l + PAGE);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [groups.length]);

  const switchView = (v: 'list' | 'calendar') => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
    if (v === 'calendar' && period.kind !== 'month') setPeriod({ kind: 'month', anchor: r.start ?? today() });
  };

  const jumpToToday = () => {
    const kind = view === 'calendar' || period.kind === 'custom' || period.kind === 'all' ? 'month' : period.kind;
    setPeriod({ kind, anchor: today() });
  };

  return (
    <div className="page">
      <div className="search-bar">
        <Search size={24} aria-hidden="true" />
        <input
          type="search"
          placeholder="Search"
          aria-label="Search transactions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
            <X size={20} />
          </button>
        )}
        <button
          className="icon-btn"
          onClick={() => switchView(view === 'list' ? 'calendar' : 'list')}
          aria-label={view === 'list' ? 'Show calendar' : 'Show list'}
        >
          {view === 'list' ? <LayoutGrid size={24} /> : <List size={24} />}
        </button>
        <button className="icon-btn" onClick={jumpToToday} aria-label="Jump to today">
          <CalendarClock size={24} />
        </button>
      </div>
      <PeriodBar right={<FilterButton onClick={() => setShowFilters(true)} />} />
      <ActiveFilters />
      <div className="totals-row">
        <span className="pos">{money(totals.income)}</span>
        <span className="neg">{money(totals.expense)}</span>
        <span className={totals.net >= 0 ? 'pos' : 'neg'}>∑ {signedMoney(totals.net)}</span>
      </div>

      {view === 'calendar' ? (
        <CalendarView
          month={calendarMonth}
          txns={matching}
          expected={expected}
          onPickDay={(d) => {
            if (d > today() && expected.has(d)) return setExpectedDay(d);
            setPeriod({ kind: 'day', anchor: d });
            switchView('list');
          }}
        />
      ) : null}
      {view === 'calendar' && expected.size > 0 && (
        <p className="muted cal-legend">Dashed ~amounts are expected from Upcoming bills. Tap a day to see them.</p>
      )}
      {view === 'list' && (
        <>
          {period.kind === 'day' && expected.has(period.anchor) && (
            <button className="expected-banner" onClick={() => setExpectedDay(period.anchor)}>
              <CalendarClock size={18} aria-hidden="true" />
              <span>
                {period.anchor === today() ? 'Still expected today' : 'Expected this day'}:{' '}
                {(expected.get(period.anchor) ?? []).map((e) => `${e.name} ${money(Math.abs(e.amount))}`).join(' · ')}
              </span>
            </button>
          )}
          {groups.map((g) => {
            const d = toDate(g.date);
            return (
              <section key={g.date} className="day-group" aria-label={g.date}>
                <header className="day-header">
                  <span className="day-num">{String(d.getUTCDate()).padStart(2, '0')}</span>
                  <span className="day-text">
                    <span>{weekday(d.getUTCDay())}</span>
                    <span className="muted">
                      {monthLong(d.getUTCMonth())} {d.getUTCFullYear()}
                    </span>
                  </span>
                  <span className={'day-sum ' + (g.sum >= 0 ? 'pos' : 'neg')}>∑ {signedMoney(g.sum)}</span>
                </header>
                {g.items.map((t) => (
                  <TxnRow key={t.id} t={t} account={accountLabel(t, accounts)} onClick={() => setEditing(t)} />
                ))}
              </section>
            );
          })}
          {!filtered.length && (
            <p className="empty">No transactions{query ? ' match your search' : ' in this period'}.</p>
          )}
          {filtered.length > limit && <div ref={sentinel} className="sentinel" />}
        </>
      )}


      {editing && <TxnSheet t={editing} account={accountLabel(editing, accounts)} onClose={() => setEditing(null)} />}
      {showFilters && <FiltersSheet onClose={() => setShowFilters(false)} />}
      {expectedDay && <ExpectedSheet date={expectedDay} events={expected.get(expectedDay) ?? []} onClose={() => setExpectedDay(null)} />}
    </div>
  );
}

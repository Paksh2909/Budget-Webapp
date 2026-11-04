import { CalendarClock, LayoutGrid, List, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cashflow, isIncome, isTransfer } from '../calc';
import { category } from '../categories';
import { FiltersSheet } from '../components/FiltersSheet';
import { accountLabel, AddTxnSheet, TxnRow, TxnSheet } from '../components/Transactions';
import { ActiveFilters, FilterButton, PeriodBar } from '../components/ui';
import { useData } from '../data';
import { applyFilters } from '../filters';
import { monthLong, signedMoney, money, weekday } from '../format';
import { addDays, inRange, monthStart, range, today, toDate } from '../period';
import type { Account, Txn } from '../types';

const PAGE = 150;
const VIEW_KEY = 'budget.txnView';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const compact = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function CalendarView({ month, txns, onPickDay }: { month: string; txns: Txn[]; onPickDay: (d: string) => void }) {
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
            const dayNum = dd.getUTCDate();
            const label = dayNum === 1 && outside ? `${dd.getUTCMonth() + 1}.1` : String(dayNum);
            return (
              <button
                key={d}
                role="gridcell"
                className={'cal-cell' + (outside ? ' outside' : '') + (d > t ? ' future' : '')}
                onClick={() => onPickDay(d)}
                aria-label={`${d}${s ? `, income ${money(s.inc)}, expenses ${money(s.exp)}` : ''}`}
              >
                <span className={'cal-day' + (i === 6 ? ' sun' : '') + (d === t ? ' today' : '')}>{label}</span>
                {s && s.inc > 0.005 && <span className="pos cal-amt">{compact.format(s.inc)}</span>}
                {s && s.exp > 0.005 && <span className="neg cal-amt">{compact.format(s.exp)}</span>}
                {s && s.exp < -0.005 && <span className="pos cal-amt">{compact.format(-s.exp)}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function Transactions() {
  const { data, txns, period, setPeriod, filters } = useData();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<Txn | null>(null);
  const [adding, setAdding] = useState(false);
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
          onPickDay={(d) => {
            setPeriod({ kind: 'day', anchor: d });
            switchView('list');
          }}
        />
      ) : (
        <>
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

      <button className="fab" onClick={() => setAdding(true)} aria-label="Add cash transaction">
        <Plus size={30} />
      </button>

      {editing && <TxnSheet t={editing} account={accountLabel(editing, accounts)} onClose={() => setEditing(null)} />}
      {adding && <AddTxnSheet onClose={() => setAdding(false)} />}
      {showFilters && <FiltersSheet onClose={() => setShowFilters(false)} />}
    </div>
  );
}

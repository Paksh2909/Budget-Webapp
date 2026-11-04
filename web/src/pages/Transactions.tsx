import { Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cashflow, isTransfer } from '../calc';
import { category } from '../categories';
import { accountLabel, AddTxnSheet, TxnRow, TxnSheet } from '../components/Transactions';
import { PeriodBar } from '../components/ui';
import { useData } from '../data';
import { money, monthLong, signedMoney, weekday } from '../format';
import { inRange, range, toDate } from '../period';
import { navigate } from '../router';
import type { Account, Txn } from '../types';

const PAGE = 150;

export function Transactions({ categoryFilter }: { categoryFilter: string | null }) {
  const { data, txns, period } = useData();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<Txn | null>(null);
  const [adding, setAdding] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const r = range(period);

  const accounts = useMemo(
    () => new Map<string, Account>((data?.accounts ?? []).map((a) => [a.account_id, a])),
    [data],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return txns.filter((t) => {
      if (!inRange(t.date, r)) return false;
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (!q) return true;
      return [t.name, t.merchant_name, t.note, t.subcategory, category(t.category).label, accountLabel(t, accounts)]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q));
    });
  }, [txns, r.start, r.end, categoryFilter, query, accounts]);

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

  useEffect(() => setLimit(PAGE), [r.start, r.end, categoryFilter, query]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setLimit((l) => l + PAGE);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [groups.length]);

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
      </div>
      <PeriodBar />
      {categoryFilter && (
        <div className="chips">
          <button className="chip" onClick={() => navigate('/transactions')} aria-label={`Remove ${category(categoryFilter).label} filter`}>
            {category(categoryFilter).label} <X size={16} />
          </button>
        </div>
      )}
      <div className="totals-row">
        <span className="pos">{money(totals.income)}</span>
        <span className="neg">{money(totals.expense)}</span>
        <span className={totals.net >= 0 ? 'pos' : 'neg'}>∑ {signedMoney(totals.net)}</span>
      </div>

      {groups.map((g) => {
        const d = toDate(g.date);
        return (
          <section key={g.date} className="day-group" aria-label={g.date}>
            <header className="day-header">
              <span className="day-num">{d.getUTCDate()}</span>
              <span className="day-text">
                <span>{weekday(d.getUTCDay())}</span>
                <span className="muted">
                  {monthLong(d.getUTCMonth())} {d.getUTCFullYear()}
                </span>
              </span>
              <span className="day-sum">∑ {signedMoney(g.sum)}</span>
            </header>
            {g.items.map((t) => (
              <TxnRow key={t.id} t={t} account={accountLabel(t, accounts)} onClick={() => setEditing(t)} />
            ))}
          </section>
        );
      })}
      {!filtered.length && <p className="empty">No transactions{query ? ' match your search' : ' in this period'}.</p>}
      {filtered.length > limit && <div ref={sentinel} className="sentinel" />}

      <button className="fab" onClick={() => setAdding(true)} aria-label="Add cash transaction">
        <Plus size={30} />
      </button>

      {editing && <TxnSheet t={editing} account={accountLabel(editing, accounts)} onClose={() => setEditing(null)} />}
      {adding && <AddTxnSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { visibleTxns } from './calc';
import { EMPTY_FILTERS, type Filters } from './filters';
import { applyRules } from './rules';
import { today, type Period } from './period';
import type { AppData, Txn } from './types';

interface SyncResult {
  itemId: string;
  status: 'ok' | 'login_required' | 'error';
  hasMore: boolean;
  message?: string;
}

interface DataCtx {
  data: AppData | null;
  txns: Txn[]; // transactions on visible accounts
  loading: boolean;
  error: string | null;
  syncing: boolean;
  reload: () => Promise<void>;
  syncAll: () => Promise<void>;
  syncItem: (itemId: string) => Promise<void>;
  period: Period;
  setPeriod: (p: Period) => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  toast: string | null;
  showToast: (msg: string) => void;
}

const Ctx = createContext<DataCtx | null>(null);
const PERIOD_KEY = 'budget.period';
const AUTO_SYNC_MS = 6 * 60 * 60 * 1000;

function loadPeriod(): Period {
  try {
    const p = JSON.parse(localStorage.getItem(PERIOD_KEY) ?? '') as Period;
    if (p && ["day", "week", "month", "year", "all"].includes(p.kind)) return { kind: p.kind, anchor: today() };
  } catch {
    /* ignore */
  }
  return { kind: 'month', anchor: today() };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [period, setPeriodState] = useState<Period>(loadPeriod);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>(undefined);
  const autoSynced = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const raw = await api<AppData>('/api/data');
      const rules = raw.rules ?? [];
      setData({ ...raw, rules, transactions: applyRules(raw.transactions, rules) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const runItemSync = useCallback(async (itemId: string): Promise<SyncResult> => {
    // Each call processes a few pages; keep going until Plaid says we're caught up.
    for (let i = 0; i < 25; i++) {
      const r = await api<SyncResult>(`/api/items/${encodeURIComponent(itemId)}/sync`, { method: 'POST' });
      if (r.status !== 'ok' || !r.hasMore) return r;
    }
    return { itemId, status: 'ok', hasMore: true };
  }, []);

  const syncItem = useCallback(
    async (itemId: string) => {
      setSyncing(true);
      try {
        const r = await runItemSync(itemId);
        if (r.status !== 'ok') showToast(r.message ?? 'Bank needs attention');
        await reload();
      } catch (e) {
        showToast((e as Error).message);
      } finally {
        setSyncing(false);
      }
    },
    [reload, runItemSync, showToast],
  );

  const syncAll = useCallback(async () => {
    if (!data?.items.length) {
      showToast('Link a bank first');
      return;
    }
    setSyncing(true);
    try {
      let problems = 0;
      for (const item of data.items) {
        try {
          const r = await runItemSync(item.item_id);
          if (r.status !== 'ok') problems++;
        } catch {
          problems++;
        }
      }
      await reload();
      showToast(problems ? `${problems} bank(s) need attention` : 'Up to date');
    } finally {
      setSyncing(false);
    }
  }, [data, reload, runItemSync, showToast]);

  const setPeriod = useCallback((p: Period) => {
    setPeriodState(p);
    // Remember the kind of range (not custom dates) for next launch.
    if (p.kind !== 'custom') localStorage.setItem(PERIOD_KEY, JSON.stringify({ kind: p.kind }));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Auto-sync on open if the last sync is stale.
  useEffect(() => {
    if (!data || autoSynced.current || !data.items.length) return;
    autoSynced.current = true;
    const last = Math.min(...data.items.map((i) => (i.last_synced_at ? Date.parse(i.last_synced_at) : 0)));
    if (Date.now() - last > AUTO_SYNC_MS) void syncAll();
  }, [data, syncAll]);

  const txns = useMemo(() => (data ? visibleTxns(data.transactions, data.accounts) : []), [data]);

  const value = useMemo(
    () => ({ data, txns, loading, error, syncing, reload, syncAll, syncItem, period, setPeriod, filters, setFilters, toast, showToast }),
    [data, txns, loading, error, syncing, reload, syncAll, syncItem, period, setPeriod, filters, toast, showToast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData must be used inside DataProvider');
  return v;
}

import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { budgetSpent } from '../calc';
import { EXPENSE_CATEGORIES, type CategoryId } from '../categories';
import { CategoryIcon, PageHeader, ProgressRing, Sheet } from '../components/ui';
import { useData } from '../data';
import { money, signedMoney } from '../format';
import { isCurrent, label, range, shift, today, type Period } from '../period';
import { navigate } from '../router';
import type { Budget } from '../types';

function BudgetSheet({ budget, onClose }: { budget: Budget | null; onClose: () => void }) {
  const { reload, showToast } = useData();
  const [name, setName] = useState(budget?.name ?? 'Monthly');
  const [amount, setAmount] = useState(budget ? String(budget.amount) : '');
  const [cats, setCats] = useState<CategoryId[]>(budget?.categories ?? []);
  const [busy, setBusy] = useState(false);
  const value = Number(amount.replace(/[^0-9.]/g, ''));
  const valid = name.trim() && value > 0;

  const toggle = (id: CategoryId) => setCats((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const save = async () => {
    setBusy(true);
    try {
      const body = { name: name.trim(), amount: value, categories: cats };
      if (budget) await api(`/api/budgets/${budget.id}`, { method: 'PUT', body });
      else await api('/api/budgets', { method: 'POST', body });
      await reload();
      onClose();
    } catch (e) {
      showToast((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!budget || !confirm(`Delete budget "${budget.name}"?`)) return;
    setBusy(true);
    try {
      await api(`/api/budgets/${budget.id}`, { method: 'DELETE' });
      await reload();
      onClose();
    } catch (e) {
      showToast((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title={budget ? 'Edit budget' : 'New budget'} onClose={onClose}>
      <label className="field">
        <span className="field-label">Name</span>
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Monthly limit</span>
        <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <h3 className="field-label">Categories {cats.length ? '' : '(all spending)'}</h3>
      <div className="cat-grid">
        {EXPENSE_CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={'cat-choice' + (cats.includes(c.id) ? ' selected' : '')}
            aria-pressed={cats.includes(c.id)}
            onClick={() => toggle(c.id)}
          >
            <CategoryIcon id={c.id} size={40} />
            <span>{c.label}</span>
          </button>
        ))}
      </div>
      <div className="sheet-actions">
        {budget && (
          <button className="btn danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
        <button className="btn primary" onClick={save} disabled={!valid || busy}>
          Save
        </button>
      </div>
    </Sheet>
  );
}

export function Budgets() {
  const { data, txns } = useData();
  const [month, setMonth] = useState<Period>({ kind: 'month', anchor: today() });
  const [editing, setEditing] = useState<Budget | 'new' | null>(null);
  const r = range(month);
  const budgets = data?.budgets ?? [];

  return (
    <div className="page">
      <PageHeader
        title="Budgets"
        onBack={() => navigate('/')}
        actions={
          <button className="icon-btn" onClick={() => setEditing('new')} aria-label="New budget">
            <Plus size={24} />
          </button>
        }
      />
      <div className="period-bar">
        <span className="period-label static">{label(month)}</span>
        <div className="period-nav">
          <button className="icon-btn" onClick={() => setMonth(shift(month, -1))} aria-label="Previous month">
            <ChevronLeft size={20} />
          </button>
          <button className="icon-btn" disabled={isCurrent(month)} onClick={() => setMonth(shift(month, 1))} aria-label="Next month">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {budgets.map((b) => {
        const spent = budgetSpent(b, txns, r);
        const pct = spent / b.amount;
        const left = b.amount - spent;
        const color = pct >= 1 ? 'var(--neg)' : pct >= 0.85 ? '#f59e0b' : 'var(--accent)';
        return (
          <button key={b.id} className="card budget-card" onClick={() => setEditing(b)}>
            <ProgressRing value={pct} size={64} stroke={5} color={color}>
              <span className="small">{Math.round(pct * 100)}%</span>
            </ProgressRing>
            <span className="budget-text">
              <span className="card-title">{b.name}</span>
              <span className="muted small">
                {money(spent)} of {money(b.amount)}
              </span>
              <span className="budget-cats">
                {b.categories.length
                  ? b.categories.map((c) => <CategoryIcon key={c} id={c} size={20} />)
                  : <span className="muted small">All spending</span>}
              </span>
            </span>
            <span className="budget-left">
              <span className={left >= 0 ? 'pos' : 'neg'}>{signedMoney(left)}</span>
              <span className="muted small">{left >= 0 ? 'left' : 'over'}</span>
            </span>
          </button>
        );
      })}
      {!budgets.length && (
        <div className="empty">
          <p>No budgets yet. Create one for all spending or a few categories.</p>
          <button className="btn primary" onClick={() => setEditing('new')}>
            Create a budget
          </button>
        </div>
      )}
      {budgets.length > 0 && <p className="hint">Tap a budget to edit it. Budgets reset each calendar month.</p>}

      {editing && <BudgetSheet budget={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

import { Clock, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { accountName, MANUAL_ACCOUNT_ID } from '../calc';
import { CATEGORIES, category, DEFAULT_SUBCATEGORIES, type CategoryId } from '../categories';
import { useData } from '../data';
import { money, timeOf } from '../format';
import type { Account, Txn } from '../types';
import { CategoryIcon, Sheet } from './ui';

export function accountLabel(t: Txn, accounts: Map<string, Account>): string {
  if (t.account_id === MANUAL_ACCOUNT_ID) return 'Cash';
  const a = accounts.get(t.account_id);
  return a ? accountName(a) : 'Account';
}

export function TxnRow({ t, account, onClick }: { t: Txn; account: string; onClick: () => void }) {
  const c = category(t.category);
  const isIn = t.amount < 0;
  const sub = t.subcategory ?? t.merchant_name ?? t.name;
  const detail = t.note ?? (t.merchant_name && t.merchant_name !== sub ? t.merchant_name : t.subcategory ? t.name : null);
  return (
    <button className="txn-row" onClick={onClick}>
      <span className="txn-pending" aria-label={t.pending ? 'Pending' : undefined}>
        {t.pending ? <Clock size={22} /> : null}
      </span>
      <CategoryIcon id={t.category} logo={t.logo_url} />
      <span className="txn-main">
        <span className="txn-title">
          {c.label} <span className="muted-dot">•</span> {sub}
        </span>
        <span className="txn-account">{account}</span>
        {detail && <span className="txn-note">{detail}</span>}
      </span>
      <span className="txn-side">
        <span className={isIn ? 'pos' : 'neg'}>{isIn ? '+' + money(-t.amount) : money(t.amount)}</span>
        {timeOf(t.datetime) && <span className="txn-time">{timeOf(t.datetime)}</span>}
      </span>
    </button>
  );
}

function CategoryPicker({ value, onChange }: { value: CategoryId; onChange: (c: CategoryId) => void }) {
  return (
    <div className="cat-grid" role="radiogroup" aria-label="Category">
      {CATEGORIES.map((c) => (
        <button
          key={c.id}
          role="radio"
          aria-checked={value === c.id}
          className={'cat-choice' + (value === c.id ? ' selected' : '')}
          onClick={() => onChange(c.id)}
        >
          <CategoryIcon id={c.id} size={40} />
          <span>{c.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Suggested + previously used subcategories for a category. value "" means none. */
function SubcategoryPicker({ categoryId, value, onChange }: { categoryId: CategoryId; value: string; onChange: (v: string) => void }) {
  const { data } = useData();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const options = useMemo(() => {
    const set = new Set(DEFAULT_SUBCATEGORIES[categoryId]);
    for (const t of data?.transactions ?? []) if (t.category === categoryId && t.subcategory) set.add(t.subcategory);
    if (value) set.add(value);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [data, categoryId, value]);

  const commit = () => {
    const v = draft.trim().slice(0, 60);
    if (v) onChange(v);
    setDraft('');
    setAdding(false);
  };

  return (
    <div className="chip-wrap" role="radiogroup" aria-label="Subcategory">
      <button role="radio" aria-checked={value === ''} className={'chip' + (value === '' ? ' active' : '')} onClick={() => onChange('')}>
        None
      </button>
      {options.map((o) => (
        <button key={o} role="radio" aria-checked={value === o} className={'chip' + (value === o ? ' active' : '')} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
      {adding ? (
        <input
          className="chip-input"
          autoFocus
          maxLength={60}
          value={draft}
          placeholder="New subcategory"
          aria-label="New subcategory name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); }
          }}
        />
      ) : (
        <button className="chip" onClick={() => setAdding(true)} aria-label="Add subcategory">
          <Plus size={16} aria-hidden="true" /> New
        </button>
      )}
    </div>
  );
}

export function TxnSheet({ t, account, onClose }: { t: Txn; account: string; onClose: () => void }) {
  const { reload, showToast } = useData();
  const [cat, setCat] = useState<CategoryId>(t.category);
  const [sub, setSub] = useState(t.subcategory ?? '');
  const [note, setNote] = useState(t.note ?? '');
  const changeCategory = (c: CategoryId) => {
    setCat(c);
    // Keep the subcategory only if it belongs with the new category.
    if (c !== cat) setSub(c === t.auto_category ? (t.auto_subcategory ?? '') : '');
  };
  const [busy, setBusy] = useState(false);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api(`/api/transactions/${encodeURIComponent(t.id)}`, { method: 'PATCH', body });
      await reload();
      onClose();
    } catch (e) {
      showToast((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this transaction?')) return;
    setBusy(true);
    try {
      await api(`/api/transactions/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
      await reload();
      onClose();
    } catch (e) {
      showToast((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title={t.merchant_name ?? t.name} onClose={onClose}>
      <div className="txn-detail">
        <div className={'big-amount ' + (t.amount < 0 ? 'pos' : 'neg')}>
          {t.amount < 0 ? '+' + money(-t.amount) : money(t.amount)}
        </div>
        <dl>
          <dt>Date</dt>
          <dd>
            {t.date}
            {t.pending ? ' (pending)' : ''}
          </dd>
          <dt>Account</dt>
          <dd>{account}</dd>
          <dt>Description</dt>
          <dd>{t.name}</dd>
        </dl>
      </div>
      <h3 className="field-label">Category</h3>
      <CategoryPicker value={cat} onChange={changeCategory} />
      <h3 className="field-label">Subcategory</h3>
      <SubcategoryPicker categoryId={cat} value={sub} onChange={setSub} />
      <label className="field">
        <span className="field-label">Note</span>
        <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" />
      </label>
      <div className="sheet-actions">
        {t.source === 'manual' ? (
          <button className="btn danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        ) : t.overridden ? (
          <button className="btn ghost" onClick={() => save({ category: null, subcategory: null })} disabled={busy}>
            Reset category
          </button>
        ) : null}
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => {
            const autoCat = cat === t.auto_category;
            save({
              category: autoCat ? null : cat,
              // null = follow Plaid; "" = explicitly none
              subcategory: autoCat && sub === (t.auto_subcategory ?? '') ? null : sub,
              note: note.trim() || null,
            });
          }}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}

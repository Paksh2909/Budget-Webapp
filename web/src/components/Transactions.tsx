import { Clock } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { accountName, MANUAL_ACCOUNT_ID } from '../calc';
import { CATEGORIES, category, type CategoryId } from '../categories';
import { useData } from '../data';
import { money, timeOf } from '../format';
import { today } from '../period';
import type { Account, Txn } from '../types';
import { CategoryIcon, Segmented, Sheet } from './ui';

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

export function TxnSheet({ t, account, onClose }: { t: Txn; account: string; onClose: () => void }) {
  const { reload, showToast } = useData();
  const [cat, setCat] = useState<CategoryId>(t.category);
  const [note, setNote] = useState(t.note ?? '');
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
      <CategoryPicker value={cat} onChange={setCat} />
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
          <button className="btn ghost" onClick={() => save({ category: null })} disabled={busy}>
            Reset category
          </button>
        ) : null}
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => save({ category: cat === t.auto_category && !t.overridden ? null : cat, note: note.trim() || null })}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}

export function AddTxnSheet({ onClose }: { onClose: () => void }) {
  const { reload, showToast } = useData();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState(today());
  const [cat, setCat] = useState<CategoryId>('food');
  const [busy, setBusy] = useState(false);

  const value = Number(amount.replace(/[^0-9.]/g, ''));
  const valid = value > 0 && name.trim().length > 0 && !!date;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api('/api/transactions', {
        method: 'POST',
        body: {
          amount: kind === 'expense' ? value : -value,
          name: name.trim(),
          date,
          category: kind === 'income' ? 'income' : cat,
        },
      });
      await reload();
      onClose();
    } catch (e) {
      showToast((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title="Add cash transaction" onClose={onClose}>
      <Segmented
        ariaLabel="Type"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
        ]}
      />
      <label className="field">
        <span className="field-label">Amount</span>
        <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Description</span>
        <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Farmers market" />
      </label>
      <label className="field">
        <span className="field-label">Date</span>
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </label>
      {kind === 'expense' && (
        <>
          <h3 className="field-label">Category</h3>
          <CategoryPicker value={cat} onChange={setCat} />
        </>
      )}
      <div className="sheet-actions">
        <button className="btn primary" onClick={submit} disabled={!valid || busy}>
          Add
        </button>
      </div>
    </Sheet>
  );
}

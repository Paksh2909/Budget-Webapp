import { CalendarClock, Clock, Plus } from 'lucide-react';
import { BillSheet, type BillDraft } from './BillSheet';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { accountName, MANUAL_ACCOUNT_ID } from '../calc';
import { CATEGORIES, category, DEFAULT_SUBCATEGORIES, type CategoryId } from '../categories';
import { useData } from '../data';
import { money, timeOf } from '../format';
import { billMatches } from '../recurring';
import { matchText, suggestPattern } from '../rules';
import { toDate } from '../period';
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
      <CategoryIcon id={t.category} logo={t.logo_url} size={36} />
      <span className="txn-main">
        <span className="txn-title">
          {c.label} <span className="muted-dot">•</span> {sub}
        </span>
        <span className="txn-meta">
          <span className="txn-account">{account}</span>
          {detail && <span className="txn-note"> · {detail}</span>}
        </span>
      </span>
      <span className="txn-side">
        <span className={isIn ? 'pos' : 'neg'}>{isIn ? '+' + money(-t.amount) : money(t.amount)}</span>
        {(t.pending || timeOf(t.datetime)) && (
          <span className="txn-time">
            {t.pending ? (
              <>
                <Clock size={11} aria-hidden="true" /> Pending
              </>
            ) : (
              timeOf(t.datetime)
            )}
          </span>
        )}
      </span>
    </button>
  );
}

export function CategoryPicker({ value, onChange }: { value: CategoryId; onChange: (c: CategoryId) => void }) {
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
export function SubcategoryPicker({ categoryId, value, onChange }: { categoryId: CategoryId; value: string; onChange: (v: string) => void }) {
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
  const { data, reload, showToast } = useData();
  const [cat, setCat] = useState<CategoryId>(t.category);
  const [sub, setSub] = useState(t.subcategory ?? '');
  const [note, setNote] = useState(t.note ?? '');
  const [makeRule, setMakeRule] = useState(false);
  const [pattern, setPattern] = useState(() => suggestPattern(t));
  const [billDraft, setBillDraft] = useState<BillDraft | null>(null);
  // Already tracked? (A bill whose pattern + account match this transaction.)
  const trackedBill = data?.bills.find((b) => billMatches(b, [t]).length > 0);
  const openTrack = () => {
    if (trackedBill) return setBillDraft(trackedBill);
    const day = toDate(t.date).getUTCDate();
    setBillDraft({
      name: t.merchant_name ?? suggestPattern(t),
      pattern: suggestPattern(t),
      account_id: t.account_id,
      day_start: Math.max(1, day - 2),
      day_end: Math.min(31, day + 2),
    });
  };
  const rule = t.rule_id ? data?.rules.find((r) => r.id === t.rule_id) : undefined;
  const partner = t.matched_with ? data?.transactions.find((x) => x.id === t.matched_with) : undefined;
  const partnerAcct = partner ? data?.accounts.find((a) => a.account_id === partner.account_id) : undefined;
  const partnerAccount = partnerAcct ? accountName(partnerAcct) : 'another account';
  // How many transactions the rule would affect (excluding hand-categorized ones).
  const ruleMatches = useMemo(() => {
    const p = pattern.trim().toLowerCase();
    if (!makeRule || p.length < 2) return 0;
    return (data?.transactions ?? []).filter((x) => !x.cat_overridden && matchText(x).includes(p)).length;
  }, [makeRule, pattern, data]);
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
          {partner && (
            <>
              <dt>Paired with</dt>
              <dd>
                {partner.amount < 0 ? 'Payment received' : 'Payment sent'} · {partnerAccount} · {partner.date}
              </dd>
            </>
          )}
          {rule && !t.cat_overridden && (
            <>
              <dt>Rule</dt>
              <dd>
                <a href="#/rules" className="link">
                  Contains “{rule.pattern}”
                </a>
              </dd>
            </>
          )}
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
      {t.source === 'plaid' && t.amount > 0 && (
        <button className="link-row track-row" onClick={openTrack}>
          <CalendarClock size={20} aria-hidden="true" />
          <span>{trackedBill ? `Tracked as bill: ${trackedBill.name}` : 'Track as a monthly bill'}</span>
          <span className="muted small">{trackedBill ? 'Edit' : 'e.g. rent'}</span>
        </button>
      )}
      {t.source === 'plaid' && (
        <div className="rule-box">
          <label className="toggle-row">
            <input type="checkbox" checked={makeRule} onChange={(e) => setMakeRule(e.target.checked)} />
            <span>Always categorize matching transactions like this</span>
          </label>
          {makeRule && (
            <label className="field">
              <span className="field-label">When the description contains</span>
              <input value={pattern} maxLength={80} onChange={(e) => setPattern(e.target.value)} />
              <span className="muted small">
                {pattern.trim().length < 2 ? 'Enter at least 2 characters' : `Matches ${ruleMatches} transaction${ruleMatches === 1 ? '' : 's'}`}
              </span>
            </label>
          )}
        </div>
      )}
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
          disabled={busy || (makeRule && pattern.trim().length < 2)}
          onClick={async () => {
            if (makeRule) {
              setBusy(true);
              try {
                await api('/api/rules', {
                  method: 'POST',
                  body: { pattern: pattern.trim(), category: cat, subcategory: sub || null },
                });
              } catch (e) {
                showToast((e as Error).message);
                setBusy(false);
                return;
              }
              // Let the new rule decide this transaction too.
              await save({ category: null, subcategory: null, note: note.trim() || null });
              showToast(`Rule saved · ${ruleMatches} transaction${ruleMatches === 1 ? '' : 's'} updated`);
              return;
            }
            const autoCat = cat === t.auto_category;
            save({
              category: autoCat ? null : cat,
              // null = follow Plaid (or a rule); "" = explicitly none
              subcategory: autoCat && sub === (t.auto_subcategory ?? '') ? null : sub,
              note: note.trim() || null,
            });
          }}
        >
          Save
        </button>
      </div>
      {billDraft && <BillSheet draft={billDraft} onClose={() => setBillDraft(null)} />}
    </Sheet>
  );
}

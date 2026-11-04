import { Plus, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { category, type CategoryId } from '../categories';
import { CategoryPicker, SubcategoryPicker } from '../components/Transactions';
import { CategoryIcon, PageHeader, Sheet } from '../components/ui';
import { useData } from '../data';
import { matchText, sortRules } from '../rules';
import { navigate } from '../router';
import type { Rule } from '../types';

function RuleSheet({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const { data, reload, showToast } = useData();
  const [pattern, setPattern] = useState(rule?.pattern ?? '');
  const [cat, setCat] = useState<CategoryId>(rule?.category ?? 'food');
  const [sub, setSub] = useState(rule?.subcategory ?? '');
  const [busy, setBusy] = useState(false);

  const p = pattern.trim().toLowerCase();
  const matches = useMemo(
    () => (p.length < 2 ? [] : (data?.transactions ?? []).filter((t) => !t.cat_overridden && matchText(t).includes(p))),
    [p, data],
  );

  const save = async () => {
    setBusy(true);
    try {
      const body = { pattern: pattern.trim(), category: cat, subcategory: sub || null };
      if (rule) await api(`/api/rules/${rule.id}`, { method: 'PUT', body });
      else await api('/api/rules', { method: 'POST', body });
      await reload();
      onClose();
    } catch (e) {
      showToast((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!rule || !confirm(`Delete the rule for “${rule.pattern}”? Matching transactions go back to their automatic category.`)) return;
    setBusy(true);
    try {
      await api(`/api/rules/${rule.id}`, { method: 'DELETE' });
      await reload();
      onClose();
    } catch (e) {
      showToast((e as Error).message);
      setBusy(false);
    }
  };

  const names = [...new Set(matches.map((t) => t.merchant_name ?? t.name))].slice(0, 4);

  return (
    <Sheet title={rule ? 'Edit rule' : 'New rule'} onClose={onClose}>
      <label className="field">
        <span className="field-label">When the description contains</span>
        <input value={pattern} maxLength={80} placeholder="e.g. Costco" onChange={(e) => setPattern(e.target.value)} />
        <span className="muted small">
          {p.length < 2
            ? 'Not case-sensitive. Enter at least 2 characters.'
            : `Matches ${matches.length} transaction${matches.length === 1 ? '' : 's'}${names.length ? ': ' + names.join(', ') : ''}`}
        </span>
      </label>
      <h3 className="field-label">Set category to</h3>
      <CategoryPicker
        value={cat}
        onChange={(c) => {
          setCat(c);
          setSub('');
        }}
      />
      <h3 className="field-label">Subcategory</h3>
      <SubcategoryPicker categoryId={cat} value={sub} onChange={setSub} />
      <div className="sheet-actions">
        {rule && (
          <button className="btn danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
        <button className="btn primary" onClick={save} disabled={busy || p.length < 2}>
          Save
        </button>
      </div>
    </Sheet>
  );
}

export function Rules() {
  const { data } = useData();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const rules = useMemo(() => sortRules(data?.rules ?? []).sort((a, b) => a.pattern.localeCompare(b.pattern)), [data]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data?.transactions ?? []) if (t.rule_id) m.set(t.rule_id, (m.get(t.rule_id) ?? 0) + 1);
    return m;
  }, [data]);

  return (
    <div className="page">
      <PageHeader
        title="Rules"
        onBack={() => history.length > 1 ? history.back() : navigate('/categories')}
        actions={
          <button className="icon-btn" onClick={() => setEditing('new')} aria-label="New rule">
            <Plus size={24} />
          </button>
        }
      />
      <p className="hint">
        Rules set the category for any transaction whose merchant or description contains the text. They also apply to past transactions.
        A category you pick by hand on a transaction always wins.
      </p>

      {rules.length ? (
        <ul className="rule-list">
          {rules.map((r) => {
            const c = category(r.category);
            const n = counts.get(r.id) ?? 0;
            return (
              <li key={r.id}>
                <button className="rule-row" onClick={() => setEditing(r)}>
                  <CategoryIcon id={r.category} size={36} />
                  <span className="rule-main">
                    <span className="rule-pattern">“{r.pattern}”</span>
                    <span className="muted small">
                      → {c.label}
                      {r.subcategory ? ` • ${r.subcategory}` : ''}
                    </span>
                  </span>
                  <span className="muted small">{n} txn{n === 1 ? '' : 's'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty card">
          <Wand2 size={28} aria-hidden="true" />
          <p>No rules yet. Create one here, or tick “Always categorize matching transactions like this” when editing a transaction.</p>
          <button className="btn primary" onClick={() => setEditing('new')}>
            Create a rule
          </button>
        </div>
      )}

      {editing && <RuleSheet rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

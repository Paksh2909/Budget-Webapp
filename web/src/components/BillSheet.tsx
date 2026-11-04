import { useMemo, useState } from 'react';
import { api } from '../api';
import { accountName } from '../calc';
import { useData } from '../data';
import { money } from '../format';
import { billMatches } from '../recurring';
import type { TrackedBill } from '../types';
import { Sheet } from './ui';

export interface BillDraft {
  id?: string;
  name: string;
  pattern: string;
  account_id: string | null;
  day_start: number;
  day_end: number;
}

/** Create or edit a tracked bill (e.g. rent through Bilt, due between the 1st and 5th). */
export function BillSheet({ draft, onClose }: { draft: BillDraft | TrackedBill; onClose: () => void }) {
  const { data, reload, showToast } = useData();
  const [name, setName] = useState(draft.name);
  const [pattern, setPattern] = useState(draft.pattern);
  const [accountId, setAccountId] = useState<string>(draft.account_id ?? '');
  const [dayStart, setDayStart] = useState(String(draft.day_start));
  const [dayEnd, setDayEnd] = useState(String(draft.day_end));
  const [busy, setBusy] = useState(false);

  const ds = Number(dayStart);
  const de = Number(dayEnd);
  const daysValid = Number.isInteger(ds) && Number.isInteger(de) && ds >= 1 && de <= 31 && ds <= de;
  const matches = useMemo(
    () => billMatches({ pattern, account_id: accountId || null }, data?.transactions ?? []),
    [pattern, accountId, data],
  );
  const recent = matches.slice(-3);
  const avg = recent.length ? recent.reduce((s, t) => s + t.amount, 0) / recent.length : 0;
  const valid = name.trim().length > 0 && pattern.trim().length >= 2 && daysValid;
  // Plaid often labels rent paid through Bilt/Zelle/ACH as a transfer, which hides it from spending.
  const asTransfer = matches.filter((t) => t.category === 'transfer').length;
  const mostlyTransfer = matches.length > 0 && asTransfer / matches.length >= 0.5;
  const [countAsHousing, setCountAsHousing] = useState(true);

  const save = async () => {
    setBusy(true);
    try {
      const body = { name: name.trim(), pattern: pattern.trim(), accountId: accountId || null, dayStart: ds, dayEnd: de };
      if (draft.id) await api(`/api/bills/${draft.id}`, { method: 'PUT', body });
      else await api('/api/bills', { method: 'POST', body });
      if (mostlyTransfer && countAsHousing && !draft.id) {
        const exists = data?.rules.some((r) => r.pattern.toLowerCase() === pattern.trim().toLowerCase());
        if (!exists) await api('/api/rules', { method: 'POST', body: { pattern: pattern.trim(), category: 'housing', subcategory: 'Rent' } });
      }
      await reload();
      showToast(draft.id ? 'Bill updated' : `Tracking ${name.trim()}`);
      onClose();
    } catch (e) {
      showToast((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft.id || !confirm(`Stop tracking ${draft.name}?`)) return;
    setBusy(true);
    try {
      await api(`/api/bills/${draft.id}`, { method: 'DELETE' });
      await reload();
      onClose();
    } catch (e) {
      showToast((e as Error).message);
      setBusy(false);
    }
  };

  const accounts = data?.accounts ?? [];

  return (
    <Sheet title={draft.id ? 'Edit bill' : 'Track as monthly bill'} onClose={onClose}>
      <p className="muted small">
        Tracked bills show up in Recurring, the forecast, and Upcoming bills, even when the amount varies.
      </p>
      <label className="field">
        <span className="field-label">Name</span>
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rent" />
      </label>
      <label className="field">
        <span className="field-label">Match transactions whose description contains</span>
        <input value={pattern} maxLength={80} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. Bilt" />
      </label>
      <label className="field">
        <span className="field-label">Paid from</span>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Any account</option>
          {accounts.map((a) => (
            <option key={a.account_id} value={a.account_id}>
              {accountName(a)}
              {a.mask ? ` ••${a.mask}` : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span className="field-label">Usually paid between days</span>
        <div className="day-range">
          <input inputMode="numeric" aria-label="From day of month" value={dayStart} onChange={(e) => setDayStart(e.target.value.replace(/\D/g, ''))} />
          <span className="muted">and</span>
          <input inputMode="numeric" aria-label="To day of month" value={dayEnd} onChange={(e) => setDayEnd(e.target.value.replace(/\D/g, ''))} />
          <span className="muted small">of the month</span>
        </div>
        {!daysValid && <span className="error small">Use days 1–31, with the first no later than the second.</span>}
      </div>

      <div className="rule-box">
        {matches.length ? (
          <>
            <span className="small">
              Matches {matches.length} payment{matches.length === 1 ? '' : 's'} · expected about <strong>{money(avg)}</strong>
            </span>
            <span className="muted small">
              Recent: {recent
                .slice()
                .reverse()
                .map((t) => `${t.date} ${money(t.amount)}`)
                .join(' · ')}
            </span>
          </>
        ) : (
          <span className="muted small">No matching payments yet. The amount will fill in after the first one.</span>
        )}
      </div>

      {mostlyTransfer && !draft.id && (
        <label className="toggle-row">
          <input type="checkbox" checked={countAsHousing} onChange={(e) => setCountAsHousing(e.target.checked)} />
          <span>
            Count these as Housing • Rent spending
            <span className="muted small"> (they’re labeled as transfers, so they’re left out of spending right now)</span>
          </span>
        </label>
      )}

      <div className="sheet-actions">
        {draft.id && (
          <button className="btn danger" onClick={remove} disabled={busy}>
            Stop tracking
          </button>
        )}
        <button className="btn primary" onClick={save} disabled={!valid || busy}>
          Save
        </button>
      </div>
    </Sheet>
  );
}

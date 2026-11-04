import { AlertTriangle, CheckCircle2, ChevronDown, Settings2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { accountName } from '../calc';
import { DEFAULT_CUSHION, HORIZON_DAYS, type Coverage, type CoverageEvent } from '../coverage';
import { useData } from '../data';
import { money } from '../format';
import { addDays, today, toDate } from '../period';
import { navigate } from '../router';
import { LineChart } from './LineChart';
import { Sheet } from './ui';

const shortDate = (d: string) => toDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const SOURCE_LABEL: Record<CoverageEvent['source'], string> = {
  statement: 'Statement',
  tracked: 'Tracked',
  detected: 'Recurring',
  estimate: 'Estimate',
};

function SettingsSheet({ coverage, onClose }: { coverage: Coverage; onClose: () => void }) {
  const { data, reload, showToast } = useData();
  const cash = (data?.accounts ?? []).filter((a) => a.type === 'depository');
  const [account, setAccount] = useState<string>(data?.settings.billPayAccount ?? '');
  const [cushion, setCushion] = useState(String(data?.settings.cushion ?? DEFAULT_CUSHION));
  const [busy, setBusy] = useState(false);
  const cushionNum = Number(cushion);

  const save = async () => {
    setBusy(true);
    try {
      await api('/api/settings', { method: 'PUT', body: { billPayAccount: account || null, cushion: cushionNum } });
      await reload();
      onClose();
    } catch (e) {
      showToast((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title="Upcoming bills settings" onClose={onClose}>
      <div className="field">
        <span className="field-label">Bills are paid from</span>
        <div className="option-list" role="radiogroup" aria-label="Bill-pay account">
          <button className="option" role="radio" aria-checked={account === ''} onClick={() => setAccount('')}>
            <span className="option-text">
              <span>Detect automatically</span>
              <span className="muted small">
                Currently {coverage.account ? accountName(coverage.account) : 'none'} (where your card payments come from)
              </span>
            </span>
            {account === '' && <CheckCircle2 size={22} className="pos" />}
          </button>
          {cash.map((a) => (
            <button key={a.account_id} className="option" role="radio" aria-checked={account === a.account_id} onClick={() => setAccount(a.account_id)}>
              <span className="option-text">
                <span>{accountName(a)}</span>
                <span className="muted small">{money(a.available_balance ?? a.current_balance ?? 0)}</span>
              </span>
              {account === a.account_id && <CheckCircle2 size={22} className="pos" />}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span className="field-label">Warn me if it would drop below</span>
        <input inputMode="decimal" value={cushion} onChange={(e) => setCushion(e.target.value.replace(/[^0-9.]/g, ''))} />
      </label>
      <div className="sheet-actions">
        <button className="btn primary" onClick={save} disabled={busy || !Number.isFinite(cushionNum)}>
          Save
        </button>
      </div>
    </Sheet>
  );
}

export function CoverageCard({ coverage }: { coverage: Coverage }) {
  const [showAll, setShowAll] = useState(false);
  const [settings, setSettings] = useState(false);
  const c = coverage;
  if (!c.account) return null;

  const due = c.events.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const deposits = -c.events.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0);
  const StatusIcon = c.status === 'ok' ? CheckCircle2 : c.status === 'tight' ? AlertTriangle : XCircle;
  const statusText =
    c.status === 'ok'
      ? 'Covered'
      : c.status === 'tight'
        ? `Tight · dips to ${money(c.low.balance)} on ${shortDate(c.low.date)}`
        : `Short by ${money(-c.low.balance)} on ${shortDate(c.low.date)}`;
  const events = showAll ? c.events : c.events.slice(0, 5);
  const t = today();
  const xLabels = c.daily.map((_, i) => shortDate(addDays(t, i)));

  return (
    <section className="card" aria-labelledby="coverage-title">
      <div className="row-between">
        <div>
          <h2 id="coverage-title" className="card-title">
            Upcoming bills
          </h2>
          <p className="card-sub">
            Next {HORIZON_DAYS} days from {accountName(c.account)}
            {c.accountAuto ? ' (auto)' : ''}
          </p>
        </div>
        <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Upcoming bills settings">
          <Settings2 size={20} />
        </button>
      </div>

      <div className={`coverage-status ${c.status}`} role="status">
        <StatusIcon size={18} aria-hidden="true" />
        <span>{statusText}</span>
      </div>

      <dl className="coverage-sum">
        <div>
          <dt>Balance now</dt>
          <dd>{money(c.start)}</dd>
        </div>
        <div>
          <dt>Due</dt>
          <dd className="neg">−{money(due)}</dd>
        </div>
        {deposits > 0 && (
          <div>
            <dt>Coming in</dt>
            <dd className="pos">+{money(deposits)}</dd>
          </div>
        )}
        <div>
          <dt>Left after</dt>
          <dd className={c.endBalance < c.cushion ? 'neg' : ''}>{money(c.endBalance)}</dd>
        </div>
      </dl>

      <LineChart
        series={[{ values: c.daily, color: c.status === 'short' ? '#ea7a5f' : c.status === 'tight' ? '#f59e0b' : '#79a7f2', curve: 'step' }]}
        xLabels={xLabels}
        height={150}
        zeroBased
        refLines={[{ value: c.cushion, color: '#f59e0b', label: `Cushion ${money(c.cushion)}` }]}
        ariaLabel={`Projected ${accountName(c.account)} balance over ${HORIZON_DAYS} days: from ${money(c.start)} to ${money(c.endBalance)}, lowest ${money(c.low.balance)} on ${shortDate(c.low.date)}`}
      />

      {c.events.length ? (
        <ul className="coverage-list">
          {events.map((e, i) => (
            <li key={e.name + e.date + i}>
              <span className={'up-when' + (e.late ? ' late' : '')}>{e.late ? 'Due now' : shortDate(e.date)}</span>
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
      ) : (
        <p className="muted small">Nothing due from this account in the next {HORIZON_DAYS} days.</p>
      )}
      {c.events.length > 5 && (
        <button className="btn ghost small" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
          <ChevronDown size={16} className={'chev' + (showAll ? ' open' : '')} aria-hidden="true" /> {showAll ? 'Show less' : `Show all ${c.events.length}`}
        </button>
      )}
      {c.cardsWithoutStatements > 0 && (
        <button className="hint-link" onClick={() => navigate('/accounts')}>
          {c.cardsWithoutStatements === 1 ? '1 card has' : `${c.cardsWithoutStatements} cards have`} no statement data, so{' '}
          {c.cardsWithoutStatements === 1 ? 'it’s' : 'they’re'} estimated. Allow statement access in Accounts →
        </button>
      )}

      {settings && <SettingsSheet coverage={c} onClose={() => setSettings(false)} />}
    </section>
  );
}

import { AlertTriangle, Eye, EyeOff, LogOut, Pencil, Plus, RefreshCw, ShieldOff, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, session } from '../api';
import { accountBalance, accountName, netWorth } from '../calc';
import { LinkBankButton } from '../components/PlaidLink';
import { AccountIcon, PageHeader, Sheet } from '../components/ui';
import { useData } from '../data';
import { money, relativeTime } from '../format';
import { navigate } from '../router';
import type { Account } from '../types';

function RenameSheet({ account, bank, onClose }: { account: Account; bank: string; onClose: () => void }) {
  const { data, reload, showToast } = useData();
  const [name, setName] = useState(account.display_name ?? '');
  const [busy, setBusy] = useState(false);

  // A few recent transactions help tell look-alike accounts apart.
  const recent = useMemo(
    () => (data?.transactions ?? []).filter((t) => t.account_id === account.account_id).slice(0, 3),
    [data, account.account_id],
  );

  const save = async (displayName: string | null) => {
    setBusy(true);
    try {
      await api(`/api/accounts/${encodeURIComponent(account.account_id)}`, { method: 'PATCH', body: { displayName } });
      await reload();
      onClose();
    } catch (e) {
      showToast((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title="Rename account" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save(name.trim() || null);
        }}
      >
        <label className="field">
          <span className="field-label">Name in this app</span>
          <input value={name} maxLength={60} placeholder={account.name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="txn-detail">
          <dl>
            <dt>Bank</dt>
            <dd>{bank}</dd>
            <dt>Bank's name</dt>
            <dd>{account.name}</dd>
            {account.official_name && account.official_name !== account.name && (
              <>
                <dt>Official name</dt>
                <dd>{account.official_name}</dd>
              </>
            )}
            {account.mask && (
              <>
                <dt>Ending in</dt>
                <dd>••{account.mask}</dd>
              </>
            )}
            <dt>Type</dt>
            <dd>{account.subtype ?? account.type}</dd>
            <dt>Balance</dt>
            <dd>{money(accountBalance(account))}</dd>
            {recent.length > 0 && (
              <>
                <dt>Recent</dt>
                <dd>
                  {recent.map((t) => (
                    <div key={t.id} className="muted small">
                      {t.date} · {t.merchant_name ?? t.name} · {money(Math.abs(t.amount))}
                    </div>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </div>
        <div className="sheet-actions">
          {account.display_name && (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => save(null)}>
              Use bank's name
            </button>
          )}
          <button type="submit" className="btn primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function Accounts() {
  const { data, reload, syncing, syncAll, syncItem, showToast } = useData();
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ account: Account; bank: string } | null>(null);
  const items = data?.items ?? [];
  const accounts = data?.accounts ?? [];

  const toggleHidden = async (a: Account) => {
    try {
      await api(`/api/accounts/${encodeURIComponent(a.account_id)}`, { method: 'PATCH', body: { hidden: !a.hidden } });
      await reload();
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  const removeItem = async (itemId: string, name: string) => {
    if (!confirm(`Unlink ${name}? Its accounts and transactions will be deleted from this app.`)) return;
    setBusy(true);
    try {
      await api(`/api/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
      await reload();
      showToast(`${name} unlinked`);
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    session.clear();
    window.dispatchEvent(new Event('auth:logout'));
  };

  const signOutEverywhere = async () => {
    if (!confirm('Sign out on every device?')) return;
    try {
      await api('/api/logout-all', { method: 'POST' });
    } finally {
      signOut();
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Accounts"
        onBack={() => navigate('/')}
        actions={
          <button className="icon-btn" onClick={syncAll} disabled={syncing} aria-label="Sync all banks">
            <RefreshCw size={24} className={syncing ? 'spin' : ''} />
          </button>
        }
      />

      <section className="card">
        <div className="row-between">
          <span className="muted">Net worth</span>
          <span className="big-number small-big">{money(netWorth(accounts))}</span>
        </div>
      </section>

      {items.map((item) => {
        const name = item.institution_name ?? 'Bank';
        const itemAccounts = accounts.filter((a) => a.item_id === item.item_id);
        return (
          <section key={item.item_id} className="card">
            <div className="row-between">
              <div>
                <h2 className="card-title">{name}</h2>
                <p className="card-sub">Synced {relativeTime(item.last_synced_at)}</p>
              </div>
              <div className="header-actions">
                <button className="icon-btn" onClick={() => syncItem(item.item_id)} disabled={syncing} aria-label={`Sync ${name}`}>
                  <RefreshCw size={20} />
                </button>
                <button className="icon-btn" onClick={() => removeItem(item.item_id, name)} disabled={busy} aria-label={`Unlink ${name}`}>
                  <Trash2 size={20} />
                </button>
              </div>
            </div>
            {item.status !== 'ok' && (
              <div className="warning">
                <AlertTriangle size={18} aria-hidden="true" />
                <span>{item.status === 'login_required' ? 'Sign-in expired.' : `Sync error (${item.error_code}).`}</span>
                <LinkBankButton itemId={item.item_id} className="btn small">
                  Reconnect
                </LinkBankButton>
              </div>
            )}
            <ul className="acct-list">
              {itemAccounts.map((a) => (
                <li key={a.account_id} className={a.hidden ? 'dimmed' : ''}>
                  <AccountIcon account={a} />
                  <button
                    className="acct-text acct-rename"
                    onClick={() => setRenaming({ account: a, bank: name })}
                    aria-label={`Rename ${accountName(a)}`}
                  >
                    <span className="acct-name-row">
                      <span className="acct-name">{accountName(a)}</span>
                      <Pencil size={13} className="muted rename-hint" aria-hidden="true" />
                    </span>
                    <span className="muted small acct-name">
                      {[a.mask && `••${a.mask}`, a.display_name ? a.name : (a.subtype ?? a.type)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                  <span className={accountBalance(a) < 0 ? 'neg' : ''}>{money(accountBalance(a))}</span>
                  <button
                    className="icon-btn"
                    onClick={() => toggleHidden(a)}
                    aria-label={a.hidden ? `Show ${accountName(a)}` : `Hide ${accountName(a)}`}
                    aria-pressed={!!a.hidden}
                  >
                    {a.hidden ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <LinkBankButton className="btn primary block">
        <Plus size={20} aria-hidden="true" /> Link a bank
      </LinkBankButton>
      <p className="hint">
        New banks can take a minute to finish their first import. Tap sync again if transactions look incomplete.
      </p>

      {renaming && <RenameSheet account={renaming.account} bank={renaming.bank} onClose={() => setRenaming(null)} />}

      <section className="card">
        <h2 className="card-title">Session</h2>
        <div className="stack">
          <button className="btn ghost block" onClick={signOut}>
            <LogOut size={18} aria-hidden="true" /> Sign out
          </button>
          <button className="btn ghost block" onClick={signOutEverywhere}>
            <ShieldOff size={18} aria-hidden="true" /> Sign out on all devices
          </button>
        </div>
      </section>
    </div>
  );
}

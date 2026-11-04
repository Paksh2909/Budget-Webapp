import { AlertTriangle, Eye, EyeOff, LogOut, Plus, RefreshCw, ShieldOff, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, session } from '../api';
import { accountBalance, accountName, netWorth } from '../calc';
import { LinkBankButton } from '../components/PlaidLink';
import { AccountIcon, PageHeader } from '../components/ui';
import { useData } from '../data';
import { money, relativeTime } from '../format';
import { navigate } from '../router';
import type { Account } from '../types';

export function Accounts() {
  const { data, reload, syncing, syncAll, syncItem, showToast } = useData();
  const [busy, setBusy] = useState(false);
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
                  <span className="acct-text">
                    <span className="acct-name">
                      {accountName(a)}
                      {a.mask && <span className="muted"> ••{a.mask}</span>}
                    </span>
                    <span className="muted small">{a.subtype ?? a.type}</span>
                  </span>
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

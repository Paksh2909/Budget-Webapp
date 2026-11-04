import { useEffect, useState, type ReactNode } from 'react';
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from 'react-plaid-link';
import { api } from '../api';
import { useData } from '../data';

const PENDING_KEY = 'budget.pendingLink';

interface PendingLink {
  token: string;
  itemId?: string; // set for update mode (reconnect or statement consent)
  purpose?: 'reconnect' | 'statements';
}

function Launcher({
  pending,
  receivedRedirectUri,
  onDone,
}: {
  pending: PendingLink;
  receivedRedirectUri?: string;
  onDone: () => void;
}) {
  const { syncItem, showToast } = useData();
  const { open, ready } = usePlaidLink({
    token: pending.token,
    receivedRedirectUri,
    onSuccess: async (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
      localStorage.removeItem(PENDING_KEY);
      try {
        let itemId = pending.itemId;
        if (itemId && pending.purpose === 'statements') {
          // Consent granted: fetch statements right away.
          const r = await api<{ status: string }>(`/api/items/${encodeURIComponent(itemId)}/statements`, { method: 'POST' });
          showToast(r.status === 'ok' ? 'Statement access added' : `Statements aren't available from this bank (${r.status})`);
        }
        if (!itemId) {
          if (!publicToken) throw new Error('Plaid did not return a token. Please try again.');
          const r = await api<{ itemId: string }>('/api/link/exchange', {
            method: 'POST',
            body: {
              publicToken,
              institutionId: metadata.institution?.institution_id,
              institutionName: metadata.institution?.name,
            },
          });
          itemId = r.itemId;
          showToast(`${metadata.institution?.name ?? 'Bank'} linked. Pulling transactions…`);
        }
        await syncItem(itemId);
      } catch (e) {
        showToast((e as Error).message);
      } finally {
        onDone();
      }
    },
    onExit: () => {
      localStorage.removeItem(PENDING_KEY);
      onDone();
    },
  });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return null;
}

export function LinkBankButton({
  itemId,
  purpose = 'reconnect',
  className = 'btn primary',
  children,
}: {
  itemId?: string;
  purpose?: 'reconnect' | 'statements';
  className?: string;
  children: ReactNode;
}) {
  const { showToast } = useData();
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const r = await api<{ linkToken: string }>('/api/link/token', { method: 'POST', body: itemId ? { itemId, purpose } : {} });
      const p: PendingLink = { token: r.linkToken, itemId, purpose };
      // Kept for the OAuth redirect round-trip (cleared on finish or exit).
      localStorage.setItem(PENDING_KEY, JSON.stringify(p));
      setPending(p);
    } catch (e) {
      showToast((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <button className={className} onClick={start} disabled={busy}>
        {children}
      </button>
      {pending && (
        <Launcher
          pending={pending}
          onDone={() => {
            setPending(null);
            setBusy(false);
          }}
        />
      )}
    </>
  );
}

/** Resumes Plaid Link after a bank's OAuth redirect (only used when PLAID_REDIRECT_URI is configured). */
export function OAuthResume() {
  const [pending] = useState<PendingLink | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as PendingLink | null;
    } catch {
      return null;
    }
  });
  const isRedirect = new URLSearchParams(window.location.search).has('oauth_state_id');
  const [href] = useState(() => window.location.href);
  const clearUrl = () => window.history.replaceState(null, '', window.location.pathname + '#/accounts');

  useEffect(() => {
    if (isRedirect && !pending) clearUrl();
  }, [isRedirect, pending]);

  if (!isRedirect || !pending) return null;
  return <Launcher pending={pending} receivedRedirectUri={href} onDone={clearUrl} />;
}

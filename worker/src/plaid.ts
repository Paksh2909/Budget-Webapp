import type { Env } from './http';

const HOSTS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

export class PlaidError extends Error {
  constructor(
    public status: number,
    public errorType: string,
    public errorCode: string,
    message: string,
  ) {
    super(message);
  }
}

export async function plaid<T>(env: Env, path: string, body: Record<string, unknown>): Promise<T> {
  const host = HOSTS[env.PLAID_ENV];
  if (!host) throw new Error(`PLAID_ENV must be "sandbox" or "production"`);
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) throw new Error('Plaid credentials are not configured');

  const res = await fetch(host + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PLAID-CLIENT-ID': env.PLAID_CLIENT_ID,
      'PLAID-SECRET': env.PLAID_SECRET,
      'Plaid-Version': '2020-09-14',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new PlaidError(
      res.status,
      String(data.error_type ?? 'API_ERROR'),
      String(data.error_code ?? 'UNKNOWN'),
      String(data.display_message ?? data.error_message ?? 'Plaid request failed'),
    );
  }
  return data as T;
}

// ---- Minimal response types for the endpoints we use ----

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: {
    current: number | null;
    available: number | null;
    iso_currency_code: string | null;
    unofficial_currency_code: string | null;
  };
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
  date: string;
  datetime: string | null;
  authorized_datetime: string | null;
  name: string;
  merchant_name: string | null;
  logo_url: string | null;
  pending: boolean;
  pending_transaction_id: string | null;
  personal_finance_category: { primary: string; detailed: string } | null;
}

export interface SyncResponse {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  accounts: PlaidAccount[];
  next_cursor: string;
  has_more: boolean;
}

export interface AccountsResponse {
  accounts: PlaidAccount[];
}

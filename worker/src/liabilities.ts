// Credit card statement data via Plaid Liabilities (statement balance, due date, minimum payment).
// Best-effort: any failure here is recorded on the item and never breaks transaction sync.

import { decryptString } from './crypto';
import { nowIso, type Env } from './http';
import { plaid, PlaidError } from './plaid';

const RECHECK_HOURS = 12; // Plaid refreshes Liabilities about once a day

interface CreditLiability {
  account_id: string | null;
  last_statement_balance: number | null;
  last_statement_issue_date: string | null;
  minimum_payment_amount: number | null;
  next_payment_due_date: string | null;
  last_payment_amount: number | null;
  last_payment_date: string | null;
  is_overdue: boolean | null;
}

interface LiabilitiesResponse {
  liabilities: { credit: CreditLiability[] | null };
}

export type LiabilitiesStatus = 'ok' | 'consent_required' | 'unsupported' | 'not_enabled' | `error:${string}`;

function statusFor(err: PlaidError): LiabilitiesStatus {
  switch (err.errorCode) {
    case 'ADDITIONAL_CONSENT_REQUIRED':
    case 'ACCESS_NOT_GRANTED':
      return 'consent_required';
    case 'PRODUCTS_NOT_SUPPORTED':
    case 'NO_LIABILITY_ACCOUNTS':
      return 'unsupported';
    case 'INVALID_PRODUCT':
    case 'PRODUCT_NOT_ENABLED':
      return 'not_enabled';
    default:
      return `error:${err.errorCode}`;
  }
}

/** Fetches card statements for an item. `force` skips the 12h freshness check (used after granting consent). */
export async function refreshLiabilities(
  env: Env,
  itemId: string,
  opts: { accessToken?: string; force?: boolean } = {},
): Promise<LiabilitiesStatus | 'skipped'> {
  const item = await env.DB.prepare(
    `SELECT access_token_enc, liabilities_status, liabilities_checked_at,
            (SELECT count(*) FROM accounts a WHERE a.item_id = items.item_id AND a.type = 'credit') AS cards
     FROM items WHERE item_id = ?`,
  )
    .bind(itemId)
    .first<{ access_token_enc: string; liabilities_status: string | null; liabilities_checked_at: string | null; cards: number }>();
  if (!item || item.cards === 0) return 'skipped'; // no credit cards at this bank
  if (!opts.force) {
    if (item.liabilities_status === 'unsupported' || item.liabilities_status === 'not_enabled') return 'skipped';
    const fresh = item.liabilities_checked_at && Date.now() - Date.parse(item.liabilities_checked_at) < RECHECK_HOURS * 3600_000;
    if (fresh) return 'skipped';
  }

  let status: LiabilitiesStatus = 'ok';
  try {
    const token = opts.accessToken ?? (await decryptString(item.access_token_enc, env.TOKEN_ENCRYPTION_KEY));
    const res = await plaid<LiabilitiesResponse>(env, '/liabilities/get', { access_token: token });
    const rows = (res.liabilities.credit ?? [])
      .filter((c) => c.account_id)
      .map((c) => ({
        account_id: c.account_id,
        balance: c.last_statement_balance,
        issued: c.last_statement_issue_date,
        minimum: c.minimum_payment_amount,
        due: c.next_payment_due_date,
        last_amount: c.last_payment_amount,
        last_date: c.last_payment_date,
        overdue: c.is_overdue ? 1 : 0,
      }));
    if (rows.length) {
      await env.DB.prepare(
        `INSERT INTO card_statements (account_id, item_id, last_statement_balance, last_statement_issue_date,
                                      minimum_payment_amount, next_payment_due_date, last_payment_amount,
                                      last_payment_date, is_overdue, updated_at)
         SELECT json_extract(value, '$.account_id'), ?2, json_extract(value, '$.balance'), json_extract(value, '$.issued'),
                json_extract(value, '$.minimum'), json_extract(value, '$.due'), json_extract(value, '$.last_amount'),
                json_extract(value, '$.last_date'), json_extract(value, '$.overdue'), ?3
         FROM json_each(?1) WHERE true
         ON CONFLICT(account_id) DO UPDATE SET
           last_statement_balance = excluded.last_statement_balance,
           last_statement_issue_date = excluded.last_statement_issue_date,
           minimum_payment_amount = excluded.minimum_payment_amount,
           next_payment_due_date = excluded.next_payment_due_date,
           last_payment_amount = excluded.last_payment_amount,
           last_payment_date = excluded.last_payment_date,
           is_overdue = excluded.is_overdue,
           updated_at = excluded.updated_at`,
      )
        .bind(JSON.stringify(rows), itemId, nowIso())
        .run();
    }
  } catch (err) {
    if (!(err instanceof PlaidError)) {
      console.error('liabilities failed', itemId, (err as Error)?.message);
      return 'skipped';
    }
    // Login problems are handled by the main sync; don't record them here.
    if (err.errorCode === 'ITEM_LOGIN_REQUIRED' || err.errorCode === 'PENDING_EXPIRATION') return 'skipped';
    status = statusFor(err);
    console.log('liabilities unavailable', itemId, err.errorCode);
  }

  await env.DB.prepare(`UPDATE items SET liabilities_status = ?1, liabilities_checked_at = ?2 WHERE item_id = ?3`)
    .bind(status, nowIso(), itemId)
    .run();
  return status;
}

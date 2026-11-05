import { mapCategory } from './categories';
import { decryptString } from './crypto';
import { refreshLiabilities } from './liabilities';
import { snapshotBalances } from './snapshots';
import { nowIso, type Env } from './http';
import { plaid, PlaidError, type AccountsResponse, type PlaidAccount, type PlaidTransaction, type SyncResponse } from './plaid';

// Workers on the free plan allow ~50 subrequests per invocation, so each call
// processes a bounded number of pages and the client loops while hasMore is true.
const MAX_PAGES_PER_CALL = 4;
const PAGE_SIZE = 500;
const CHUNK = 400; // rows per JSON-bulk SQL statement

export interface ItemRow {
  item_id: string;
  access_token_enc: string;
  institution_name: string | null;
  cursor: string | null;
}

export interface SyncResult {
  itemId: string;
  status: 'ok' | 'login_required' | 'error';
  hasMore: boolean;
  added: number;
  modified: number;
  removed: number;
  errorCode?: string;
  message?: string;
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function upsertAccounts(env: Env, itemId: string, accounts: PlaidAccount[]): Promise<void> {
  if (!accounts.length) return;
  const rows = accounts.map((a) => ({
    account_id: a.account_id,
    name: a.name,
    official_name: a.official_name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    current: a.balances.current,
    available: a.balances.available,
    currency: a.balances.iso_currency_code ?? a.balances.unofficial_currency_code,
  }));
  await env.DB.prepare(
    `INSERT INTO accounts (account_id, item_id, name, official_name, mask, type, subtype,
                           current_balance, available_balance, currency, updated_at)
     SELECT json_extract(value, '$.account_id'), ?2, json_extract(value, '$.name'),
            json_extract(value, '$.official_name'), json_extract(value, '$.mask'),
            json_extract(value, '$.type'), json_extract(value, '$.subtype'),
            json_extract(value, '$.current'), json_extract(value, '$.available'),
            json_extract(value, '$.currency'), ?3
     FROM json_each(?1) WHERE true
     ON CONFLICT(account_id) DO UPDATE SET
       name = excluded.name, official_name = excluded.official_name, mask = excluded.mask,
       type = excluded.type, subtype = excluded.subtype, current_balance = excluded.current_balance,
       available_balance = excluded.available_balance, currency = excluded.currency,
       updated_at = excluded.updated_at`,
  )
    .bind(JSON.stringify(rows), itemId, nowIso())
    .run();
  // Fresh balances: record (or update) today's snapshot for this bank's accounts.
  await snapshotBalances(env, { itemId, overwrite: true });
}

function toRow(t: PlaidTransaction) {
  const { category, subcategory } = mapCategory(t.personal_finance_category);
  return {
    id: t.transaction_id,
    account_id: t.account_id,
    amount: t.amount,
    currency: t.iso_currency_code ?? t.unofficial_currency_code,
    date: t.date,
    datetime: t.datetime ?? t.authorized_datetime,
    name: t.name,
    merchant_name: t.merchant_name,
    logo_url: t.logo_url,
    pending: t.pending ? 1 : 0,
    pending_transaction_id: t.pending_transaction_id,
    pfc_primary: t.personal_finance_category?.primary ?? null,
    pfc_detailed: t.personal_finance_category?.detailed ?? null,
    category,
    subcategory,
  };
}

async function upsertTransactions(env: Env, itemId: string, txns: PlaidTransaction[]): Promise<void> {
  const now = nowIso();
  for (const part of chunks(txns.map(toRow), CHUNK)) {
    const payload = JSON.stringify(part);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO transactions (id, account_id, item_id, amount, currency, date, datetime, name,
                                   merchant_name, logo_url, pending, pending_transaction_id,
                                   pfc_primary, pfc_detailed, category, subcategory, source, updated_at)
         SELECT json_extract(value, '$.id'), json_extract(value, '$.account_id'), ?2,
                json_extract(value, '$.amount'), json_extract(value, '$.currency'),
                json_extract(value, '$.date'), json_extract(value, '$.datetime'),
                json_extract(value, '$.name'), json_extract(value, '$.merchant_name'),
                json_extract(value, '$.logo_url'), json_extract(value, '$.pending'),
                json_extract(value, '$.pending_transaction_id'), json_extract(value, '$.pfc_primary'),
                json_extract(value, '$.pfc_detailed'), json_extract(value, '$.category'),
                json_extract(value, '$.subcategory'), 'plaid', ?3
         FROM json_each(?1) WHERE true
         ON CONFLICT(id) DO UPDATE SET
           account_id = excluded.account_id, amount = excluded.amount, currency = excluded.currency,
           date = excluded.date, datetime = excluded.datetime, name = excluded.name,
           merchant_name = excluded.merchant_name, logo_url = excluded.logo_url,
           pending = excluded.pending, pending_transaction_id = excluded.pending_transaction_id,
           pfc_primary = excluded.pfc_primary, pfc_detailed = excluded.pfc_detailed,
           category = excluded.category, subcategory = excluded.subcategory,
           updated_at = excluded.updated_at`,
      ).bind(payload, itemId, now),
      // When a pending transaction posts, carry over the user's category/note.
      env.DB.prepare(
        `UPDATE transactions AS t SET
           user_category = (SELECT p.user_category FROM transactions p WHERE p.id = t.pending_transaction_id),
           user_subcategory = (SELECT p.user_subcategory FROM transactions p WHERE p.id = t.pending_transaction_id),
           note = (SELECT p.note FROM transactions p WHERE p.id = t.pending_transaction_id)
         WHERE t.id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))
           AND t.pending_transaction_id IS NOT NULL
           AND t.user_category IS NULL AND t.user_subcategory IS NULL AND t.note IS NULL`,
      ).bind(payload),
    ]);
  }
}

async function removeTransactions(env: Env, ids: string[]): Promise<void> {
  for (const part of chunks(ids, CHUNK)) {
    await env.DB.prepare(`DELETE FROM transactions WHERE source = 'plaid' AND id IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(part))
      .run();
  }
}

export async function refreshAccounts(env: Env, item: ItemRow, accessToken?: string): Promise<void> {
  const token = accessToken ?? (await decryptString(item.access_token_enc, env.TOKEN_ENCRYPTION_KEY));
  const res = await plaid<AccountsResponse>(env, '/accounts/get', { access_token: token });
  await upsertAccounts(env, item.item_id, res.accounts);
}

export async function syncItem(env: Env, item: ItemRow): Promise<SyncResult> {
  const result: SyncResult = { itemId: item.item_id, status: 'ok', hasMore: false, added: 0, modified: 0, removed: 0 };
  try {
    const accessToken = await decryptString(item.access_token_enc, env.TOKEN_ENCRYPTION_KEY);
    const startCursor = item.cursor ?? '';

    let attempt = 0;
    for (;;) {
      const added: PlaidTransaction[] = [];
      const modified: PlaidTransaction[] = [];
      const removed: string[] = [];
      let accounts: PlaidAccount[] = [];
      let cursor = startCursor;
      let hasMore = true;
      let pages = 0;
      try {
        while (hasMore && pages < MAX_PAGES_PER_CALL) {
          const page = await plaid<SyncResponse>(env, '/transactions/sync', {
            access_token: accessToken,
            cursor: cursor || undefined,
            count: PAGE_SIZE,
          });
          added.push(...page.added);
          modified.push(...page.modified);
          removed.push(...page.removed.map((r) => r.transaction_id));
          if (page.accounts?.length) accounts = page.accounts;
          cursor = page.next_cursor;
          hasMore = page.has_more;
          pages++;
        }
      } catch (err) {
        if (err instanceof PlaidError && err.errorCode === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < 2) {
          attempt++;
          continue; // restart from the cursor we started this call with
        }
        throw err;
      }

      if (accounts.length) await upsertAccounts(env, item.item_id, accounts);
      else await refreshAccounts(env, item, accessToken);

      await upsertTransactions(env, item.item_id, [...added, ...modified]);
      await removeTransactions(env, removed);
      await env.DB.prepare(
        `UPDATE items SET cursor = ?1, status = 'ok', error_code = NULL, last_synced_at = ?2 WHERE item_id = ?3`,
      )
        .bind(cursor, nowIso(), item.item_id)
        .run();

      result.added = added.length;
      result.modified = modified.length;
      result.removed = removed.length;
      result.hasMore = hasMore;
      // Once caught up, refresh card statements (at most every 12h; never fails the sync).
      if (!hasMore) await refreshLiabilities(env, item.item_id, { accessToken });
      return result;
    }
  } catch (err) {
    if (err instanceof PlaidError) {
      const status = err.errorCode === 'ITEM_LOGIN_REQUIRED' || err.errorCode === 'PENDING_EXPIRATION' ? 'login_required' : 'error';
      await env.DB.prepare(`UPDATE items SET status = ?1, error_code = ?2 WHERE item_id = ?3`)
        .bind(status, err.errorCode, item.item_id)
        .run();
      return { ...result, status, errorCode: err.errorCode, message: err.message };
    }
    throw err;
  }
}

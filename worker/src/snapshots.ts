// Daily balance snapshots for the net-worth chart.

import { nowIso, type Env } from './http';

/** The user's IANA timezone (sent by the app), so "today" matches the phone. Defaults to UTC. */
async function userTimeZone(env: Env): Promise<string> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'timezone'`).first<{ value: string }>();
  return row?.value ?? 'UTC';
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** YYYY-MM-DD for `now` in the given timezone. */
export function localDate(tz: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Records today's balance for every account (or one item's accounts).
 * `overwrite`: true after a sync (fresher balances win); false for the daily cron fill-in.
 */
export async function snapshotBalances(env: Env, opts: { itemId?: string; overwrite: boolean }): Promise<void> {
  const date = localDate(await userTimeZone(env));
  // A WHERE is required: without one SQLite parses "FROM accounts ON CONFLICT" as a join.
  const where = opts.itemId ? 'WHERE item_id = ?2' : 'WHERE true';
  const conflict = opts.overwrite
    ? `DO UPDATE SET current_balance = excluded.current_balance, available_balance = excluded.available_balance,
                     captured_at = excluded.captured_at`
    : 'DO NOTHING';
  const stmt = env.DB.prepare(
    `INSERT INTO balance_snapshots (date, account_id, current_balance, available_balance, captured_at)
     SELECT ?1, account_id, current_balance, available_balance, ?3 FROM accounts ${where}
     ON CONFLICT(date, account_id) ${conflict}`,
  );
  await (opts.itemId ? stmt.bind(date, opts.itemId, nowIso()) : stmt.bind(date, null, nowIso())).run();
}

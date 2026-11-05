import { handleLogin, handleLogoutAll, requireAuth } from './auth';
import { CATEGORY_IDS, isCategoryId } from './categories';
import { decryptString, encryptString } from './crypto';
import { HttpError, isAllowedOrigin, json, nowIso, num, readJson, str, withCors, type Env } from './http';
import { plaid, PlaidError } from './plaid';
import { refreshLiabilities } from './liabilities';
import { isValidTimeZone, snapshotBalances } from './snapshots';
import { refreshAccounts, syncItem, type ItemRow } from './sync';

type Handler = (req: Request, env: Env, params: Record<string, string>) => Promise<Response>;
interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  public?: boolean;
}

const routes: Route[] = [];
function route(method: string, path: string, handler: Handler, opts: { public?: boolean } = {}) {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' + path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), '([A-Za-z0-9_\\-]+)')) + '$',
  );
  routes.push({ method, pattern, keys, handler, public: opts.public });
}


// ---------- Public ----------

route('GET', '/api/health', async () => json({ ok: true }), { public: true });
route('POST', '/api/login', (req, env) => handleLogin(req, env), { public: true });

// ---------- Session ----------

route('GET', '/api/session', async () => json({ ok: true }));
route('POST', '/api/logout-all', (_req, env) => handleLogoutAll(env));

// ---------- Plaid Link ----------

route('POST', '/api/link/token', async (req, env) => {
  const body = await readJson(req);
  const itemId = str(body.itemId, 'itemId', { optional: true, max: 100 });
  const purpose = body.purpose === 'statements' ? 'statements' : 'reconnect';
  const request: Record<string, unknown> = {
    client_name: 'Budget',
    user: { client_user_id: 'owner' },
    language: 'en',
    country_codes: ['US'],
  };
  if (env.PLAID_REDIRECT_URI) request.redirect_uri = env.PLAID_REDIRECT_URI;

  if (itemId) {
    // Update mode: re-authenticate an existing Item, or ask for statement (Liabilities) consent.
    const item = await env.DB.prepare(`SELECT access_token_enc FROM items WHERE item_id = ?`)
      .bind(itemId)
      .first<{ access_token_enc: string }>();
    if (!item) throw new HttpError(404, 'Item not found');
    request.access_token = await decryptString(item.access_token_enc, env.TOKEN_ENCRYPTION_KEY);
    if (purpose === 'statements') request.additional_consented_products = ['liabilities'];
  } else {
    request.products = ['transactions'];
    request.transactions = { days_requested: 730 };
    // Ask for card statement access up front; only billed once /liabilities/get is called.
    request.additional_consented_products = ['liabilities'];
  }

  let res: { link_token: string; expiration: string };
  try {
    res = await plaid(env, '/link/token/create', request);
  } catch (err) {
    // If statement consent isn't available for this Plaid account, still let the user link the bank.
    if (purpose !== 'statements' && err instanceof PlaidError && request.additional_consented_products) {
      console.log('link token without liabilities consent:', err.errorCode);
      delete request.additional_consented_products;
      res = await plaid(env, '/link/token/create', request);
    } else throw err;
  }
  return json({ linkToken: res.link_token, expiration: res.expiration });
});

route('POST', '/api/link/exchange', async (req, env) => {
  const body = await readJson(req);
  const publicToken = str(body.publicToken, 'publicToken', { max: 300 })!;
  const institutionId = str(body.institutionId, 'institutionId', { optional: true, max: 100 }) ?? null;
  const institutionName = str(body.institutionName, 'institutionName', { optional: true, max: 200 }) ?? null;

  const res = await plaid<{ access_token: string; item_id: string }>(env, '/item/public_token/exchange', {
    public_token: publicToken,
  });
  const enc = await encryptString(res.access_token, env.TOKEN_ENCRYPTION_KEY);
  await env.DB.prepare(
    `INSERT INTO items (item_id, access_token_enc, institution_id, institution_name, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(item_id) DO UPDATE SET access_token_enc = excluded.access_token_enc, status = 'ok', error_code = NULL`,
  )
    .bind(res.item_id, enc, institutionId, institutionName, nowIso())
    .run();

  const item: ItemRow = { item_id: res.item_id, access_token_enc: enc, institution_name: institutionName, cursor: null };
  await refreshAccounts(env, item, res.access_token);
  return json({ itemId: res.item_id });
});

// ---------- Items ----------

route('GET', '/api/items', async (_req, env) => {
  const { results } = await env.DB.prepare(
    `SELECT item_id, institution_id, institution_name, status, error_code, last_synced_at, created_at
     FROM items ORDER BY created_at`,
  ).all();
  return json({ items: results });
});

route('DELETE', '/api/items/:id', async (_req, env, { id }) => {
  const item = await env.DB.prepare(`SELECT * FROM items WHERE item_id = ?`).bind(id).first<ItemRow>();
  if (!item) throw new HttpError(404, 'Item not found');
  try {
    const token = await decryptString(item.access_token_enc, env.TOKEN_ENCRYPTION_KEY);
    await plaid(env, '/item/remove', { access_token: token });
  } catch (err) {
    // Still remove locally if Plaid already forgot the Item.
    // e.g. a sandbox bank left over after switching PLAID_ENV to production.
    const gone = err instanceof PlaidError && ['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN'].includes(err.errorCode);
    if (!gone) throw err;
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM transactions WHERE item_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM balance_snapshots WHERE account_id IN (SELECT account_id FROM accounts WHERE item_id = ?)`).bind(id),
    env.DB.prepare(`DELETE FROM accounts WHERE item_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM items WHERE item_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM settings WHERE key = ?`).bind(`sync_attempt:${id}`),
  ]);
  return json({ ok: true });
});

// Re-check card statements right away (after granting statement access in Plaid).
route('POST', '/api/items/:id/statements', async (_req, env, { id }) => {
  const exists = await env.DB.prepare(`SELECT 1 FROM items WHERE item_id = ?`).bind(id).first();
  if (!exists) throw new HttpError(404, 'Item not found');
  const status = await refreshLiabilities(env, id!, { force: true });
  return json({ status });
});

route('POST', '/api/items/:id/sync', async (_req, env, { id }) => {
  const item = await env.DB.prepare(`SELECT item_id, access_token_enc, institution_name, cursor FROM items WHERE item_id = ?`)
    .bind(id)
    .first<ItemRow>();
  if (!item) throw new HttpError(404, 'Item not found');
  return json(await syncItem(env, item));
});

// ---------- Accounts ----------

route('PATCH', '/api/accounts/:id', async (req, env, { id }) => {
  const body = await readJson(req);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if ('displayName' in body) {
    sets.push('display_name = ?');
    binds.push(str(body.displayName, 'displayName', { optional: true, max: 60 }) ?? null);
  }
  if ('hidden' in body) {
    if (typeof body.hidden !== 'boolean') throw new HttpError(400, 'hidden must be a boolean');
    sets.push('hidden = ?');
    binds.push(body.hidden ? 1 : 0);
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  const res = await env.DB.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE account_id = ?`)
    .bind(...binds, id)
    .run();
  if (!res.meta.changes) throw new HttpError(404, 'Account not found');
  return json({ ok: true });
});

// ---------- All data for the app ----------

route('GET', '/api/data', async (_req, env) => {
  const [items, accounts, transactions, rules, statements, bills, settings, snapshots] = await env.DB.batch([
    env.DB.prepare(
      `SELECT item_id, institution_name, status, error_code, last_synced_at, liabilities_status
       FROM items ORDER BY created_at`,
    ),
    env.DB.prepare(
      `SELECT account_id, item_id, name, official_name, mask, type, subtype, current_balance,
              available_balance, currency, display_name, hidden
       FROM accounts ORDER BY type, name`,
    ),
    env.DB.prepare(
      `SELECT id, account_id, amount, date, datetime, name, merchant_name, logo_url, pending,
              COALESCE(user_category, category) AS category, category AS auto_category,
              (user_category IS NOT NULL OR user_subcategory IS NOT NULL) AS overridden,
              user_category IS NOT NULL AS cat_overridden, user_subcategory IS NOT NULL AS sub_overridden,
              NULLIF(COALESCE(user_subcategory, subcategory), '') AS subcategory,
              subcategory AS auto_subcategory, note, source
       FROM transactions ORDER BY date DESC, datetime DESC, id`,
    ),
    env.DB.prepare(`SELECT id, pattern, category, subcategory FROM rules ORDER BY created_at`),
    env.DB.prepare(
      `SELECT account_id, last_statement_balance, last_statement_issue_date, minimum_payment_amount,
              next_payment_due_date, last_payment_amount, last_payment_date, is_overdue, updated_at
       FROM card_statements`,
    ),
    env.DB.prepare(`SELECT id, name, pattern, account_id, day_start, day_end FROM bills ORDER BY created_at`),
    env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('bill_pay_account', 'coverage_cushion', 'home_layout', 'timezone')`),
    env.DB.prepare(
      `SELECT date, account_id, current_balance FROM balance_snapshots WHERE current_balance IS NOT NULL ORDER BY date`,
    ),
  ]);
  const s = Object.fromEntries((settings!.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  return json({
    items: items!.results,
    accounts: accounts!.results,
    transactions: transactions!.results,
    rules: rules!.results,
    statements: statements!.results,
    snapshots: snapshots!.results,
    bills: bills!.results,
    settings: {
      billPayAccount: s.bill_pay_account ?? null,
      cushion: s.coverage_cushion !== undefined ? Number(s.coverage_cushion) : null,
      homeLayout: s.home_layout ? JSON.parse(s.home_layout) : null,
      timezone: s.timezone ?? null,
    },
  });
});

// ---------- Tracked bills (e.g. rent) ----------

function parseBill(body: Record<string, unknown>) {
  const name = str(body.name, 'name', { max: 60 })!;
  const pattern = str(body.pattern, 'pattern', { max: 80 })!;
  if (pattern.length < 2) throw new HttpError(400, 'pattern must be at least 2 characters');
  const accountId = str(body.accountId, 'accountId', { optional: true, max: 100 }) ?? null;
  const dayStart = num(body.dayStart, 'dayStart', { min: 1, max: 31 });
  const dayEnd = num(body.dayEnd, 'dayEnd', { min: 1, max: 31 });
  if (!Number.isInteger(dayStart) || !Number.isInteger(dayEnd) || dayEnd < dayStart) {
    throw new HttpError(400, 'dayStart/dayEnd must be whole days with dayStart <= dayEnd');
  }
  return { name, pattern, accountId, dayStart, dayEnd };
}

route('POST', '/api/bills', async (req, env) => {
  const b = parseBill(await readJson(req));
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO bills (id, name, pattern, account_id, day_start, day_end, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(id, b.name, b.pattern, b.accountId, b.dayStart, b.dayEnd, nowIso())
    .run();
  return json({ id }, 201);
});

route('PUT', '/api/bills/:id', async (req, env, { id }) => {
  const b = parseBill(await readJson(req));
  const res = await env.DB.prepare(
    `UPDATE bills SET name = ?1, pattern = ?2, account_id = ?3, day_start = ?4, day_end = ?5 WHERE id = ?6`,
  )
    .bind(b.name, b.pattern, b.accountId, b.dayStart, b.dayEnd, id)
    .run();
  if (!res.meta.changes) throw new HttpError(404, 'Bill not found');
  return json({ ok: true });
});

route('DELETE', '/api/bills/:id', async (_req, env, { id }) => {
  await env.DB.prepare(`DELETE FROM bills WHERE id = ?`).bind(id).run();
  return json({ ok: true });
});

// ---------- Settings ----------

route('PUT', '/api/settings', async (req, env) => {
  const body = await readJson(req);
  const stmts: D1PreparedStatement[] = [];
  const upsert = (key: string, value: string | null) =>
    value === null
      ? env.DB.prepare(`DELETE FROM settings WHERE key = ?`).bind(key)
      : env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, value);
  if ('billPayAccount' in body) {
    const id = str(body.billPayAccount, 'billPayAccount', { optional: true, max: 100 }) ?? null;
    if (id) {
      const ok = await env.DB.prepare(`SELECT 1 FROM accounts WHERE account_id = ?`).bind(id).first();
      if (!ok) throw new HttpError(400, 'Unknown account');
    }
    stmts.push(upsert('bill_pay_account', id));
  }
  if ('timezone' in body) {
    const tz = str(body.timezone, 'timezone', { max: 64 })!;
    if (!isValidTimeZone(tz)) throw new HttpError(400, 'Unknown timezone');
    stmts.push(upsert('timezone', tz));
  }
  if ('homeLayout' in body) {
    // { order: string[], hidden: string[] } of tile ids; ids are validated by shape only so new tiles need no backend change.
    const l = body.homeLayout as { order?: unknown; hidden?: unknown } | null;
    if (l === null) stmts.push(upsert('home_layout', null));
    else {
      const ids = (v: unknown) =>
        Array.isArray(v) && v.length <= 30 && v.every((x) => typeof x === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(x));
      if (typeof l !== 'object' || !ids(l.order) || !ids(l.hidden)) throw new HttpError(400, 'Invalid homeLayout');
      stmts.push(upsert('home_layout', JSON.stringify({ order: l.order, hidden: l.hidden })));
    }
  }
  if ('cushion' in body) {
    stmts.push(upsert('coverage_cushion', body.cushion === null ? null : String(num(body.cushion, 'cushion', { min: 0, max: 1e7 }))));
  }
  if (!stmts.length) throw new HttpError(400, 'Nothing to update');
  await env.DB.batch(stmts);
  return json({ ok: true });
});

// ---------- Auto-categorize rules ----------

function parseRule(body: Record<string, unknown>) {
  const pattern = str(body.pattern, 'pattern', { max: 80 })!;
  if (pattern.length < 2) throw new HttpError(400, 'pattern must be at least 2 characters');
  if (!isCategoryId(body.category)) throw new HttpError(400, 'Invalid category');
  const subcategory = str(body.subcategory, 'subcategory', { optional: true, max: 60 }) ?? null;
  return { pattern, category: body.category, subcategory };
}

route('POST', '/api/rules', async (req, env) => {
  const r = parseRule(await readJson(req));
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO rules (id, pattern, category, subcategory, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(id, r.pattern, r.category, r.subcategory, nowIso())
    .run();
  return json({ id }, 201);
});

route('PUT', '/api/rules/:id', async (req, env, { id }) => {
  const r = parseRule(await readJson(req));
  const res = await env.DB.prepare(`UPDATE rules SET pattern = ?1, category = ?2, subcategory = ?3 WHERE id = ?4`)
    .bind(r.pattern, r.category, r.subcategory, id)
    .run();
  if (!res.meta.changes) throw new HttpError(404, 'Rule not found');
  return json({ ok: true });
});

route('DELETE', '/api/rules/:id', async (_req, env, { id }) => {
  await env.DB.prepare(`DELETE FROM rules WHERE id = ?`).bind(id).run();
  return json({ ok: true });
});

// ---------- Transactions ----------

route('PATCH', '/api/transactions/:id', async (req, env, { id }) => {
  const body = await readJson(req);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if ('category' in body) {
    if (body.category !== null && !isCategoryId(body.category)) throw new HttpError(400, 'Invalid category');
    sets.push('user_category = ?');
    binds.push(body.category);
  }
  if ('note' in body) {
    sets.push('note = ?');
    binds.push(str(body.note, 'note', { optional: true, max: 300 }) ?? null);
  }
  if ('subcategory' in body) {
    // null = follow Plaid's subcategory; '' = explicitly none; otherwise a label.
    const v = body.subcategory;
    if (v !== null && typeof v !== 'string') throw new HttpError(400, 'subcategory must be a string or null');
    const t = typeof v === 'string' ? v.trim() : null;
    if (t && t.length > 60) throw new HttpError(400, 'subcategory is too long');
    sets.push('user_subcategory = ?');
    binds.push(t);
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  sets.push('updated_at = ?');
  binds.push(nowIso());
  const res = await env.DB.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, id)
    .run();
  if (!res.meta.changes) throw new HttpError(404, 'Transaction not found');
  return json({ ok: true });
});

route('DELETE', '/api/transactions/:id', async (_req, env, { id }) => {
  const res = await env.DB.prepare(`DELETE FROM transactions WHERE id = ? AND source = 'manual'`).bind(id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Only manual transactions can be deleted');
  return json({ ok: true });
});

route('GET', '/api/categories', async () => json({ categories: CATEGORY_IDS }));

// ---------- Entry point ----------

async function dispatch(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const pathMatches = routes.filter((r) => r.pattern.test(url.pathname));
  if (!pathMatches.length) throw new HttpError(404, 'Not found');
  const r = pathMatches.find((x) => x.method === req.method);
  if (!r) throw new HttpError(405, 'Method not allowed');

  // State-changing requests must come from an allowlisted origin (defense in depth on top of auth).
  if (req.method !== 'GET' && !isAllowedOrigin(req.headers.get('Origin'), env)) {
    throw new HttpError(403, 'Origin not allowed');
  }
  if (!r.public) await requireAuth(req, env);

  const m = r.pattern.exec(url.pathname)!;
  const params: Record<string, string> = {};
  r.keys.forEach((k, i) => (params[k] = m[i + 1]!));
  return r.handler(req, env, params);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin');
    if (req.method === 'OPTIONS') {
      if (!isAllowedOrigin(origin, env)) return new Response(null, { status: 403 });
      return withCors(new Response(null, { status: 204 }), origin, env);
    }
    let res: Response;
    try {
      res = await dispatch(req, env);
    } catch (err) {
      if (err instanceof HttpError) {
        res = json({ error: err.message, code: err.code }, err.status);
      } else if (err instanceof PlaidError) {
        console.error('Plaid error', err.errorType, err.errorCode);
        res = json({ error: err.message, code: err.errorCode }, 502);
      } else {
        console.error('Unhandled error', (err as Error)?.message);
        res = json({ error: 'Internal error' }, 500);
      }
    }
    return withCors(res, origin, env);
  },

  /** Cron trigger: keeps data fresh in the background (see "triggers" in wrangler.jsonc). */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduledSync(env));
  },
} satisfies ExportedHandler<Env>;

// Free-plan Workers allow ~50 subrequests per run, so each run syncs only the
// stalest bank. Runs every 15 minutes, so each bank still refreshes several times a day.
const STALE_AFTER_HOURS = 4;
const MAX_CHUNKS_PER_RUN = 2;
const RETRY_AFTER_MINUTES = 60;

async function scheduledSync(env: Env): Promise<void> {
  // Make sure every account has a snapshot for today, even on days nothing syncs (cheap, one query).
  try {
    await snapshotBalances(env, { overwrite: false });
  } catch (err) {
    console.error('daily snapshot failed', (err as Error)?.message);
  }
  const now = Date.now();
  const staleCutoff = new Date(now - STALE_AFTER_HOURS * 3600_000).toISOString();
  const retryCutoff = new Date(now - RETRY_AFTER_MINUTES * 60_000).toISOString();
  // Skip banks waiting on a reconnect (those need you to sign in again in the app), and banks
  // attempted recently, so one failing bank can't block the others.
  const item = await env.DB.prepare(
    `SELECT i.item_id, i.access_token_enc, i.institution_name, i.cursor FROM items i
     LEFT JOIN settings s ON s.key = 'sync_attempt:' || i.item_id
     WHERE i.status != 'login_required'
       AND (i.last_synced_at IS NULL OR i.last_synced_at < ?1)
       AND (s.value IS NULL OR s.value < ?2)
     ORDER BY i.last_synced_at IS NOT NULL, i.last_synced_at
     LIMIT 1`,
  )
    .bind(staleCutoff, retryCutoff)
    .first<ItemRow>();
  if (!item) return;

  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(`sync_attempt:${item.item_id}`, new Date(now).toISOString())
    .run();

  try {
    for (let i = 0; i < MAX_CHUNKS_PER_RUN; i++) {
      const r = await syncItem(env, item);
      console.log('scheduled sync', item.institution_name ?? item.item_id, r.status, `+${r.added} ~${r.modified} -${r.removed}`);
      if (r.status !== 'ok' || !r.hasMore) return;
      // Continue from the cursor saved by the previous chunk.
      const next = await env.DB.prepare(`SELECT cursor FROM items WHERE item_id = ?`).bind(item.item_id).first<{ cursor: string }>();
      item.cursor = next?.cursor ?? item.cursor;
    }
  } catch (err) {
    console.error('scheduled sync failed', item.institution_name ?? item.item_id, (err as Error)?.message);
  }
}

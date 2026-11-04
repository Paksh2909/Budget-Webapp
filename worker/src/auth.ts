import { signSession, verifyPassphrase, verifySession, type SessionClaims } from './crypto';
import { HttpError, json, readJson, type Env } from './http';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Failed-login throttling: per client IP and globally (slows distributed guessing).
const LIMITS = {
  ip: { max: 5, windowSec: 15 * 60 },
  global: { max: 25, windowSec: 60 * 60 },
};

async function getSessionVersion(env: Env): Promise<string> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'session_version'`).first<{ value: string }>();
  return row?.value ?? '1';
}

async function attemptsExceeded(env: Env, bucket: string, limit: { max: number; windowSec: number }): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT count, window_start FROM login_attempts WHERE bucket = ?`)
    .bind(bucket)
    .first<{ count: number; window_start: number }>();
  if (!row) return false;
  const now = Math.floor(Date.now() / 1000);
  if (now - row.window_start > limit.windowSec) return false;
  return row.count >= limit.max;
}

async function recordFailure(env: Env, bucket: string, windowSec: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO login_attempts (bucket, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(bucket) DO UPDATE SET
       count = CASE WHEN ?2 - window_start > ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN ?2 - window_start > ?3 THEN ?2 ELSE window_start END`,
  )
    .bind(bucket, now, windowSec)
    .run();
}

export async function handleLogin(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{ passphrase?: unknown }>(req);
  const passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';
  if (!passphrase || passphrase.length > 512) throw new HttpError(400, 'Passphrase is required');

  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  const ipBucket = `ip:${ip}`;
  if ((await attemptsExceeded(env, ipBucket, LIMITS.ip)) || (await attemptsExceeded(env, 'global', LIMITS.global))) {
    throw new HttpError(429, 'Too many failed attempts. Try again later.', 'rate_limited');
  }

  let ok: boolean;
  try {
    ok = await verifyPassphrase(passphrase, env.PASSPHRASE_HASH);
  } catch (err) {
    console.error('Login misconfigured:', (err as Error).message);
    throw new HttpError(500, 'Server auth is not configured');
  }

  if (!ok) {
    await recordFailure(env, ipBucket, LIMITS.ip.windowSec);
    await recordFailure(env, 'global', LIMITS.global.windowSec);
    throw new HttpError(401, 'Incorrect passphrase', 'bad_passphrase');
  }

  await env.DB.prepare(`DELETE FROM login_attempts WHERE bucket = ?`).bind(ipBucket).run();
  const iat = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = { sub: 'owner', iat, exp: iat + SESSION_TTL_SECONDS, ver: await getSessionVersion(env) };
  const token = await signSession(claims, env.SESSION_SECRET);
  return json({ token, expiresAt: claims.exp });
}

/** Throws 401 unless the request carries a valid, unrevoked session token. Fails closed on misconfiguration. */
export async function requireAuth(req: Request, env: Env): Promise<SessionClaims> {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9_\-.]+)$/.exec(header);
  if (!match) throw new HttpError(401, 'Not signed in', 'unauthenticated');
  let claims: SessionClaims | null;
  try {
    claims = await verifySession(match[1]!, env.SESSION_SECRET);
  } catch (err) {
    console.error('Session verification misconfigured:', (err as Error).message);
    throw new HttpError(401, 'Not signed in', 'unauthenticated');
  }
  if (!claims) throw new HttpError(401, 'Session expired', 'unauthenticated');
  if (claims.ver !== (await getSessionVersion(env))) throw new HttpError(401, 'Session revoked', 'unauthenticated');
  return claims;
}

/** Invalidates every issued session by bumping the session version. */
export async function handleLogoutAll(env: Env): Promise<Response> {
  const next = String(Number(await getSessionVersion(env)) + 1);
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('session_version', ?1)
     ON CONFLICT(key) DO UPDATE SET value = ?1`,
  )
    .bind(next)
    .run();
  return json({ ok: true });
}

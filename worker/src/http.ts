export interface Env {
  DB: D1Database;
  PLAID_CLIENT_ID: string;
  PLAID_SECRET: string;
  PLAID_ENV: string;
  PLAID_REDIRECT_URI?: string;
  PASSPHRASE_HASH: string;
  SESSION_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  ALLOWED_ORIGINS: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

const MAX_BODY_BYTES = 64 * 1024;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  const len = Number(req.headers.get('Content-Length') ?? '0');
  if (len > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
  if (!text) return {} as T;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean);
}

export function isAllowedOrigin(origin: string | null, env: Env): origin is string {
  return !!origin && allowedOrigins(env).includes(origin.toLowerCase());
}

/** Adds CORS headers for allowlisted origins only. Other origins get no CORS headers, so browsers block them. */
export function withCors(res: Response, origin: string | null, env: Env): Response {
  const headers = new Headers(res.headers);
  headers.append('Vary', 'Origin');
  if (isAllowedOrigin(origin, env)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Max-Age', '600');
  }
  return new Response(res.body, { status: res.status, headers });
}

// ---- small validators ----

export function str(v: unknown, field: string, { max = 200, optional = false } = {}): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined;
    throw new HttpError(400, `${field} is required`);
  }
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be a string`);
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `${field} is too long`);
  return t;
}

export function num(v: unknown, field: string, { min = -1e9, max = 1e9 } = {}): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new HttpError(400, `${field} must be a number`);
  if (v < min || v > max) throw new HttpError(400, `${field} is out of range`);
  return Math.round(v * 100) / 100;
}

export function isoDate(v: unknown, field: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new HttpError(400, `${field} must be YYYY-MM-DD`);
  }
  return v;
}

export const nowIso = () => new Date().toISOString();

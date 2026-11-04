// Web Crypto helpers: base64url, constant-time compare, PBKDF2 verify, HS256 JWT, AES-GCM.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes base64 or base64url. */
export function b64Decode(input: string): Uint8Array<ArrayBuffer> {
  const s = input.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function secretBytes(secret: string | undefined, name: string): Uint8Array<ArrayBuffer> {
  if (!secret) throw new Error(`${name} is not configured`);
  const bytes = b64Decode(secret);
  if (bytes.length < 32) throw new Error(`${name} must be at least 32 bytes (base64)`);
  return bytes;
}

// ---------- Passphrase (PBKDF2-SHA256) ----------
// Stored format: pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>

export async function verifyPassphrase(passphrase: string, stored: string | undefined): Promise<boolean> {
  if (!stored) throw new Error('PASSPHRASE_HASH is not configured');
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') throw new Error('PASSPHRASE_HASH has an invalid format');
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 100_000) {
    throw new Error('PASSPHRASE_HASH iterations must be 10000-100000');
  }
  const salt = b64Decode(parts[2]!);
  const expected = b64Decode(parts[3]!);
  const key = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    expected.length * 8,
  );
  return timingSafeEqual(new Uint8Array(bits), expected);
}

// ---------- Session tokens (JWT HS256) ----------

export interface SessionClaims {
  sub: 'owner';
  iat: number;
  exp: number;
  ver: string;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    secretBytes(secret, 'SESSION_SECRET'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

const JWT_HEADER = b64urlEncode(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));

export async function signSession(claims: SessionClaims, secret: string): Promise<string> {
  const payload = b64urlEncode(enc.encode(JSON.stringify(claims)));
  const data = `${JWT_HEADER}.${payload}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return `${data}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts as [string, string, string];
  // Only accept the exact header we issue (blocks alg confusion).
  if (header !== JWT_HEADER) return null;
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = b64Decode(sig);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sigBytes, enc.encode(`${header}.${payload}`));
  if (!ok) return null;
  try {
    const claims = JSON.parse(dec.decode(b64Decode(payload))) as SessionClaims;
    if (claims.sub !== 'owner' || typeof claims.exp !== 'number') return null;
    if (claims.exp * 1000 <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

// ---------- Access token encryption (AES-256-GCM) ----------

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = secretBytes(secret, 'TOKEN_ENCRYPTION_KEY').slice(0, 32);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptString(plain: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(plain));
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ct))}`;
}

export async function decryptString(blob: string, secret: string): Promise<string> {
  const [v, ivB64, ctB64] = blob.split('.');
  if (v !== 'v1' || !ivB64 || !ctB64) throw new Error('Unsupported ciphertext format');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64Decode(ivB64) },
    await aesKey(secret),
    b64Decode(ctB64),
  );
  return dec.decode(pt);
}

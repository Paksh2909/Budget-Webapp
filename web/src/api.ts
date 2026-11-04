const API_URL = (import.meta.env.VITE_API_URL as string).replace(/\/$/, '');
const TOKEN_KEY = 'budget.session';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const session = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = session.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Network error. Check your connection.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login') {
      session.clear();
      window.dispatchEvent(new Event('auth:logout'));
    }
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.code);
  }
  return data as T;
}

import { useState, type FormEvent } from 'react';
import { api, session } from '../api';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>('/api/login', { method: 'POST', body: { passphrase } });
      session.set(r.token);
      setPassphrase('');
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={72} height={72} />
      <h1>Budget</h1>
      <form onSubmit={submit} className="card login-card">
        <label className="field">
          <span className="field-label">Passphrase</span>
          <input
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            required
            autoFocus
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary block" disabled={busy || !passphrase}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const money = (n: number) => usd.format(n);

export const signedMoney = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '') + usd.format(Math.abs(n));

/** Short axis labels like $13k, $9,666, $1.2M. */
export function axisMoney(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e6) return `${sign}$${+(a / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${sign}$${+(a / 1e3).toFixed(1)}k`;
  return usdWhole.format(n);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const monthShort = (m: number) => MONTHS[m]!;
export const monthLong = (m: number) => MONTHS_LONG[m]!;
export const weekday = (d: number) => WEEKDAYS[d]!;

export function timeOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

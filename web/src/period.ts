import { monthLong, monthShort } from './format';

// All dates are 'YYYY-MM-DD' strings; math is done in UTC to avoid DST drift.

export type PeriodKind = 'week' | 'month' | 'year' | 'all';
export interface Period {
  kind: PeriodKind;
  anchor: string; // any date inside the period
}
export interface Range {
  start: string | null; // inclusive; null = unbounded
  end: string | null; // exclusive; null = unbounded
}

export const toDate = (s: string) => new Date(s + 'T00:00:00Z');
export const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function today(): string {
  const d = new Date();
  const local = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  return fmt(local);
}

export function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

export function range(p: Period): Range {
  const d = toDate(p.anchor);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (p.kind) {
    case 'week': {
      const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      const start = addDays(p.anchor, -dow);
      return { start, end: addDays(start, 7) };
    }
    case 'month':
      return { start: fmt(new Date(Date.UTC(y, m, 1))), end: fmt(new Date(Date.UTC(y, m + 1, 1))) };
    case 'year':
      return { start: fmt(new Date(Date.UTC(y, 0, 1))), end: fmt(new Date(Date.UTC(y + 1, 0, 1))) };
    case 'all':
      return { start: null, end: null };
  }
}

export function shift(p: Period, dir: 1 | -1): Period {
  const d = toDate(p.anchor);
  switch (p.kind) {
    case 'week':
      return { ...p, anchor: addDays(p.anchor, 7 * dir) };
    case 'month':
      return { ...p, anchor: fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1))) };
    case 'year':
      return { ...p, anchor: fmt(new Date(Date.UTC(d.getUTCFullYear() + dir, 0, 1))) };
    case 'all':
      return p;
  }
}

export function isCurrent(p: Period): boolean {
  const r = range(p);
  const t = today();
  return r.end === null || (r.start! <= t && t < r.end);
}

export function label(p: Period): string {
  const d = toDate(p.anchor);
  switch (p.kind) {
    case 'week': {
      const r = range(p);
      const s = toDate(r.start!);
      const e = toDate(addDays(r.end!, -1));
      const left = `${monthShort(s.getUTCMonth())} ${s.getUTCDate()}`;
      const right =
        s.getUTCMonth() === e.getUTCMonth() ? `${e.getUTCDate()}` : `${monthShort(e.getUTCMonth())} ${e.getUTCDate()}`;
      return `${left} – ${right}, ${e.getUTCFullYear()}`;
    }
    case 'month':
      return `${monthLong(d.getUTCMonth())} ${d.getUTCFullYear()}`;
    case 'year':
      return String(d.getUTCFullYear());
    case 'all':
      return 'All time';
  }
}

export const inRange = (date: string, r: Range) => (r.start === null || date >= r.start) && (r.end === null || date < r.end);

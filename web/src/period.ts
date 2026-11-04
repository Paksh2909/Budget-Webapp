import { monthLong, monthShort } from './format';

// All dates are 'YYYY-MM-DD' strings; math is done in UTC to avoid DST drift.

export type PeriodKind = 'day' | 'week' | 'month' | 'year' | 'all' | 'custom';
export interface Period {
  kind: PeriodKind;
  anchor: string; // any date inside the period (custom: the start date)
  end?: string; // custom only: inclusive last day
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

export function monthStart(s: string): string {
  const d = toDate(s);
  return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

export function range(p: Period): Range {
  const d = toDate(p.anchor);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (p.kind) {
    case 'day':
      return { start: p.anchor, end: addDays(p.anchor, 1) };
    case 'week': {
      const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      const start = addDays(p.anchor, -dow);
      return { start, end: addDays(start, 7) };
    }
    case 'month':
      return { start: fmt(new Date(Date.UTC(y, m, 1))), end: fmt(new Date(Date.UTC(y, m + 1, 1))) };
    case 'year':
      return { start: fmt(new Date(Date.UTC(y, 0, 1))), end: fmt(new Date(Date.UTC(y + 1, 0, 1))) };
    case 'custom':
      return { start: p.anchor, end: addDays(p.end ?? p.anchor, 1) };
    case 'all':
      return { start: null, end: null };
  }
}

export function shift(p: Period, dir: 1 | -1): Period {
  const d = toDate(p.anchor);
  switch (p.kind) {
    case 'day':
      return { ...p, anchor: addDays(p.anchor, dir) };
    case 'week':
      return { ...p, anchor: addDays(p.anchor, 7 * dir) };
    case 'month':
      return { ...p, anchor: fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1))) };
    case 'year':
      return { ...p, anchor: fmt(new Date(Date.UTC(d.getUTCFullYear() + dir, 0, 1))) };
    case 'custom': {
      // Move by the length of the custom range.
      const len = daysBetween(p.anchor, p.end ?? p.anchor) + 1;
      return { ...p, anchor: addDays(p.anchor, len * dir), end: addDays(p.end ?? p.anchor, len * dir) };
    }
    case 'all':
      return p;
  }
}

/** True when the period already contains today (so "next" would be in the future). */
export function isCurrent(p: Period): boolean {
  const r = range(p);
  return r.end === null || today() < r.end;
}

const dayLabel = (s: string, withYear = true) => {
  const d = toDate(s);
  return `${monthShort(d.getUTCMonth())} ${d.getUTCDate()}${withYear ? `, ${d.getUTCFullYear()}` : ''}`;
};

function spanLabel(start: string, endInclusive: string): string {
  const s = toDate(start);
  const e = toDate(endInclusive);
  if (start === endInclusive) return dayLabel(start);
  if (s.getUTCFullYear() !== e.getUTCFullYear()) return `${dayLabel(start)} – ${dayLabel(endInclusive)}`;
  const right =
    s.getUTCMonth() === e.getUTCMonth() ? `${e.getUTCDate()}` : `${monthShort(e.getUTCMonth())} ${e.getUTCDate()}`;
  return `${dayLabel(start, false)} – ${right}, ${e.getUTCFullYear()}`;
}

export function label(p: Period): string {
  const d = toDate(p.anchor);
  switch (p.kind) {
    case 'day':
      return p.anchor === today() ? 'Today' : `${monthLong(d.getUTCMonth())} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
    case 'week': {
      const r = range(p);
      return spanLabel(r.start!, addDays(r.end!, -1));
    }
    case 'month':
      return `${monthLong(d.getUTCMonth())} ${d.getUTCFullYear()}`;
    case 'year':
      return String(d.getUTCFullYear());
    case 'custom':
      return spanLabel(p.anchor, p.end ?? p.anchor);
    case 'all':
      return 'All time';
  }
}

export const inRange = (date: string, r: Range) => (r.start === null || date >= r.start) && (r.end === null || date < r.end);

import type { HomeLayout } from './types';

export const HOME_TILES = [
  { id: 'balance', label: 'Total balance' },
  { id: 'forecast', label: 'Monthly forecast' },
  { id: 'bills', label: 'Upcoming bills' },
  { id: 'insights', label: 'This month' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'categories', label: 'Categories' },
  { id: 'recurring', label: 'Recurring' },
] as const;

export type TileId = (typeof HOME_TILES)[number]['id'];
const KNOWN = new Set<string>(HOME_TILES.map((t) => t.id));

export const tileLabel = (id: string) => HOME_TILES.find((t) => t.id === id)?.label ?? id;

/** Saved layout, cleaned up: unknown ids dropped, tiles added since it was saved appended at the end. */
export function resolveLayout(saved: HomeLayout | null): { order: TileId[]; hidden: Set<TileId> } {
  const order = (saved?.order ?? []).filter((id): id is TileId => KNOWN.has(id));
  const seen = new Set(order);
  for (const t of HOME_TILES) if (!seen.has(t.id)) order.push(t.id);
  const hidden = new Set((saved?.hidden ?? []).filter((id): id is TileId => KNOWN.has(id)));
  return { order: [...new Set(order)], hidden };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!);
  return next;
}

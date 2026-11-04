import type { ReactNode } from 'react';

export interface Segment {
  value: number;
  color: string;
  label: string;
}

interface Props {
  segments: Segment[];
  size?: number;
  thickness?: number;
  showLabels?: boolean;
  center?: ReactNode;
  ariaLabel: string;
}

const GAP_DEG = 1.6;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`;
}

export function Donut({ segments, size = 300, thickness = 14, showLabels = false, center, ariaLabel }: Props) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const W = showLabels ? Math.max(size, 340) : size;
  const H = size;
  const cx = W / 2;
  const cy = H / 2;
  const r = showLabels ? H / 2 - 50 : H / 2 - thickness / 2 - 1;

  let angle = 0;
  const arcs = segments.map((s) => {
    const sweep = total ? (s.value / total) * 360 : 0;
    const a0 = angle;
    angle += sweep;
    const gap = segments.length > 1 && sweep > GAP_DEG * 2 ? GAP_DEG / 2 : 0;
    return { ...s, a0: a0 + gap, a1: a0 + sweep - gap, mid: a0 + sweep / 2, sweep };
  });

  // Label layout: place outside the ring, then push apart vertically per side.
  type L = { x: number; y: number; ex: number; ey: number; side: 1 | -1; label: string; color: string };
  const labels: L[] = [];
  if (showLabels) {
    for (const a of arcs) {
      if (a.sweep < 0.5) continue;
      const [ex, ey] = polar(cx, cy, r + thickness / 2 + 2, a.mid);
      const [lx, ly] = polar(cx, cy, r + thickness / 2 + 22, a.mid);
      labels.push({ x: lx, y: ly, ex, ey, side: lx >= cx ? 1 : -1, label: a.label, color: a.color });
    }
    for (const side of [1, -1] as const) {
      const group = labels.filter((l) => l.side === side).sort((a, b) => a.y - b.y);
      for (let i = 1; i < group.length; i++) {
        if (group[i]!.y - group[i - 1]!.y < 16) group[i]!.y = group[i - 1]!.y + 16;
      }
    }
  }

  return (
    <div className="donut" style={{ width: '100%', maxWidth: W }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
        {total === 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />}
        {arcs.map((a, i) =>
          a.sweep >= 359.99 ? (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={a.color} strokeWidth={thickness} />
          ) : a.a1 > a.a0 ? (
            <path key={i} d={arc(cx, cy, r, a.a0, a.a1)} fill="none" stroke={a.color} strokeWidth={thickness} />
          ) : null,
        )}
        {labels.map((l, i) => {
          const tx = l.x + l.side * 6;
          return (
            <g key={i}>
              <polyline
                points={`${l.ex},${l.ey} ${l.x},${l.y} ${l.x + l.side * 4},${l.y}`}
                fill="none"
                stroke={l.color}
                strokeWidth={1.5}
              />
              <circle cx={l.ex} cy={l.ey} r={2} fill={l.color} />
              <text x={tx} y={l.y + 4} textAnchor={l.side === 1 ? 'start' : 'end'} className="donut-label">
                {l.label}
              </text>
            </g>
          );
        })}
      </svg>
      {center && <div className="donut-center">{center}</div>}
    </div>
  );
}

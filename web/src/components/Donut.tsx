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
  center?: ReactNode;
  ariaLabel: string;
  /** Index of the highlighted segment; others fade. */
  selected?: number | null;
  /** Enables tap-to-select. Called with the tapped index, or null when tapping the selected one again. */
  onSelect?: (index: number | null) => void;
}

const GAP_DEG = 1.6;
const GROW = 6; // extra stroke width on the selected slice

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

export function Donut({ segments, size = 300, thickness = 14, center, ariaLabel, selected = null, onSelect }: Props) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const pad = onSelect ? GROW / 2 + 2 : 1;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - thickness / 2 - pad;

  let angle = 0;
  const arcs = segments.map((s) => {
    const sweep = total ? (s.value / total) * 360 : 0;
    const a0 = angle;
    angle += sweep;
    const gap = segments.length > 1 && sweep > GAP_DEG * 2 ? GAP_DEG / 2 : 0;
    return { ...s, a0: a0 + gap, a1: a0 + sweep - gap, sweep };
  });

  const tap = (i: number) => onSelect?.(selected === i ? null : i);

  return (
    <div className="donut" style={{ width: '100%', maxWidth: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" role="img" aria-label={ariaLabel}>
        {total === 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />}
        {arcs.map((a, i) => {
          if (a.sweep <= 0) return null;
          const isSel = selected === i;
          const dim = selected !== null && !isSel;
          const full = a.sweep >= 359.99;
          const d = full ? undefined : arc(cx, cy, r, a.a0, Math.max(a.a1, a.a0 + 0.01));
          const common = {
            fill: 'none',
            stroke: a.color,
            strokeWidth: isSel ? thickness + GROW : thickness,
            opacity: dim ? 0.28 : 1,
            className: 'donut-seg',
          };
          return (
            <g key={i}>
              {full ? <circle cx={cx} cy={cy} r={r} {...common} /> : <path d={d} {...common} />}
              {onSelect && (
                // Wider invisible stroke so thin slices are still easy to tap.
                full ? (
                  <circle cx={cx} cy={cy} r={r} fill="none" stroke="transparent" strokeWidth={thickness + 22} onClick={() => tap(i)} className="donut-hit" />
                ) : (
                  <path d={d} fill="none" stroke="transparent" strokeWidth={thickness + 22} onClick={() => tap(i)} className="donut-hit" />
                )
              )}
            </g>
          );
        })}
      </svg>
      {center && <div className="donut-center">{center}</div>}
    </div>
  );
}

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { axisMoney } from '../format';

export interface Series {
  values: number[];
  color: string;
  fill?: boolean;
}

interface Props {
  series: Series[];
  xLabels: string[];
  height?: number;
  zeroBased?: boolean;
  ariaLabel: string;
}

const PAD = { top: 12, right: 8, bottom: 26, left: 58 };

/** Monotone cubic interpolation (no overshoot), returns an SVG path. */
function smoothPath(pts: [number, number][]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0]![0]},${pts[0]![1]}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0]);
    slope.push((pts[i + 1]![1] - pts[i]![1]) / (dx[i] || 1));
  }
  const m: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) {
    m.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2);
  }
  m.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / slope[i]!;
    const b = m[i + 1]! / slope[i]!;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i]!;
      m[i + 1] = t * b * slope[i]!;
    }
  }
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += `C${x0 + h},${y0 + m[i]! * h} ${x1 - h},${y1 - m[i + 1]! * h} ${x1},${y1}`;
  }
  return d;
}

export function LineChart({ series, xLabels, height = 200, zeroBased = false, ariaLabel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const gradId = useId();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = series.flatMap((s) => s.values);
  const n = Math.max(...series.map((s) => s.values.length), 0);
  if (!n) {
    return (
      <div ref={ref} className="chart-empty" style={{ height }}>
        No data for this period
      </div>
    );
  }

  let min = zeroBased ? Math.min(0, ...all) : Math.min(...all);
  let max = Math.max(...all);
  // Give near-flat lines some vertical room so the axis labels stay distinct.
  const minSpan = Math.max(Math.abs(max) * 0.02, 10);
  if (max - min < minSpan) {
    const pad = (minSpan - (max - min)) / 2;
    max += pad;
    min = zeroBased ? Math.min(0, min) : min - pad;
  }
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min)) * innerH;

  const ticks = [0, 1, 2, 3].map((i) => min + ((max - min) * i) / 3);
  let tickLabels = ticks.map(axisMoney);
  if (new Set(tickLabels).size < tickLabels.length) tickLabels = ticks.map((t) => '$' + Math.round(t).toLocaleString('en-US'));
  const labelCount = Math.min(4, n);
  const labelIdx = labelCount === 1 ? [0] : [...Array(labelCount)].map((_, i) => Math.round((i * (n - 1)) / (labelCount - 1)));

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`${gradId}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t, i) => (
          <text key={i} x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="chart-axis">
            {tickLabels[i]}
          </text>
        ))}
        {labelIdx.map((i, k) => (
          <text
            key={k}
            x={x(i)}
            y={height - 6}
            textAnchor={k === 0 ? 'start' : k === labelIdx.length - 1 ? 'end' : 'middle'}
            className="chart-axis"
          >
            {xLabels[i]}
          </text>
        ))}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => [x(i), y(v)] as [number, number]);
          const line = smoothPath(pts);
          const area = `${line}L${x(s.values.length - 1)},${PAD.top + innerH}L${x(0)},${PAD.top + innerH}Z`;
          return (
            <g key={si}>
              {s.fill !== false && <path d={area} fill={`url(#${gradId}-${si})`} />}
              <path d={line} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

import { CalendarDays, ChevronLeft, ChevronRight, Check, CreditCard, Landmark, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { category } from '../categories';
import { useData } from '../data';
import { isCurrent, label, shift, today, type PeriodKind } from '../period';
import type { Account } from '../types';

// ---------- Segmented control ----------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Bottom sheet ----------

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.sheet-close)');
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-header">
          <h2>{title}</h2>
          <button className="icon-btn sheet-close" onClick={onClose} aria-label="Close">
            <X size={22} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

// ---------- Period selector ----------

const KINDS: { value: PeriodKind; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All time' },
];

export function PeriodBar({ right }: { right?: ReactNode }) {
  const { period, setPeriod } = useData();
  const [open, setOpen] = useState(false);
  const canNav = period.kind !== 'all';
  return (
    <div className="period-bar">
      <button className="period-label" onClick={() => setOpen(true)} aria-label={`Period: ${label(period)}. Change period`}>
        <CalendarDays size={22} className="muted" />
        <span>{label(period)}</span>
      </button>
      <div className="period-nav">
        <button className="icon-btn" disabled={!canNav} onClick={() => setPeriod(shift(period, -1))} aria-label="Previous period">
          <ChevronLeft size={20} />
        </button>
        <button
          className="icon-btn"
          disabled={!canNav || isCurrent(period)}
          onClick={() => setPeriod(shift(period, 1))}
          aria-label="Next period"
        >
          <ChevronRight size={20} />
        </button>
        {right}
      </div>
      {open && (
        <Sheet title="Show" onClose={() => setOpen(false)}>
          <div className="option-list">
            {KINDS.map((k) => (
              <button
                key={k.value}
                className="option"
                onClick={() => {
                  setPeriod({ kind: k.value, anchor: today() });
                  setOpen(false);
                }}
              >
                <span>{k.label}</span>
                {period.kind === k.value && <Check size={20} />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ---------- Icons ----------

export function CategoryIcon({ id, size = 48, logo }: { id: string; size?: number; logo?: string | null }) {
  const c = category(id);
  const Icon = c.icon;
  return (
    <span className="cat-icon" style={{ background: c.color, width: size, height: size }} aria-hidden="true">
      <Icon size={size * 0.48} color="#fff" strokeWidth={2.2} />
      {logo && <img className="cat-badge" src={logo} alt="" loading="lazy" referrerPolicy="no-referrer" />}
    </span>
  );
}

const ACCOUNT_COLORS = ['#3b6fe0', '#ec7a2c', '#4fb3e8', '#5a6475', '#9aa0a8', '#3f51b5'];

export function AccountIcon({ account, size = 40 }: { account: Account; size?: number }) {
  const isCard = account.type === 'credit';
  const Icon = isCard ? CreditCard : Landmark;
  let h = 0;
  for (const ch of account.item_id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      className="acct-icon"
      style={{ background: ACCOUNT_COLORS[h % ACCOUNT_COLORS.length], width: size, height: size }}
      aria-hidden="true"
    >
      <Icon size={size * 0.5} color="#fff" />
    </span>
  );
}

// ---------- Progress ring ----------

export function ProgressRing({
  value,
  size = 52,
  stroke = 4,
  color,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(Math.max(value, 0), 1);
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${c * pct} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-center">{children}</span>
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Loading" />;
}

export function PageHeader({ title, actions, onBack }: { title: string; actions?: ReactNode; onBack?: () => void }) {
  return (
    <header className="page-header">
      {onBack && (
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <ChevronLeft size={26} />
        </button>
      )}
      <h1>{title}</h1>
      <div className="header-actions">{actions}</div>
    </header>
  );
}

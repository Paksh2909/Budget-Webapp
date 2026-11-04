import {
  CalendarDays,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Infinity as InfinityIcon,
  Landmark,
  ListFilter,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { category } from '../categories';
import { useData } from '../data';
import { EMPTY_FILTERS, filterSummary, isFiltered } from '../filters';
import { addDays, isCurrent, label, shift, today, type PeriodKind } from '../period';
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

export function Sheet({
  title,
  onClose,
  children,
  full = false,
  headerAction,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  full?: boolean;
  headerAction?: ReactNode;
}) {
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
        className={'sheet' + (full ? ' full' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-header">
          {full && (
            <button className="icon-btn sheet-close" onClick={onClose} aria-label="Close">
              <X size={24} />
            </button>
          )}
          <h2>{title}</h2>
          {headerAction}
          {!full && (
            <button className="icon-btn sheet-close" onClick={onClose} aria-label="Close">
              <X size={22} />
            </button>
          )}
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

// ---------- Period selector ----------

const QUICK_KINDS: { value: PeriodKind; title: string }[] = [
  { value: 'day', title: 'Today' },
  { value: 'week', title: 'This week' },
  { value: 'month', title: 'This month' },
  { value: 'year', title: 'This year' },
];

function PeriodSheet({ onClose }: { onClose: () => void }) {
  const { period, setPeriod } = useData();
  const t = today();
  const [custom, setCustom] = useState(period.kind === 'custom');
  const [from, setFrom] = useState(period.kind === 'custom' ? period.anchor : addDays(t, -29));
  const [to, setTo] = useState(period.kind === 'custom' ? (period.end ?? t) : t);
  const pick = (kind: PeriodKind) => {
    setPeriod({ kind, anchor: t });
    onClose();
  };
  const validCustom = !!from && !!to && from <= to;

  return (
    <Sheet title="Show" onClose={onClose}>
      <div className="option-list">
        {QUICK_KINDS.map((k) => {
          const selected = period.kind === k.value && isCurrent(period);
          return (
            <button key={k.value} className="option" onClick={() => pick(k.value)} aria-pressed={selected}>
              <span className="option-text">
                <span>{k.title}</span>
                <span className="muted">{label({ kind: k.value, anchor: t }).replace(/^Today$/, label({ kind: 'custom', anchor: t }))}</span>
              </span>
              {selected && <Check size={22} className="check-badge" />}
            </button>
          );
        })}
        <hr className="divider" />
        <button className="option" onClick={() => pick('all')} aria-pressed={period.kind === 'all'}>
          <span className="option-icon">
            <InfinityIcon size={24} aria-hidden="true" />
            All time
          </span>
          {period.kind === 'all' && <Check size={22} className="check-badge" />}
        </button>
        <button className="option" onClick={() => setCustom(true)} aria-expanded={custom}>
          <span className="option-icon">
            <CalendarRange size={24} aria-hidden="true" />
            Custom
          </span>
          {period.kind === 'custom' && <Check size={22} className="check-badge" />}
        </button>
        {custom && (
          <div className="custom-range">
            <label className="field">
              <span className="field-label">From</span>
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">To</span>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </label>
            <button
              className="btn primary block"
              disabled={!validCustom}
              onClick={() => {
                setPeriod({ kind: 'custom', anchor: from, end: to });
                onClose();
              }}
            >
              Apply range
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

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
      {open && <PeriodSheet onClose={() => setOpen(false)} />}
    </div>
  );
}

// ---------- Filters entry point ----------

export function FilterButton({ onClick }: { onClick: () => void }) {
  const { filters } = useData();
  const active = isFiltered(filters);
  return (
    <button className="icon-btn filter-btn" onClick={onClick} aria-label={active ? `Filters: ${filterSummary(filters)}` : 'Filters'}>
      <ListFilter size={22} />
      {active && <span className="badge-dot" aria-hidden="true" />}
    </button>
  );
}

export function ActiveFilters() {
  const { filters, setFilters } = useData();
  if (!isFiltered(filters)) return null;
  return (
    <div className="chips">
      <button className="chip active" onClick={() => setFilters(EMPTY_FILTERS)} aria-label={`Clear filters: ${filterSummary(filters)}`}>
        {filterSummary(filters)} <X size={16} aria-hidden="true" />
      </button>
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

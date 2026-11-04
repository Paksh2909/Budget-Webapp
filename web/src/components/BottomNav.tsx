import { ChartColumn, CircleDashed, ClipboardList, House } from 'lucide-react';
import { navigate } from '../router';

const TABS = [
  { path: '/', label: 'Home', icon: House },
  { path: '/categories', label: 'Categories', icon: CircleDashed },
  { path: '/analytics', label: 'Analytics', icon: ChartColumn },
  { path: '/transactions', label: 'Transactions', icon: ClipboardList },
];

export function BottomNav({ current }: { current: string }) {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {TABS.map((t) => {
        const active = current === t.path;
        const Icon = t.icon;
        return (
          <button key={t.path} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => navigate(t.path)}>
            <span className="nav-pill">
              <Icon size={24} strokeWidth={active ? 2.4 : 2} />
            </span>
            <span className="nav-label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

import { useEffect, useState } from 'react';
import { session } from './api';
import { BottomNav } from './components/BottomNav';
import { OAuthResume } from './components/PlaidLink';
import { Spinner } from './components/ui';
import { DataProvider, useData } from './data';
import { Accounts } from './pages/Accounts';
import { Analytics } from './pages/Analytics';
import { Budgets } from './pages/Budgets';
import { Categories } from './pages/Categories';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Recurring } from './pages/Recurring';
import { Rules } from './pages/Rules';
import { Transactions } from './pages/Transactions';
import { useRoute } from './router';

const TAB_PATHS = ['/', '/categories', '/analytics', '/transactions'];

function Shell() {
  const route = useRoute();
  const { loading, error, data, reload, toast } = useData();

  let page;
  switch (route.path) {
    case '/categories':
      page = <Categories />;
      break;
    case '/analytics':
      page = <Analytics />;
      break;
    case '/transactions':
      page = <Transactions key={route.params.get('q') ?? ''} initialQuery={route.params.get('q') ?? ''} />;
      break;
    case '/accounts':
      page = <Accounts />;
      break;
    case '/recurring':
      page = <Recurring />;
      break;
    case '/rules':
      page = <Rules />;
      break;
    case '/budgets':
      page = <Budgets />;
      break;
    default:
      page = <Home />;
  }

  return (
    <>
      <main className="app">
        {loading && !data ? (
          <div className="center-fill">
            <Spinner />
          </div>
        ) : error && !data ? (
          <div className="center-fill">
            <p className="error">{error}</p>
            <button className="btn primary" onClick={reload}>
              Retry
            </button>
          </div>
        ) : (
          page
        )}
      </main>
      {TAB_PATHS.includes(route.path) && <BottomNav current={route.path} />}
      <OAuthResume />
      <div className="toast-region" aria-live="polite">
        {toast && <div className="toast">{toast}</div>}
      </div>
    </>
  );
}

export function App() {
  const [authed, setAuthed] = useState(() => !!session.get());

  useEffect(() => {
    const onLogout = () => setAuthed(false);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}

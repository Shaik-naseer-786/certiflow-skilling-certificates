import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, getToken, setToken, type User } from './api';
import { Avatar, BrandMark, Icon } from './components';
import { ROLE_LABEL } from './format';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import BatchDetail from './pages/BatchDetail';
import StateTools from './pages/StateTools';
import Verify from './pages/Verify';

// Sidebar + page area for signed-in people.
function AppShell({ user, onLogout, children }: { user: User; onLogout: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="app">
      <div className="topbar-m">
        <Link to="/" className="brand"><BrandMark /><span className="brand-name">CertiFlow</span></Link>
        <button type="button" onClick={() => setOpen(!open)} aria-label="Open menu" aria-expanded={open}><Icon name="menu" /></button>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`side ${open ? 'open' : ''}`}>
        <Link to="/" className="brand">
          <BrandMark />
          <span className="brand-name">CertiFlow<span className="brand-sub">Pragati Skills Mission</span></span>
        </Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end><Icon name="batches" />Batches</NavLink>
          <NavLink to="/verify"><Icon name="verify" />Check a certificate</NavLink>
          {user.role === 'STATE' && (
            <>
              <span className="nav-group">State office</span>
              <NavLink to="/state/stuck"><Icon name="clock" />Stuck batches</NavLink>
              <NavLink to="/state/audit"><Icon name="log" />Audit log</NavLink>
              <NavLink to="/state/messages"><Icon name="chat" />WhatsApp inbox</NavLink>
            </>
          )}
        </nav>
        <div className="side-foot">
          <div className="me">
            <Avatar name={user.name} role={user.role} />
            <div>
              <b>{user.name}</b>
              <small>{ROLE_LABEL[user.role]}{user.district ? `, ${user.district}` : ''}</small>
            </div>
          </div>
          <button type="button" className="signout" onClick={onLogout}><Icon name="out" />Sign out or switch user</button>
        </div>
      </aside>
      <main className="main">
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

// Bare page for people who are not signed in (employers, candidates).
function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="public">
      <header className="public-bar">
        <Link to="/verify" className="brand" style={{ padding: 0 }}>
          <BrandMark />
          <span className="brand-name">CertiFlow<span className="brand-sub">Pragati Skills Mission</span></span>
        </Link>
        <Link to="/" className="signin">Staff sign in</Link>
      </header>
      {children}
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="denied">
      <Icon name="lock" />
      <h1>Only the state office can open this page</h1>
      <p>The audit log and the other state tools are private. Signed in as another role? Switch user from the menu.</p>
      <Link to="/" className="btn btn-secondary">Back to batches</Link>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // On page load, restore the session from the saved token.
  useEffect(() => {
    if (!getToken()) return setReady(true);
    api<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  const logout = () => {
    setToken(null);
    setUser(null);
    navigate('/');
  };

  if (!ready) return <p className="muted" style={{ textAlign: 'center', marginTop: 80 }}>Loading</p>;

  // Verification is public: anyone can open it without signing in.
  const verifyRoutes = (
    <Routes>
      <Route path="/verify" element={<Verify />} />
      <Route path="/verify/:certNo" element={<Verify />} />
    </Routes>
  );
  if (!user) {
    if (pathname.startsWith('/verify')) return <PublicShell>{verifyRoutes}</PublicShell>;
    return <Login onLogin={setUser} />;
  }

  return (
    <AppShell user={user} onLogout={logout}>
      <Routes>
        <Route path="/" element={<Dashboard user={user} />} />
        <Route path="/batches/:id" element={<BatchDetail user={user} />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/verify/:certNo" element={<Verify />} />
        <Route path="/state" element={<Navigate to="/state/stuck" replace />} />
        <Route path="/state/:tab" element={user.role === 'STATE' ? <StateTools /> : <AccessDenied />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

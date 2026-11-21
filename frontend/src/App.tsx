import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { api, getToken, setToken, type User } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import BatchDetail from './pages/BatchDetail';
import StateTools from './pages/StateTools';
import Verify from './pages/Verify';

const ROLE_LABEL = { CENTRE: 'Training centre', DISTRICT_OFFICER: 'District officer', QUALITY: 'Quality team', STATE: 'State office' };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

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

  if (!ready) return <p className="muted center">Loading...</p>;

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">Pragati Skills Mission <span>CertiFlow</span></Link>
        <nav>
          <Link to="/verify">Verify a certificate</Link>
          {user?.role === 'STATE' && <Link to="/state">State tools</Link>}
          {user && (
            <>
              <span className="who">{user.name} · {ROLE_LABEL[user.role]}{user.district ? ` · ${user.district}` : ''}</span>
              <button className="link" onClick={logout}>Switch user / Log out</button>
            </>
          )}
        </nav>
      </header>
      <main>
        <Routes>
          {/* Public pages: no login needed */}
          <Route path="/verify" element={<Verify />} />
          <Route path="/verify/:certNo" element={<Verify />} />
          {/* Everything else needs a logged-in user */}
          <Route path="/" element={user ? <Dashboard user={user} /> : <Login onLogin={setUser} />} />
          <Route path="/batches/:id" element={user ? <BatchDetail user={user} /> : <Login onLogin={setUser} />} />
          <Route path="/state" element={user?.role === 'STATE' ? <StateTools /> : <Login onLogin={setUser} />} />
        </Routes>
      </main>
    </>
  );
}

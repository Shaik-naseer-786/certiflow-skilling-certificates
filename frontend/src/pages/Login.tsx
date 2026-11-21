import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, setToken, type User } from '../api';
import { Avatar, BrandMark, Notice, Seal } from '../components';
import { ROLE_LABEL } from '../format';

type DemoUser = { name: string; email: string; role: string; district: string | null };
const ROLE_ORDER = ['CENTRE', 'DISTRICT_OFFICER', 'QUALITY', 'STATE'];

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true); // the demo list arrives a moment after the page
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ users: DemoUser[] }>('/auth/demo-users')
      .then((r) => setUsers([...r.users].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name))))
      .catch(() => undefined) // the demo list is optional
      .finally(() => setLoadingUsers(false));
  }, []);

  // Reserve the space of the demo list while it loads, so the form does not jump when it arrives.
  const showDemo = loadingUsers || users.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ token: string; user: User }>('/auth/login', { body: { email, password } });
      setToken(r.token);
      onLogin(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login-art">
        <div className="brand" style={{ padding: 0 }}>
          <BrandMark />
          <span className="brand-name">CertiFlow<span className="brand-sub">Pragati Skills Mission</span></span>
        </div>
        <div>
          <h1>Certificates anyone can check. Decisions that stay on record.</h1>
          <p>Training centres upload a passed batch. Officers approve it. Each candidate gets the certificate on WhatsApp.</p>
        </div>
        <div className="sample-cert" aria-hidden="true">
          <small>Example certificate</small>
          <div className="t">Certificate of completion</div>
          <div className="holder">Asha Rao</div>
          <small>Electrician, North district</small>
          <div className="no">PRG-2026-K7MQ4-R9XTD</div>
          <Seal valid className="mini-seal" />
        </div>
      </section>

      <section className="login-form">
        <div className="login-box">
          <h2>Sign in</h2>
          <p className="lead">{showDemo ? 'Pick a demo account, or enter your own details.' : 'Enter your email and password.'}</p>

          {loadingUsers && (
            <div className="who-grid" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="who skeleton"><span className="avatar" /><span><b>&nbsp;</b><small>&nbsp;</small></span></div>
              ))}
            </div>
          )}
          {!loadingUsers && users.length > 0 && (
            <div className="who-grid" role="group" aria-label="Demo accounts">
              {users.map((u) => (
                <button key={u.email} type="button" className="who" aria-pressed={email === u.email} onClick={() => { setEmail(u.email); setPassword('password123'); }}>
                  <Avatar name={u.name} role={u.role} />
                  <span>
                    <b>{u.name}</b>
                    <small>{ROLE_LABEL[u.role]}{u.district ? `, ${u.district}` : ''}</small>
                  </span>
                </button>
              ))}
            </div>
          )}

          {showDemo && <div className="login-or">or type your details</div>}
          <form onSubmit={submit}>
            <label className="field">
              <span>Email</span>
              <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="field">
              <span>Password</span>
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {error && <Notice tone="bad">{error}</Notice>}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy || !email}>{busy ? 'Signing in' : 'Sign in'}</button>
          </form>
          {showDemo && <p className="login-foot muted">Demo password for every account: <code>password123</code></p>}
          <p className="login-foot">Employer or candidate? <Link to="/verify">Check a certificate</Link> without signing in.</p>
        </div>
      </section>
    </div>
  );
}

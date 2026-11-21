import { useEffect, useState } from 'react';
import { api, setToken, type User } from '../api';

type DemoUser = { name: string; email: string; role: string; district: string | null };

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ users: DemoUser[] }>('/auth/demo-users')
      .then((r) => {
        setUsers(r.users);
        setEmail(r.users[0]?.email ?? '');
      })
      .catch(() => undefined); // demo list is optional
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ token: string; user: User }>('/auth/login', { body: { email, password } });
      setToken(r.token);
      onLogin(r.user);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form className="card narrow" onSubmit={submit}>
      <h2>Log in</h2>
      {users.length > 0 && (
        <label>
          Demo user
          <select value={email} onChange={(e) => setEmail(e.target.value)}>
            {users.map((u) => (
              <option key={u.email} value={u.email}>
                {u.name}: {u.role.replace('_', ' ').toLowerCase()}{u.district ? ` (${u.district})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit">Log in</button>
      <p className="muted">Demo password for everyone: <code>password123</code></p>
    </form>
  );
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type User } from '../api';
import { usePolling } from '../hooks';
import { StatusBadge } from '../components';

type Batch = {
  id: string; name: string; status: string; stage: string | null; version: number; district: string;
  escalatedAt: string | null; centre: { name: string }; _count: { candidates: number }; updatedAt: string;
};

// A batch is "waiting for me" when it is at the stage my role handles.
const myStage = { DISTRICT_OFFICER: 'DISTRICT', QUALITY: 'QUALITY', STATE: 'STATE', CENTRE: null } as const;

export default function Dashboard({ user }: { user: User }) {
  const { data, error, reload } = usePolling<{ batches: Batch[] }>('/batches');
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');
  const navigate = useNavigate();

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ batch: Batch }>('/batches', { body: { name } });
      navigate(`/batches/${r.batch.id}`);
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  const batches = data?.batches ?? [];
  const waiting = batches.filter((b) => b.status === 'IN_REVIEW' && b.stage === myStage[user.role]);

  return (
    <>
      <h2>{user.role === 'CENTRE' ? 'My batches' : 'Batches'}</h2>
      {error && <p className="error">{error}</p>}

      {user.role === 'CENTRE' && (
        <form className="card inline" onSubmit={create}>
          <input placeholder="New batch name, e.g. Electrician May 2025" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit">Create batch</button>
          {formError && <span className="error">{formError}</span>}
        </form>
      )}

      {user.role !== 'CENTRE' && (
        <p className="banner">Waiting for you: <b>{waiting.length}</b> batch(es)</p>
      )}

      <table>
        <thead>
          <tr><th>Batch</th><th>Centre</th><th>District</th><th>Candidates</th><th>Version</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id} className={waiting.includes(b) ? 'highlight' : ''}>
              <td><Link to={`/batches/${b.id}`}>{b.name}</Link></td>
              <td>{b.centre.name}</td>
              <td>{b.district}</td>
              <td>{b._count.candidates}</td>
              <td>v{b.version}</td>
              <td><StatusBadge status={b.status} stage={b.stage} escalated={!!b.escalatedAt} /></td>
              <td>{waiting.includes(b) && <b>Your turn</b>}</td>
            </tr>
          ))}
          {batches.length === 0 && <tr><td colSpan={7} className="muted">No batches yet.</td></tr>}
        </tbody>
      </table>
      <button className="link" onClick={reload}>Refresh now</button>
      <span className="muted"> (updates automatically every few seconds)</span>
    </>
  );
}

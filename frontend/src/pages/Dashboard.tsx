import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type User } from '../api';
import { usePolling } from '../hooks';
import { BatchChip, Empty, MiniTrack, Notice } from '../components';
import { timeAgo } from '../format';

type Batch = {
  id: string; name: string; status: string; stage: string | null; version: number; district: string; requiresQuality: boolean;
  escalatedAt: string | null; centre: { name: string }; _count: { candidates: number }; updatedAt: string;
};

// A batch is "waiting for me" when it is at the step my role handles.
const myStage = { DISTRICT_OFFICER: 'DISTRICT', QUALITY: 'QUALITY', STATE: 'STATE', CENTRE: null } as const;

function Row({ b, mine }: { b: Batch; mine: boolean }) {
  return (
    <Link to={`/batches/${b.id}`} className={`row-item ${mine ? 'mine' : ''}`}>
      <div className="row-title">
        <b>{b.name}</b>
        <small>{b.centre.name}, {b.district} district{b.version > 1 ? `, version ${b.version}` : ''}</small>
      </div>
      <div className="row-count num">{b._count.candidates} people</div>
      <MiniTrack batch={b} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <BatchChip status={b.status} stage={b.stage} escalated={!!b.escalatedAt} />
      </div>
      <div className="row-end">{mine ? <b style={{ color: 'var(--green)' }}>Your turn</b> : timeAgo(b.updatedAt)}</div>
    </Link>
  );
}

function List({ batches, mineIds }: { batches: Batch[]; mineIds: Set<string> }) {
  return (
    <div className="rows">
      <div className="rows-head" aria-hidden="true">
        <span>Batch</span><span>People</span><span>Progress</span><span>Status</span><span style={{ textAlign: 'right' }}>Updated</span>
      </div>
      {batches.map((b) => <Row key={b.id} b={b} mine={mineIds.has(b.id)} />)}
    </div>
  );
}

export default function Dashboard({ user }: { user: User }) {
  const { data, error, reload } = usePolling<{ batches: Batch[] }>('/batches');
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');
  const navigate = useNavigate();

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    try {
      const r = await api<{ batch: Batch }>('/batches', { body: { name } });
      navigate(`/batches/${r.batch.id}`);
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  const batches = data?.batches ?? [];
  const isCentre = user.role === 'CENTRE';
  const mine = batches.filter((b) => b.status === 'IN_REVIEW' && b.stage === myStage[user.role]);
  const mineIds = new Set(mine.map((b) => b.id));
  const others = batches.filter((b) => !mineIds.has(b.id));
  const count = (f: (b: Batch) => boolean) => batches.filter(f).length;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{isCentre ? 'Your batches' : 'Batches'}</h1>
          <p>
            {isCentre
              ? 'Create a batch, upload the passed candidates, and follow it until every certificate is delivered.'
              : mine.length > 0
                ? `${mine.length} batch${mine.length > 1 ? 'es are' : ' is'} waiting for your decision.`
                : 'Nothing is waiting for your decision right now.'}
          </p>
        </div>
        {isCentre && (
          <form onSubmit={create} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="sr-only" htmlFor="batch-name">Batch name</label>
            <input id="batch-name" className="input" style={{ width: 280 }} placeholder="Batch name, for example Electrician May" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary" type="submit" disabled={name.trim().length < 3}>Create batch</button>
          </form>
        )}
      </header>

      {formError && <div style={{ marginBottom: 16 }}><Notice tone="bad">{formError}</Notice></div>}
      {error && <div style={{ marginBottom: 16 }}><Notice tone="bad">{error}</Notice></div>}

      <section className="strip" aria-label="Summary">
        <div className={mine.length ? 'hot' : ''}><b>{!data ? '-' : isCentre ? count((b) => b.status === 'DRAFT') : mine.length}</b><span>{isCentre ? 'Drafts' : 'Waiting for you'}</span></div>
        <div><b>{!data ? '-' : count((b) => b.status === 'IN_REVIEW')}</b><span>In review</span></div>
        <div className={count((b) => b.status === 'SENT_BACK') ? 'warn' : ''}><b>{!data ? '-' : count((b) => b.status === 'SENT_BACK')}</b><span>Sent back</span></div>
        <div><b>{!data ? '-' : count((b) => b.status === 'APPROVED')}</b><span>Approved</span></div>
      </section>

      {!data && !error && (
        <div className="rows" aria-busy="true" aria-label="Loading batches">
          {[0, 1, 2].map((i) => (
            <div key={i} className="row-item skeleton"><span className="bar" /><span className="bar" /><span className="bar" /><span className="bar" /><span className="bar" /></div>
          ))}
        </div>
      )}

      {data && batches.length === 0 && (
        <div className="panel">
          {isCentre ? (
            <Empty icon="batches" title="No batches yet">Name a batch above, then upload your Excel sheet with Name, Phone, Course and Score.</Empty>
          ) : (
            <Empty icon="inbox" title="No batches to show yet">Batches appear here once a training centre sends them for approval.</Empty>
          )}
        </div>
      )}

      {mine.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ font: '600 18px var(--font-ui)', marginBottom: 10 }}>Waiting for you</h2>
          <List batches={mine} mineIds={mineIds} />
        </section>
      )}

      {others.length > 0 && (
        <section>
          {mine.length > 0 && <h2 style={{ font: '600 18px var(--font-ui)', marginBottom: 10 }}>All other batches</h2>}
          <List batches={others} mineIds={mineIds} />
        </section>
      )}

      {data && batches.length > 0 && (
        <p className="muted" style={{ marginTop: 14, fontSize: 13.5 }}>
          This page refreshes by itself every few seconds. <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>Refresh now</button>
        </p>
      )}
    </>
  );
}

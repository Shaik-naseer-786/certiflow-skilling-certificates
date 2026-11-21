import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { usePolling } from '../hooks';
import { Avatar, Empty, Icon, Notice } from '../components';
import { actionText, dateTime, metaText, STAGE_LABEL, timeAgo } from '../format';

type Stuck = { batches: { id: string; name: string; stage: string; district: string; stageEnteredAt: string; centre: { name: string }; _count: { candidates: number } }[] };
type Messages = { messages: { id: string; phone: string; body: string; createdAt: string }[] };
type Logs = { logs: { id: string; actorName: string; action: string; entity: string; entityId: string; createdAt: string; meta: unknown }[] };

const TABS = [
  { key: 'stuck', label: 'Stuck batches', title: 'Stuck batches', sub: 'Batches that waited too long with the same reviewers. They are flagged once, so someone senior can step in.' },
  { key: 'audit', label: 'Audit log', title: 'Audit log', sub: 'Every action by every person and by the system, with the time it happened.' },
  { key: 'messages', label: 'WhatsApp inbox', title: 'WhatsApp inbox', sub: 'What candidates received. This is the stand-in for the real WhatsApp provider.' },
] as const;

function StuckTab() {
  const { data } = usePolling<Stuck>('/state/stuck');
  if (!data) return <p className="muted">Loading</p>;
  if (data.batches.length === 0) return <div className="panel"><Empty icon="check" title="Nothing is stuck">Every batch is moving. Batches that wait too long appear here.</Empty></div>;
  return (
    <div className="rows">
      {data.batches.map((b) => (
        <Link key={b.id} to={`/batches/${b.id}`} className="row-item" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1.4fr) 140px' }}>
          <div className="row-title"><b>{b.name}</b><small>{b.centre.name}, {b.district} district, {b._count.candidates} people</small></div>
          <div>Waiting with <b>{STAGE_LABEL[b.stage]?.toLowerCase()}</b></div>
          <div className="row-end">since {timeAgo(b.stageEnteredAt)}</div>
        </Link>
      ))}
    </div>
  );
}

function AuditTab() {
  const { data } = usePolling<Logs>('/state/audit', 6000);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'Batch' | 'Certificate'>('all');

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.logs ?? []).filter((l) => {
      if (kind !== 'all' && l.entity !== kind) return false;
      if (!term) return true;
      return `${l.actorName} ${actionText(l.action)} ${l.action} ${metaText(l.meta)}`.toLowerCase().includes(term);
    });
  }, [data, q, kind]);

  return (
    <section className="panel">
      <div className="toolbar">
        <label className="sr-only" htmlFor="audit-search">Search the audit log</label>
        <input id="audit-search" className="input" placeholder="Search by person or action" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="Show">
          {(['all', 'Batch', 'Certificate'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'all' ? 'Everything' : k === 'Batch' ? 'Batches' : 'Certificates'}</button>
          ))}
        </div>
        <span className="access-note" style={{ marginLeft: 'auto' }}><Icon name="lock" />Only the state office can see this</span>
      </div>
      {!data ? (
        <p className="muted" style={{ padding: 20 }}>Loading</p>
      ) : rows.length === 0 ? (
        <Empty icon="log" title="No matching entries">Try a different search, or show everything.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>When</th><th>Who</th><th>What happened</th><th>Item</th></tr></thead>
            <tbody>
              {rows.map((l) => {
                const m = (l.meta ?? {}) as { certNo?: string };
                return (
                  <tr key={l.id}>
                    <td className="num" title={new Date(l.createdAt).toLocaleString()}>{dateTime(l.createdAt)}</td>
                    <td><div className="who-cell"><Avatar name={l.actorName} small /><span>{l.actorName === 'system' ? 'System' : l.actorName}</span></div></td>
                    <td className="what"><b title={l.action}>{actionText(l.action)}</b>{metaText(l.meta) && <small>{metaText(l.meta)}</small>}</td>
                    <td>
                      {l.entity === 'Batch' && <Link to={`/batches/${l.entityId}`}>Open batch</Link>}
                      {l.entity === 'Certificate' && (m.certNo ? <Link className="certno" to={`/verify/${m.certNo}`}>{m.certNo}</Link> : <span className="muted">Certificate</span>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Turns links inside a message into clickable links.
function Linkify({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/\S+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

function MessagesTab() {
  const { data } = usePolling<Messages>('/state/whatsapp-messages');
  if (!data) return <p className="muted">Loading</p>;
  if (data.messages.length === 0) return <div className="panel"><Empty icon="chat" title="No messages yet">Messages appear here as soon as certificates are sent.</Empty></div>;
  return (
    <section className="panel" style={{ overflow: 'hidden' }}>
      <div className="chat">
        {data.messages.map((m) => (
          <article key={m.id} className="bubble">
            <header><b>{m.phone}</b><span>{dateTime(m.createdAt)}</span></header>
            <p><Linkify text={m.body} /></p>
          </article>
        ))}
      </div>
    </section>
  );
}

// State office extras: stuck batches, the audit log and the fake "phone" inbox.
export default function StateTools() {
  const { tab } = useParams();
  const current = TABS.find((t) => t.key === tab);
  if (!current) return <Navigate to="/state/stuck" replace />;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{current.title}</h1>
          <p>{current.sub}</p>
        </div>
      </header>
      <nav className="tabs" aria-label="State office pages">
        {TABS.map((t) => (
          <Link key={t.key} to={`/state/${t.key}`} aria-current={t.key === current.key ? 'page' : undefined}>{t.label}</Link>
        ))}
      </nav>
      {current.key === 'stuck' && <StuckTab />}
      {current.key === 'audit' && <AuditTab />}
      {current.key === 'messages' && <MessagesTab />}
      {current.key === 'audit' && <div style={{ marginTop: 16 }}><Notice>Showing the latest 200 entries, newest first.</Notice></div>}
    </>
  );
}

import { Link } from 'react-router-dom';
import { usePolling } from '../hooks';

type Stuck = { batches: { id: string; name: string; stage: string; district: string; stageEnteredAt: string; centre: { name: string } }[] };
type Messages = { messages: { id: string; phone: string; body: string; createdAt: string }[] };
type Logs = { logs: { id: string; actorName: string; action: string; entity: string; entityId: string; createdAt: string; meta: unknown }[] };

// State office extras: stuck batches, the fake "phone" inbox, and the recent audit trail.
export default function StateTools() {
  const stuck = usePolling<Stuck>('/state/stuck');
  const messages = usePolling<Messages>('/state/whatsapp-messages');
  const logs = usePolling<Logs>('/state/audit');

  return (
    <>
      <h2>Stuck batches (escalated)</h2>
      <table>
        <thead><tr><th>Batch</th><th>Centre</th><th>District</th><th>Waiting at</th><th>Since</th></tr></thead>
        <tbody>
          {stuck.data?.batches.map((b) => (
            <tr key={b.id}>
              <td><Link to={`/batches/${b.id}`}>{b.name}</Link></td><td>{b.centre.name}</td><td>{b.district}</td>
              <td>{b.stage.toLowerCase()}</td><td>{new Date(b.stageEnteredAt).toLocaleString()}</td>
            </tr>
          ))}
          {stuck.data?.batches.length === 0 && <tr><td colSpan={5} className="muted">Nothing is stuck.</td></tr>}
        </tbody>
      </table>

      <h2>Fake WhatsApp inbox (what candidates received)</h2>
      <table>
        <thead><tr><th>When</th><th>Phone</th><th>Message</th></tr></thead>
        <tbody>
          {messages.data?.messages.map((m) => (
            <tr key={m.id}><td>{new Date(m.createdAt).toLocaleTimeString()}</td><td>{m.phone}</td><td className="pre">{m.body}</td></tr>
          ))}
          {messages.data?.messages.length === 0 && <tr><td colSpan={3} className="muted">No messages yet.</td></tr>}
        </tbody>
      </table>

      <h2>Audit log (latest 200)</h2>
      <table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th></tr></thead>
        <tbody>
          {logs.data?.logs.map((l) => (
            <tr key={l.id}>
              <td>{new Date(l.createdAt).toLocaleString()}</td><td>{l.actorName}</td><td>{l.action}</td>
              <td>{l.entity === 'Batch' ? <Link to={`/batches/${l.entityId}`}>Batch</Link> : 'Certificate'} {l.entityId.slice(0, 8)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

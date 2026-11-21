import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, openPdf, type User } from '../api';
import { usePolling } from '../hooks';
import { StatusBadge } from '../components';

type Detail = {
  batch: {
    id: string; name: string; status: string; stage: string | null; version: number; district: string;
    requiresQuality: boolean; lastReason: string | null; escalatedAt: string | null; centre: { name: string };
    candidates: { id: string; rowNumber: number; name: string; phone: string; course: string; score: number }[];
    approvals: { id: string; version: number; stage: string; decision: string; reason: string | null; createdAt: string; officer: { name: string } }[];
    versions: { version: number; submittedAt: string }[];
  };
  certificates: { id: string; certNo: string; status: string; deliveryStatus: string; deliveryAttempts: number; lastError: string | null; candidate: { name: string } }[];
};

const stageRole = { DISTRICT: 'DISTRICT_OFFICER', QUALITY: 'QUALITY', STATE: 'STATE' } as const;

export default function BatchDetail({ user }: { user: User }) {
  const { id } = useParams();
  const { data, error, reload } = usePolling<Detail>(`/batches/${id}`);
  const [msg, setMsg] = useState('');
  const [rowErrors, setRowErrors] = useState<{ row: number; field: string; message: string }[]>([]);
  const [reason, setReason] = useState('');

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading...</p>;
  const { batch, certificates } = data;

  // Runs an action, shows errors, refreshes the page data.
  const run = async (fn: () => Promise<unknown>, ok = '') => {
    setMsg('');
    setRowErrors([]);
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      if (e instanceof ApiError && e.body?.errors?.length) setRowErrors(e.body.errors);
      setMsg((e as Error).message);
    }
    reload();
  };

  const upload = (file: File) => {
    const form = new FormData();
    form.append('file', file);
    run(() => api(`/batches/${batch.id}/upload`, { form }), 'Spreadsheet saved.');
  };

  const decide = (decision: string) => {
    run(() => api(`/batches/${batch.id}/decision`, { body: { decision, reason } }), 'Decision recorded.');
    setReason('');
  };

  const isCentre = user.role === 'CENTRE';
  const editable = isCentre && (batch.status === 'DRAFT' || batch.status === 'SENT_BACK');
  const myTurn = batch.status === 'IN_REVIEW' && batch.stage && stageRole[batch.stage as keyof typeof stageRole] === user.role;
  const alreadyDecided = batch.approvals.some((a) => a.officer.name === user.name && a.version === batch.version && a.stage === batch.stage);
  const approvalsThisStage = batch.approvals.filter((a) => a.version === batch.version && a.stage === batch.stage && a.decision === 'APPROVE').length;

  return (
    <>
      <p><Link to="/">&larr; All batches</Link></p>
      <h2>{batch.name} <StatusBadge status={batch.status} stage={batch.stage} escalated={!!batch.escalatedAt} /></h2>
      <p className="muted">
        {batch.centre.name} · {batch.district} district · version {batch.version} · {batch.candidates.length} candidates
        {batch.requiresQuality && ' · large batch: quality team review needed'}
      </p>
      {batch.status === 'IN_REVIEW' && batch.stage === 'DISTRICT' && (
        <p className="muted">District step: {approvalsThisStage} of 2 officer approvals so far.</p>
      )}
      {batch.lastReason && <p className="banner warn">Last decision reason: {batch.lastReason}</p>}
      {msg && <p className={rowErrors.length || /not|wrong|cannot|required|Invalid/i.test(msg) ? 'error' : 'ok'}>{msg}</p>}

      {editable && (
        <div className="card">
          <h3>1. Upload candidates (.xlsx)</h3>
          <p className="muted">Columns: <code>Name, Phone, Course, Score</code>. Uploading again replaces the list.</p>
          <input type="file" accept=".xlsx" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          {rowErrors.length > 0 && (
            <table className="errors">
              <thead><tr><th>Row</th><th>Column</th><th>Problem</th></tr></thead>
              <tbody>{rowErrors.map((e, i) => <tr key={i}><td>{e.row}</td><td>{e.field}</td><td>{e.message}</td></tr>)}</tbody>
            </table>
          )}
          <h3>2. Send for approval</h3>
          <button disabled={batch.candidates.length === 0} onClick={() => run(() => api(`/batches/${batch.id}/submit`, { method: 'POST' }), 'Sent for approval.')}>
            {batch.status === 'SENT_BACK' ? 'Fix done: resubmit' : 'Send for approval'}
          </button>
        </div>
      )}

      {myTurn && !alreadyDecided && (
        <div className="card">
          <h3>Your decision ({batch.stage?.toLowerCase()} step)</h3>
          <input placeholder="Reason (required to reject or send back)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="row">
            <button onClick={() => decide('APPROVE')}>Approve</button>
            <button className="warn" onClick={() => decide('SEND_BACK')}>Send back</button>
            <button className="danger" onClick={() => decide('REJECT')}>Reject</button>
          </div>
        </div>
      )}
      {myTurn && alreadyDecided && <p className="banner">You already decided on this version. Waiting for the others.</p>}

      {certificates.length > 0 && (
        <>
          <h3>Certificates ({certificates.filter((c) => c.deliveryStatus === 'SENT').length}/{certificates.length} delivered)</h3>
          <table>
            <thead><tr><th>Number</th><th>Candidate</th><th>Status</th><th>WhatsApp</th><th>PDF</th>{user.role === 'STATE' && <th></th>}</tr></thead>
            <tbody>
              {certificates.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/verify/${c.certNo}`}>{c.certNo}</Link></td>
                  <td>{c.candidate.name}</td>
                  <td><span className={`badge ${c.status}`}>{c.status.toLowerCase()}</span></td>
                  <td>
                    <span className={`badge DELIVERY_${c.deliveryStatus}`}>{c.deliveryStatus.toLowerCase()}</span>
                    {c.deliveryAttempts > 1 && <span className="muted"> {c.deliveryAttempts} attempts</span>}
                    {c.lastError && c.deliveryStatus !== 'SENT' && <span className="muted"> ({c.lastError})</span>}
                  </td>
                  <td>{c.status === 'ISSUED' && <button className="small" onClick={() => run(() => openPdf('/batches/certificates/'+c.id+'/pdf'))}>Open PDF</button>}</td>
                  {user.role === 'STATE' && (
                    <td>
                      {c.status === 'ISSUED' && (
                        <button className="danger small" onClick={() => {
                          const why = window.prompt('Reason for cancelling this certificate?');
                          if (why) run(() => api(`/state/certificates/${c.id}/cancel`, { body: { reason: why } }), 'Certificate cancelled.');
                        }}>Cancel</button>
                      )}
                      {c.deliveryStatus === 'FAILED' && (
                        <button className="small" onClick={() => run(() => api(`/state/certificates/${c.id}/retry-delivery`, { method: 'POST' }), 'Retry queued.')}>Retry</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>Approval history</h3>
      <table>
        <thead><tr><th>When</th><th>Version</th><th>Step</th><th>Who</th><th>Decision</th><th>Reason</th></tr></thead>
        <tbody>
          {batch.approvals.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.createdAt).toLocaleString()}</td><td>v{a.version}</td><td>{a.stage.toLowerCase()}</td>
              <td>{a.officer.name}</td><td>{a.decision.replace('_', ' ').toLowerCase()}</td><td>{a.reason}</td>
            </tr>
          ))}
          {batch.approvals.length === 0 && <tr><td colSpan={6} className="muted">No decisions yet.</td></tr>}
        </tbody>
      </table>

      <h3>Candidates</h3>
      <table>
        <thead><tr><th>Row</th><th>Name</th><th>Phone</th><th>Course</th><th>Score</th></tr></thead>
        <tbody>
          {batch.candidates.map((c) => (
            <tr key={c.id}><td>{c.rowNumber}</td><td>{c.name}</td><td>{c.phone}</td><td>{c.course}</td><td>{c.score}</td></tr>
          ))}
          {batch.candidates.length === 0 && <tr><td colSpan={5} className="muted">No candidates uploaded yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

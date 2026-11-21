import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, openPdf, type User } from '../api';
import { usePolling } from '../hooks';
import { Avatar, BatchChip, CertChip, DeliveryChip, Empty, Icon, Modal, Notice, StageTrack } from '../components';
import { STAGE_LABEL, timeAgo } from '../format';

type Cert = { id: string; certNo: string; status: string; deliveryStatus: string; deliveryAttempts: number; lastError: string | null; candidate: { name: string } };
type Detail = {
  batch: {
    id: string; name: string; status: string; stage: string | null; version: number; district: string;
    requiresQuality: boolean; lastReason: string | null; escalatedAt: string | null; centre: { name: string };
    candidates: { id: string; rowNumber: number; name: string; phone: string; course: string; score: number }[];
    approvals: { id: string; version: number; stage: string; decision: string; reason: string | null; createdAt: string; officer: { name: string } }[];
    versions: { version: number; submittedAt: string }[];
  };
  certificates: Cert[];
};

const stageRole = { DISTRICT: 'DISTRICT_OFFICER', QUALITY: 'QUALITY', STATE: 'STATE' } as const;
const VERB: Record<string, string> = { APPROVE: 'approved', REJECT: 'rejected', SEND_BACK: 'sent it back' };

export default function BatchDetail({ user }: { user: User }) {
  const { id } = useParams();
  const { data, error, reload } = usePolling<Detail>(`/batches/${id}`);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [rowErrors, setRowErrors] = useState<{ row: number; field: string; message: string }[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [cancelling, setCancelling] = useState<Cert | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  if (error && !data) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <p className="muted">Loading batch</p>;
  const { batch, certificates } = data;

  // Runs an action, shows the result, refreshes the page data.
  const run = async (fn: () => Promise<unknown>, ok = '') => {
    setMsg(null);
    setRowErrors([]);
    setBusy(true);
    try {
      await fn();
      if (ok) setMsg({ tone: 'good', text: ok });
    } catch (e) {
      if (e instanceof ApiError && e.body?.errors?.length) setRowErrors(e.body.errors);
      setMsg({ tone: 'bad', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
    reload();
  };

  const upload = (file: File) => {
    const form = new FormData();
    form.append('file', file);
    run(() => api(`/batches/${batch.id}/upload`, { form }), 'Spreadsheet saved. Check the list, then send it for approval.');
  };

  const decide = (decision: string) => {
    run(() => api(`/batches/${batch.id}/decision`, { body: { decision, reason } }), 'Decision recorded.');
    setReason('');
  };

  const confirmCancel = () => {
    if (!cancelling) return;
    const c = cancelling;
    setCancelling(null);
    run(() => api(`/state/certificates/${c.id}/cancel`, { body: { reason: cancelReason } }), 'Certificate cancelled. It now shows as not valid.');
    setCancelReason('');
  };

  const isCentre = user.role === 'CENTRE';
  const isState = user.role === 'STATE';
  const editable = isCentre && (batch.status === 'DRAFT' || batch.status === 'SENT_BACK');
  const myTurn = batch.status === 'IN_REVIEW' && !!batch.stage && stageRole[batch.stage as keyof typeof stageRole] === user.role;
  const alreadyDecided = batch.approvals.some((a) => a.officer.name === user.name && a.version === batch.version && a.stage === batch.stage);
  const districtApprovals = batch.approvals.filter((a) => a.version === batch.version && a.stage === 'DISTRICT' && a.decision === 'APPROVE').length;
  const delivered = certificates.filter((c) => c.deliveryStatus === 'SENT').length;

  return (
    <>
      <Link to="/" className="crumb"><Icon name="back" />All batches</Link>
      <header className="page-head">
        <div>
          <div className="title-row">
            <h1>{batch.name}</h1>
            <BatchChip status={batch.status} stage={batch.stage} escalated={!!batch.escalatedAt} />
          </div>
          <p>{batch.centre.name}, {batch.district} district</p>
        </div>
      </header>

      <div className="detail">
        <div className="stack">
          {rowErrors.length > 0 && (
            <section className="panel" aria-label="Spreadsheet problems">
              <div className="panel-head">
                <h2>{rowErrors.length} problem{rowErrors.length > 1 ? 's' : ''} in your spreadsheet</h2>
                <span className="muted">Nothing was saved. Fix these rows and upload again.</span>
              </div>
              <div className="tablewrap">
                <table className="data errtable">
                  <thead><tr><th>Row</th><th>Column</th><th>Problem</th></tr></thead>
                  <tbody>{rowErrors.map((e, i) => <tr key={i}><td className="num">{e.row}</td><td>{e.field}</td><td>{e.message}</td></tr>)}</tbody>
                </table>
              </div>
            </section>
          )}

          <section className="panel" aria-label="Progress">
            <div className="panel-head"><h2>Progress</h2><span className="muted">Version {batch.version}</span></div>
            <StageTrack batch={batch} districtApprovals={districtApprovals} delivered={delivered} total={certificates.length} />
            {(batch.status === 'DRAFT' || batch.status === 'SENT_BACK' || batch.status === 'REJECTED' || batch.lastReason) && (
              <div style={{ padding: '0 20px 20px' }}>
                {batch.status === 'DRAFT' && <Notice>Not submitted yet. Upload the candidates, then send the batch for approval.</Notice>}
                {batch.status === 'SENT_BACK' && <Notice tone="warn"><b>Sent back to the centre.</b> {batch.lastReason ?? ''} Fix the list and send it again. It restarts at the district step.</Notice>}
                {batch.status === 'REJECTED' && <Notice tone="bad"><b>Rejected.</b> {batch.lastReason ?? ''} This batch cannot be changed.</Notice>}
              </div>
            )}
          </section>

          {certificates.length > 0 && (
            <section className="panel" aria-label="Certificates">
              <div className="panel-head"><h2>Certificates</h2><span className="muted">{certificates.length} people</span></div>
              <div className="deliver-sum">
                <b>{delivered} of {certificates.length} delivered on WhatsApp</b>
                <div className="progress" role="progressbar" aria-valuenow={delivered} aria-valuemin={0} aria-valuemax={certificates.length}><i style={{ width: `${(delivered / certificates.length) * 100}%` }} /></div>
              </div>
              <div className="tablewrap">
                <table className="data">
                  <thead><tr><th>Certificate</th><th>Candidate</th><th>Status</th><th>WhatsApp</th><th /></tr></thead>
                  <tbody>
                    {certificates.map((c) => (
                      <tr key={c.id}>
                        <td><Link className="certno" to={`/verify/${c.certNo}`}>{c.certNo}</Link></td>
                        <td>{c.candidate.name}</td>
                        <td><CertChip status={c.status} /></td>
                        <td>
                          <DeliveryChip status={c.deliveryStatus} />
                          {c.deliveryAttempts > 1 && <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{c.deliveryAttempts} tries{c.lastError && c.deliveryStatus !== 'SENT' ? `, ${c.lastError}` : ''}</div>}
                        </td>
                        <td>
                          <div className="cell-actions">
                            {c.status === 'ISSUED' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => run(() => openPdf(`/batches/certificates/${c.id}/pdf`))}><Icon name="file" />PDF</button>}
                            {isState && c.deliveryStatus === 'FAILED' && c.status === 'ISSUED' && (
                              <button type="button" className="btn btn-warn btn-sm" onClick={() => run(() => api(`/state/certificates/${c.id}/retry-delivery`, { method: 'POST' }), 'Retry queued.')}><Icon name="refresh" />Retry</button>
                            )}
                            {isState && c.status === 'ISSUED' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setCancelReason(''); setCancelling(c); }}>Cancel</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="panel" aria-label="Candidates">
            <div className="panel-head"><h2>Candidates</h2><span className="muted">{batch.candidates.length} people</span></div>
            {batch.candidates.length === 0 ? (
              <Empty icon="upload" title="No candidates yet">{isCentre ? 'Upload an Excel sheet from the panel on the right.' : 'The centre has not uploaded a list.'}</Empty>
            ) : (
              <div className="tablewrap" style={{ maxHeight: 440, overflowY: 'auto' }}>
                <table className="data">
                  <thead><tr><th>Row</th><th>Name</th><th>Phone</th><th>Course</th><th>Score</th></tr></thead>
                  <tbody>{batch.candidates.map((c) => <tr key={c.id}><td className="num">{c.rowNumber}</td><td>{c.name}</td><td className="num">{c.phone}</td><td>{c.course}</td><td className="num">{c.score}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="rail">
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

          {editable && (
            <section className="panel">
              <div className="panel-head"><h2>Candidates and approval</h2></div>
              <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
                <label
                  className={`dropzone ${over ? 'over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) upload(f); }}
                >
                  <Icon name="upload" />
                  <b>{busy ? 'Working' : 'Choose an Excel file or drop it here'}</b>
                  <small>.xlsx with the columns Name, Phone, Course, Score. A new upload replaces the list.</small>
                  <input type="file" accept=".xlsx" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
                </label>
                <button
                  type="button" className="btn btn-primary btn-block"
                  disabled={busy || batch.candidates.length === 0}
                  onClick={() => run(() => api(`/batches/${batch.id}/submit`, { method: 'POST' }), 'Sent for approval.')}
                >
                  {batch.status === 'SENT_BACK' ? 'Send again for approval' : 'Send for approval'}
                </button>
                {batch.candidates.length === 0 && <small className="muted">Upload a list to enable this button.</small>}
              </div>
            </section>
          )}

          {myTurn && !alreadyDecided && (
            <section className="panel">
              <div className="panel-head"><h2>Your decision</h2></div>
              <div className="panel-body">
                <p className="muted" style={{ marginBottom: 12 }}>You are reviewing as {STAGE_LABEL[batch.stage ?? '']?.toLowerCase()}.</p>
                <label className="field">
                  <span>Reason</span>
                  <textarea className="textarea" placeholder="Needed to send back or reject. Optional when approving." value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <div className="decision-actions">
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide('APPROVE')}><Icon name="check" />Approve</button>
                  <button type="button" className="btn btn-warn" disabled={busy || !reason.trim()} onClick={() => decide('SEND_BACK')}>Send back to the centre</button>
                  <button type="button" className="btn btn-danger" disabled={busy || !reason.trim()} onClick={() => decide('REJECT')}>Reject for good</button>
                </div>
              </div>
            </section>
          )}
          {myTurn && alreadyDecided && <Notice tone="good">You already decided on this version. Waiting for the other reviewers.</Notice>}
          {!editable && !myTurn && batch.status === 'IN_REVIEW' && (
            <Notice>With {STAGE_LABEL[batch.stage ?? '']?.toLowerCase()}. There is nothing for you to do on this batch.</Notice>
          )}
          {batch.status === 'APPROVED' && <Notice tone="good">Approved. Certificates are created and sent on WhatsApp in the background.</Notice>}

          <section className="panel">
            <div className="panel-head"><h2>Details</h2></div>
            <div className="panel-body">
              <dl className="facts">
                <div><dt>Training centre</dt><dd>{batch.centre.name}</dd></div>
                <div><dt>District</dt><dd>{batch.district}</dd></div>
                <div><dt>Candidates</dt><dd className="num">{batch.candidates.length}</dd></div>
                <div><dt>Quality review</dt><dd>{batch.requiresQuality ? 'Required' : 'Not needed'}</dd></div>
              </dl>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Decisions</h2></div>
            <div className="panel-body">
              {batch.approvals.length === 0 ? (
                <p className="muted">No decisions yet.</p>
              ) : (
                <ul className="timeline">
                  {[...batch.approvals].reverse().map((a) => (
                    <li key={a.id}>
                      <Avatar name={a.officer.name} role={stageRole[a.stage as keyof typeof stageRole]} />
                      <div>
                        <b>{a.officer.name}</b> {VERB[a.decision] ?? a.decision.toLowerCase()}
                        <small>{STAGE_LABEL[a.stage] ?? a.stage}, version {a.version}, {timeAgo(a.createdAt)}</small>
                        {a.reason && <blockquote>{a.reason}</blockquote>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>
      </div>

      {cancelling && (
        <Modal title="Cancel this certificate?" onClose={() => setCancelling(null)}>
          <p><b>{cancelling.candidate.name}</b>, <span className="certno">{cancelling.certNo}</span>. Anyone who checks it will see that it is no longer valid.</p>
          <label className="field">
            <span>Reason (shown to anyone who checks it)</span>
            <textarea className="textarea" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="For example: issued by mistake" />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setCancelling(null)}>Keep certificate</button>
            <button type="button" className="btn btn-danger" disabled={cancelReason.trim().length < 3} onClick={confirmCancel}>Cancel certificate</button>
          </div>
        </Modal>
      )}
    </>
  );
}

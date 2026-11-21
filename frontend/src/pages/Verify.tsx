import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Empty, Icon, Notice, Seal } from '../components';

type Result = {
  valid: boolean; status: string; certNo: string; holder: string; course: string; district: string;
  issuedAt: string; cancelledAt?: string; cancelReason?: string;
};

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

// Public page: no login. This is also what the QR code on the certificate opens.
export default function Verify() {
  const { certNo } = useParams();
  const [input, setInput] = useState(certNo ?? '');
  const [result, setResult] = useState<Result | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'notfound' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setResult(null);
    setMessage('');
    if (!certNo) return setState('idle');
    setInput(certNo);
    setState('loading');
    fetch(`/api/public/verify/${encodeURIComponent(certNo)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (r.ok) { setResult(body); setState('idle'); }
        else if (r.status === 404) setState('notfound');
        else { setMessage(body.error ?? 'Could not check this number.'); setState('error'); }
      })
      .catch(() => { setMessage('Could not reach the server. Try again in a moment.'); setState('error'); });
  }, [certNo]);

  return (
    <div className="verify-wrap">
      <h1>Check a certificate</h1>
      <p>Type the number printed on the certificate, or scan its QR code. You do not need an account.</p>

      <form className="verify-form" onSubmit={(e) => { e.preventDefault(); const n = input.trim().toUpperCase(); if (n) navigate(`/verify/${n}`); }}>
        <label className="sr-only" htmlFor="certno">Certificate number</label>
        <input id="certno" className="input" placeholder="PRG-2026-XXXXX-XXXXX" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" spellCheck={false} />
        <button type="submit" className="btn btn-primary" disabled={!input.trim() || state === 'loading'}><Icon name="search" />{state === 'loading' ? 'Checking' : 'Check'}</button>
      </form>

      {state === 'loading' && <p className="muted" style={{ marginTop: 24 }}>Checking the record</p>}

      {result && (
        <section className={`result ${result.valid ? 'good' : 'bad'}`} aria-live="polite">
          <Seal valid={result.valid} animate />
          <div>
            <h2>{result.valid ? 'Genuine certificate' : 'This certificate was cancelled'}</h2>
            <p className="why">
              {result.valid
                ? 'This certificate was issued by the Pragati Skills Mission and is valid today.'
                : `It was cancelled${result.cancelledAt ? ` on ${day(result.cancelledAt)}` : ''}${result.cancelReason ? `. Reason: ${result.cancelReason}` : ''}. Do not accept it as proof.`}
            </p>
            <dl>
              <div><dt>Holder</dt><dd>{result.holder}</dd></div>
              <div><dt>Course</dt><dd>{result.course}</dd></div>
              <div><dt>District</dt><dd>{result.district}</dd></div>
              <div><dt>Issued</dt><dd>{day(result.issuedAt)}</dd></div>
              <div className="wide"><dt>Certificate number</dt><dd className="certno" style={{ fontSize: 16 }}>{result.certNo}</dd></div>
            </dl>
            <p className="muted" style={{ marginTop: 14, fontSize: 13.5 }}>Part of the holder's name is hidden to protect their privacy. Compare the course and district with the paper certificate.</p>
          </div>
        </section>
      )}

      {state === 'notfound' && (
        <div className="panel" style={{ marginTop: 28 }} aria-live="polite">
          <Empty icon="alert" title="No certificate has this number">
            Check the number for typing mistakes. If it is correct, the certificate was not issued by the Pragati Skills Mission, so do not accept it.
          </Empty>
        </div>
      )}

      {state === 'error' && <div style={{ marginTop: 24 }}><Notice tone="bad">{message}</Notice></div>}
    </div>
  );
}

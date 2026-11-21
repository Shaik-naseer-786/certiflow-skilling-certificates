import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

type Result = {
  valid: boolean; status: string; certNo: string; holder: string; course: string; district: string;
  issuedAt: string; cancelledAt?: string; cancelReason?: string;
};

// Public page: no login. Also what the QR code on the certificate opens.
export default function Verify() {
  const { certNo } = useParams();
  const [input, setInput] = useState(certNo ?? '');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setResult(null);
    setError('');
    if (!certNo) return;
    fetch(`/api/public/verify/${encodeURIComponent(certNo)}`)
      .then(async (r) => {
        const body = await r.json();
        if (r.ok) setResult(body);
        else setError(r.status === 404 ? 'No certificate with this number exists. It may be fake.' : body.error ?? 'Could not check');
      })
      .catch(() => setError('Could not reach the server'));
  }, [certNo]);

  return (
    <div className="card narrow">
      <h2>Verify a certificate</h2>
      <form className="inline" onSubmit={(e) => { e.preventDefault(); navigate(`/verify/${input.trim().toUpperCase()}`); }}>
        <input placeholder="PRG-2025-XXXXX-XXXXX" value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit">Check</button>
      </form>
      {error && <p className="banner bad">{error}</p>}
      {result && (
        <div className={`banner ${result.valid ? 'good' : 'bad'}`}>
          <h3>{result.valid ? 'GENUINE: this certificate is valid' : 'NOT VALID: this certificate was cancelled'}</h3>
          <p>Number: <b>{result.certNo}</b></p>
          <p>Holder: <b>{result.holder}</b></p>
          <p>Course: {result.course} · District: {result.district}</p>
          <p>Issued: {new Date(result.issuedAt).toLocaleDateString()}</p>
          {!result.valid && <p>Cancelled on {new Date(result.cancelledAt!).toLocaleString()}. Reason: {result.cancelReason}</p>}
        </div>
      )}
    </div>
  );
}

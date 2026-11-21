export function StatusBadge({ status, stage, escalated }: { status: string; stage?: string | null; escalated?: boolean }) {
  const label = status === 'IN_REVIEW' && stage ? `In review: ${stage.toLowerCase()}` : status.replace('_', ' ').toLowerCase();
  return (
    <>
      <span className={`badge ${status}`}>{label}</span>
      {escalated && <span className="badge ESCALATED" title="Waiting too long">escalated</span>}
    </>
  );
}

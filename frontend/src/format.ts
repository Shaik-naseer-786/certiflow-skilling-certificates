// Small helpers that turn raw API values into plain words.

export const ROLE_LABEL: Record<string, string> = {
  CENTRE: 'Training centre',
  DISTRICT_OFFICER: 'District officer',
  QUALITY: 'Quality team',
  STATE: 'State office',
};

export const STAGE_LABEL: Record<string, string> = {
  DISTRICT: 'District officers',
  QUALITY: 'Quality team',
  STATE: 'State office',
};

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? parts[0][1] ?? '')).toUpperCase();
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export type Tone = 'neutral' | 'green' | 'blue' | 'amber' | 'red';

export function batchStatus(status: string, stage: string | null): { label: string; tone: Tone } {
  switch (status) {
    case 'DRAFT': return { label: 'Draft', tone: 'neutral' };
    case 'IN_REVIEW': return { label: `With ${(STAGE_LABEL[stage ?? ''] ?? 'reviewers').toLowerCase()}`, tone: 'blue' };
    case 'SENT_BACK': return { label: 'Sent back', tone: 'amber' };
    case 'REJECTED': return { label: 'Rejected', tone: 'red' };
    case 'APPROVED': return { label: 'Approved', tone: 'green' };
    default: return { label: status, tone: 'neutral' };
  }
}

export function deliveryStatus(s: string): { label: string; tone: Tone } {
  if (s === 'SENT') return { label: 'Delivered', tone: 'green' };
  if (s === 'FAILED') return { label: 'Failed', tone: 'red' };
  return { label: 'Sending', tone: 'blue' };
}

export const certStatus = (s: string): { label: string; tone: Tone } =>
  s === 'ISSUED' ? { label: 'Valid', tone: 'green' } : { label: 'Cancelled', tone: 'red' };

// Audit log codes written by the backend, in plain words.
const ACTIONS: Record<string, string> = {
  BATCH_CREATED: 'Created a batch',
  CANDIDATES_UPLOADED: 'Uploaded candidates',
  BATCH_SUBMITTED: 'Sent a batch for approval',
  BATCH_RESUBMITTED: 'Resubmitted a batch',
  DECISION_APPROVE: 'Approved',
  DECISION_REJECT: 'Rejected',
  DECISION_SEND_BACK: 'Sent back',
  STAGE_ADVANCED: 'Moved to the next step',
  BATCH_APPROVED: 'Batch fully approved',
  BATCH_ESCALATED: 'Batch waited too long',
  CERTIFICATE_ISSUED: 'Issued a certificate',
  CERTIFICATE_SKIPPED_DUPLICATE: 'Skipped a person who already holds this certificate',
  CERTIFICATE_DELIVERED: 'Delivered on WhatsApp',
  DELIVERY_FAILED: 'WhatsApp delivery failed',
  CERTIFICATE_CANCELLED: 'Cancelled a certificate',
};
export const actionText = (code: string) => ACTIONS[code] ?? code;

// A short readable summary of the audit "meta" details.
export function metaText(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return '';
  const m = meta as Record<string, unknown>;
  const bits: string[] = [];
  if (m.reason) bits.push(`Reason: ${m.reason}`);
  if (m.certNo) bits.push(String(m.certNo));
  if (m.stage) bits.push(`${STAGE_LABEL[String(m.stage)] ?? m.stage}`);
  if (m.from && m.to) bits.push(`${STAGE_LABEL[String(m.from)] ?? m.from} to ${STAGE_LABEL[String(m.to)] ?? m.to}`);
  if (m.version) bits.push(`version ${m.version}`);
  if (m.count) bits.push(`${m.count} candidates`);
  if (m.error) bits.push(String(m.error));
  return bits.join(', ');
}

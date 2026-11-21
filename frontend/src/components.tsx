import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { batchStatus, certStatus, deliveryStatus, initials, STAGE_LABEL, type Tone } from './format';

/* ---------------- icons (hand-drawn, stroke based) ---------------- */
const PATHS: Record<string, string> = {
  batches: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  verify: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM8.5 12l2.5 2.5 4.5-5',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  log: 'M5 6h14M5 12h14M5 18h9',
  chat: 'M4 5h16v11H9l-5 4V5z',
  out: 'M9 4H5v16h4M16 8l4 4-4 4M20 12H9',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  file: 'M7 3h7l4 4v14H7V3zM14 3v4h4',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  refresh: 'M20 12a8 8 0 11-2.5-5.8M20 4v5h-5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  alert: 'M12 4l9 16H3L12 4zM12 10v4M12 17.5v.5',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v5M12 8v.5',
  back: 'M15 5l-7 7 7 7',
  lock: 'M6 11h12v9H6v-9zM8.5 11V8a3.5 3.5 0 017 0v3',
  inbox: 'M3 13l3-8h12l3 8v6H3v-6zM3 13h5l1 3h6l1-3h5',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
};

export function Icon({ name, label }: { name: keyof typeof PATHS | string; label?: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

/* ---------------- brand ---------------- */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="19" fill="#e9c75a" />
      <circle cx="20" cy="20" r="15" fill="#0c2e27" />
      <path d="M12.5 20.5l5 5 10-11" fill="none" stroke="#e9c75a" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------- chips ---------------- */
export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`chip ${tone === 'neutral' ? '' : `chip-${tone}`}`}>{children}</span>;
}
export function BatchChip({ status, stage, escalated }: { status: string; stage: string | null; escalated?: boolean }) {
  const s = batchStatus(status, stage);
  return (
    <>
      <Chip tone={s.tone}>{s.label}</Chip>
      {escalated && <Chip tone="amber">Waiting too long</Chip>}
    </>
  );
}
export const DeliveryChip = ({ status }: { status: string }) => <Chip tone={deliveryStatus(status).tone}>{deliveryStatus(status).label}</Chip>;
export const CertChip = ({ status }: { status: string }) => <Chip tone={certStatus(status).tone}>{certStatus(status).label}</Chip>;

/* ---------------- avatar ---------------- */
export function Avatar({ name, role, small }: { name: string; role?: string; small?: boolean }) {
  const cls = role ? `role-${role}` : name.toLowerCase() === 'system' ? 'role-SYSTEM' : '';
  return <span className={`avatar ${small ? 'sm' : ''} ${cls}`} aria-hidden="true">{initials(name)}</span>;
}

/* ---------------- empty state ---------------- */
export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'good' | 'warn' | 'bad'; children: ReactNode }) {
  const icon = tone === 'good' ? 'check' : tone === 'info' ? 'info' : 'alert';
  return (
    <div className={`notice ${tone === 'info' ? '' : tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

/* ---------------- the seal (the one memorable thing) ---------------- */
export function Seal({ valid, animate = false, className = '' }: { valid: boolean; animate?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  const color = valid ? '#0d6b58' : '#b3261e';
  const tint = valid ? '#e2f0ea' : '#fbe6e3';
  const edge = useMemo(() => {
    const pts: string[] = [];
    const n = 40;
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 === 0 ? 77 : 72;
      const a = (Math.PI * i) / n;
      pts.push(`${(80 + r * Math.sin(a)).toFixed(2)},${(80 - r * Math.cos(a)).toFixed(2)}`);
    }
    return pts.join(' ');
  }, []);
  const ring = 2 * Math.PI * 59;
  return (
    <svg className={`seal ${animate ? 'stamp' : ''} ${className}`} viewBox="0 0 160 160" role="img" aria-label={valid ? 'Genuine certificate seal' : 'Cancelled certificate seal'}>
      <polygon points={edge} fill={tint} stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="80" cy="80" r="66" fill="none" stroke={color} strokeWidth="1" opacity=".55" />
      <path id={`p${id}`} d="M80,80 m-59,0 a59,59 0 1,1 118,0 a59,59 0 1,1 -118,0" fill="none" />
      <text fill={color} fontFamily="'Public Sans Variable', system-ui, sans-serif" fontSize="9.5" fontWeight="700" letterSpacing="1.2">
        <textPath href={`#p${id}`} textLength={ring - 4} lengthAdjust="spacing">
          {valid ? 'PRAGATI SKILLS MISSION  •  VERIFIED  •  ' : 'PRAGATI SKILLS MISSION  •  CANCELLED  •  '}
        </textPath>
      </text>
      <circle cx="80" cy="80" r="45" fill="#fff" stroke={color} strokeWidth="2" />
      <circle cx="80" cy="80" r="39" fill="none" stroke={color} strokeWidth="1" strokeDasharray="2 3" opacity=".6" />
      {valid ? (
        <path d="M60 81l14 14 27-30" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M63 63l34 34M97 63L63 97" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" />
      )}
    </svg>
  );
}

/* ---------------- stage tracker (a real sequence, so steps are numbered) ---------------- */
type TrackBatch = { status: string; stage: string | null; requiresQuality: boolean };

function stepKeys(requiresQuality: boolean) {
  return ['DISTRICT', ...(requiresQuality ? ['QUALITY'] : []), 'STATE', 'ISSUED'];
}

// 'done' | 'now' | 'stop' | '' for each step. Used by the big tracker and the mini bars in the list.
export function stepStates(b: TrackBatch, allSent = false): string[] {
  const keys = stepKeys(b.requiresQuality);
  if (b.status === 'IN_REVIEW' && b.stage) {
    const cur = keys.indexOf(b.stage);
    return keys.map((_, i) => (i < cur ? 'done' : i === cur ? 'now' : ''));
  }
  if (b.status === 'APPROVED') {
    return keys.map((k) => (k === 'ISSUED' ? (allSent ? 'done' : 'now') : 'done'));
  }
  if (b.status === 'SENT_BACK' || b.status === 'REJECTED') return keys.map((_, i) => (i === 0 ? 'stop' : ''));
  return keys.map(() => '');
}

export function MiniTrack({ batch }: { batch: TrackBatch }) {
  return (
    <div className="mini-track" aria-hidden="true">
      {stepStates(batch).map((s, i) => <i key={i} className={s} />)}
    </div>
  );
}

export function StageTrack({
  batch, districtApprovals, delivered, total,
}: { batch: TrackBatch; districtApprovals: number; delivered: number; total: number }) {
  const keys = stepKeys(batch.requiresQuality);
  const states = stepStates(batch, total > 0 && delivered === total);
  const sub = (key: string, state: string) => {
    if (key === 'DISTRICT') return state === 'done' ? '2 of 2 approved' : state === 'now' ? `${districtApprovals} of 2 approved` : '2 officers approve';
    if (key === 'QUALITY') return state === 'done' ? 'Approved' : state === 'now' ? 'Reviewing' : 'Large batch review';
    if (key === 'STATE') return state === 'done' ? 'Approved' : state === 'now' ? 'Final approval' : 'Final approval';
    return total > 0 ? `${delivered} of ${total} delivered` : 'Sent on WhatsApp';
  };
  const label = (key: string) => (key === 'ISSUED' ? 'Certificates' : STAGE_LABEL[key]);
  return (
    <ol className="track" style={{ margin: 0, listStyle: 'none' }} aria-label="Approval progress">
      {keys.map((k, i) => (
        <li key={k} className={`step ${states[i]}`} aria-current={states[i] === 'now' ? 'step' : undefined}>
          <span className="dot">{states[i] === 'done' ? <Icon name="check" /> : i + 1}</span>
          <b>{label(k)}</b>
          <small>{sub(k, states[i])}</small>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- modal ---------------- */
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('textarea, input, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

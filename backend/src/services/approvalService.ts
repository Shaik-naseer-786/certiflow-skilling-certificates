import type { Stage } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { writeAudit } from './audit.js';
import type { AuthUser } from './access.js';

// Which role acts at each stage.
const STAGE_ROLE = { DISTRICT: 'DISTRICT_OFFICER', QUALITY: 'QUALITY', STATE: 'STATE' } as const;

const approvalsNeeded = (stage: Stage) => (stage === 'DISTRICT' ? config.districtApprovalsRequired : 1);

// District -> (Quality, only for big batches) -> State.
function nextStage(stage: Stage, requiresQuality: boolean): Stage | null {
  if (stage === 'DISTRICT') return requiresQuality ? 'QUALITY' : 'STATE';
  if (stage === 'QUALITY') return 'STATE';
  return null; // after STATE the batch is fully approved
}

export type DecisionResult = {
  batchId: string;
  status: string;
  stage: Stage | null;
  duplicate: boolean;
  fullyApproved: boolean;
};

export async function decide(
  user: AuthUser,
  batchId: string,
  decision: 'APPROVE' | 'REJECT' | 'SEND_BACK',
  reason?: string,
): Promise<DecisionResult> {
  if (decision !== 'APPROVE' && !reason?.trim()) throw badRequest('A reason is required to reject or send back');

  return prisma.$transaction(async (tx) => {
    // 1. LOCK the batch row. Anyone else deciding on this batch waits here until
    //    we commit, so concurrent decisions run one after another, never together.
    await tx.$queryRaw`SELECT id FROM "Batch" WHERE id = ${batchId} FOR UPDATE`;
    const batch = await tx.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw notFound('Batch');

    // 2. Re-check everything AFTER getting the lock (state may have changed while we waited).
    if (batch.status !== 'IN_REVIEW' || !batch.stage) throw conflict('Batch is not waiting for a decision');
    const stage = batch.stage;
    if (user.role !== STAGE_ROLE[stage]) throw forbidden(`This batch is at the ${stage} step, which is not yours`);
    if (stage === 'DISTRICT' && batch.district !== user.district) throw forbidden('This batch belongs to another district');

    // 3. Idempotency: same officer, same version and stage => return what happened before.
    const existing = await tx.approval.findUnique({
      where: { batchId_version_stage_officerId: { batchId, version: batch.version, stage, officerId: user.id } },
    });
    if (existing) return { batchId, status: batch.status, stage: batch.stage, duplicate: true, fullyApproved: false };

    await tx.approval.create({
      data: { batchId, version: batch.version, stage, officerId: user.id, decision, reason: reason?.trim() },
    });
    await writeAudit(tx, user, `DECISION_${decision}`, 'Batch', batchId, { stage, version: batch.version, reason });

    // 4a. Reject / send back act immediately: one officer is enough.
    if (decision !== 'APPROVE') {
      const status = decision === 'REJECT' ? 'REJECTED' : 'SENT_BACK';
      await tx.batch.update({
        where: { id: batchId },
        data: { status, stage: null, lastReason: reason!.trim(), stageEnteredAt: null, escalatedAt: null },
      });
      return { batchId, status, stage: null, duplicate: false, fullyApproved: false };
    }

    // 4b. Approve: only move forward once enough DIFFERENT officers approved this version + stage.
    const count = await tx.approval.count({ where: { batchId, version: batch.version, stage, decision: 'APPROVE' } });
    if (count < approvalsNeeded(stage)) {
      return { batchId, status: batch.status, stage, duplicate: false, fullyApproved: false };
    }

    const next = nextStage(stage, batch.requiresQuality);
    if (next) {
      await tx.batch.update({ where: { id: batchId }, data: { stage: next, stageEnteredAt: new Date(), escalatedAt: null } });
      await writeAudit(tx, null, 'STAGE_ADVANCED', 'Batch', batchId, { from: stage, to: next });
      return { batchId, status: 'IN_REVIEW', stage: next, duplicate: false, fullyApproved: false };
    }
    await tx.batch.update({
      where: { id: batchId },
      data: { status: 'APPROVED', stage: null, stageEnteredAt: null, escalatedAt: null },
    });
    await writeAudit(tx, null, 'BATCH_APPROVED', 'Batch', batchId, { version: batch.version });
    return { batchId, status: 'APPROVED', stage: null, duplicate: false, fullyApproved: true };
  });
}

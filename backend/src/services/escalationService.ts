import { prisma } from '../db.js';
import { config } from '../config.js';
import { writeAudit } from './audit.js';

// Finds batches that sat at one stage for too long and flags them ONCE.
// The state office sees flagged batches in its "Stuck" list, and the audit log
// records the escalation. Safe to run repeatedly (escalatedAt must still be null).
export async function escalateStaleBatches(now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - config.escalationMinutes * 60_000);
  const stale = await prisma.batch.findMany({
    where: { status: 'IN_REVIEW', escalatedAt: null, stageEnteredAt: { lt: cutoff } },
  });
  const escalated: string[] = [];
  for (const b of stale) {
    await prisma.$transaction(async (tx) => {
      // Conditional update: if the batch moved on or another worker got here first, count = 0.
      const res = await tx.batch.updateMany({
        where: { id: b.id, escalatedAt: null, stage: b.stage, version: b.version },
        data: { escalatedAt: now },
      });
      if (res.count === 0) return;
      await writeAudit(tx, null, 'BATCH_ESCALATED', 'Batch', b.id, {
        stage: b.stage,
        since: b.stageEnteredAt,
        thresholdMinutes: config.escalationMinutes,
      });
      escalated.push(b.id);
    });
  }
  return escalated;
}

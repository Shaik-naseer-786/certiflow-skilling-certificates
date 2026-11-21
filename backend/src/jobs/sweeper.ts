import { prisma } from '../db.js';
import { enqueueDelivery, enqueueIssuance } from '../queue.js';

// Safety net for "the process died between committing to the database and
// adding the job to Redis" (or Redis lost its data). Everything the database says
// should be happening gets (re)enqueued. Enqueueing is idempotent (same jobId),
// so running this often is harmless.
export async function sweep(olderThanMs = 2 * 60_000) {
  const cutoff = new Date(Date.now() - olderThanMs);

  const approvedNotIssued = await prisma.batch.findMany({ where: { status: 'APPROVED', issuedAt: null }, select: { id: true } });
  for (const b of approvedNotIssued) await enqueueIssuance(b.id);

  const stuckCerts = await prisma.certificate.findMany({
    where: { status: 'ISSUED', deliveryStatus: 'PENDING', issuedAt: { lt: cutoff } },
    select: { id: true },
    take: 500,
  });
  for (const c of stuckCerts) await enqueueDelivery(c.id);

  return { batches: approvedNotIssued.length, certificates: stuckCerts.length };
}

import { prisma } from '../db.js';
import { config } from '../config.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { writeAudit } from './audit.js';
import { batchVisibility, type AuthUser } from './access.js';
import { parseWorkbook } from './excel.js';
import { findCrossBatchDuplicates } from './duplicateService.js';

export async function createBatch(user: AuthUser, name: string) {
  if (!user.district) throw badRequest('Centre user has no district');
  return prisma.$transaction(async (tx) => {
    const batch = await tx.batch.create({ data: { name, district: user.district!, centreId: user.id } });
    await writeAudit(tx, user, 'BATCH_CREATED', 'Batch', batch.id, { name });
    return batch;
  });
}

export async function listBatches(user: AuthUser) {
  return prisma.batch.findMany({
    where: batchVisibility(user),
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { candidates: true } }, centre: { select: { name: true } } },
  });
}

export async function getBatchDetail(user: AuthUser, id: string) {
  const batch = await prisma.batch.findFirst({
    where: { id, ...batchVisibility(user) }, // a stranger gets 404, not 403: don't reveal it exists
    include: {
      centre: { select: { name: true } },
      candidates: { orderBy: { rowNumber: 'asc' } },
      approvals: { orderBy: { createdAt: 'asc' }, include: { officer: { select: { name: true } } } },
      versions: { orderBy: { version: 'asc' }, select: { version: true, submittedAt: true } },
    },
  });
  if (!batch) throw notFound('Batch');
  return batch;
}

// Loads a batch owned by this centre user, or fails.
async function ownBatch(user: AuthUser, id: string) {
  const batch = await prisma.batch.findUnique({ where: { id } });
  if (!batch || batch.centreId !== user.id) throw notFound('Batch');
  return batch;
}

// Replace the candidate list from an uploaded sheet. All or nothing:
// if ANY row is bad, nothing is written and every error is reported.
export async function uploadCandidates(user: AuthUser, batchId: string, file: Buffer) {
  await ownBatch(user, batchId);
  const parsed = await parseWorkbook(file);
  const { candidates } = parsed;
  // Sheet is fine by itself: now check these people are not already certified / in another batch.
  const errors = [...parsed.errors, ...(parsed.errors.length ? [] : await findCrossBatchDuplicates(batchId, candidates))];
  if (errors.length) throw new AppError(422, `${errors.length} problem(s) found in the spreadsheet. Nothing was saved.`, { errors });

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Batch" WHERE id = ${batchId} FOR UPDATE`;
    const batch = await tx.batch.findUniqueOrThrow({ where: { id: batchId } });
    if (batch.status !== 'DRAFT' && batch.status !== 'SENT_BACK') throw conflict(`Batch is ${batch.status} and can no longer be edited`);

    await tx.candidate.deleteMany({ where: { batchId } });
    await tx.candidate.createMany({ data: candidates.map((c) => ({ ...c, batchId })) });
    await writeAudit(tx, user, 'CANDIDATES_UPLOADED', 'Batch', batchId, { count: candidates.length });
    return { saved: candidates.length };
  });
}

// Send for approval (first time) or resubmit after a send-back.
export async function submitBatch(user: AuthUser, batchId: string) {
  await ownBatch(user, batchId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Batch" WHERE id = ${batchId} FOR UPDATE`;
    const batch = await tx.batch.findUniqueOrThrow({ where: { id: batchId }, include: { candidates: true } });
    if (batch.status !== 'DRAFT' && batch.status !== 'SENT_BACK') throw conflict(`Batch is ${batch.status}; it cannot be submitted`);
    if (batch.candidates.length === 0) throw badRequest('Upload candidates before submitting');

    // Re-check now: another batch may have been submitted or certified since this one was uploaded.
    const dupes = await findCrossBatchDuplicates(batchId, batch.candidates);
    if (dupes.length) throw new AppError(409, `${dupes.length} candidate(s) are already certified or in another batch. Fix the sheet and upload again.`, { errors: dupes });

    // First submission keeps version 1. A resubmission starts a NEW version, so
    // approvals given on the old version stop counting (see README, decision D3).
    const version = batch.status === 'SENT_BACK' ? batch.version + 1 : batch.version;
    const snapshot = batch.candidates.map(({ rowNumber, name, phone, course, score }) => ({ rowNumber, name, phone, course, score }));
    await tx.batchVersion.create({ data: { batchId, version, snapshot } });

    const updated = await tx.batch.update({
      where: { id: batchId },
      data: {
        status: 'IN_REVIEW',
        stage: 'DISTRICT',
        version,
        requiresQuality: batch.candidates.length >= config.qualityThreshold,
        stageEnteredAt: new Date(),
        escalatedAt: null,
        lastReason: null,
      },
    });
    await writeAudit(tx, user, version > 1 ? 'BATCH_RESUBMITTED' : 'BATCH_SUBMITTED', 'Batch', batchId, { version, candidates: batch.candidates.length });
    return updated;
  });
}

export function assertCentre(user: AuthUser) {
  if (user.role !== 'CENTRE') throw forbidden('Only training centres can do this');
}

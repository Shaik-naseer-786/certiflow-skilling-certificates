import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/queue.js', () => ({
  enqueueIssuance: vi.fn(),
  enqueueDelivery: vi.fn(),
  removeDeliveryJob: vi.fn(),
}));

import { prisma } from '../src/db.js';
import { enqueueDelivery, enqueueIssuance } from '../src/queue.js';
import { runMaintenance } from '../src/jobs/processors.js';
import { sweep } from '../src/jobs/sweeper.js';
import { issueCertificates } from '../src/services/certificateService.js';
import { approvedBatch, resetDb, submittedBatch } from './helpers.js';

const issueMock = vi.mocked(enqueueIssuance);
const deliverMock = vi.mocked(enqueueDelivery);

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

describe('Sweeper: re-queues anything the database says is unfinished', () => {
  it('queues issuance for an approved batch that has no certificates yet (job lost after commit)', async () => {
    const batchId = await approvedBatch(3); // approved, but nobody ever enqueued the issuance job
    const result = await sweep();
    expect(issueMock).toHaveBeenCalledWith(batchId);
    expect(result.batches).toBe(1);
  });

  it('ignores batches that are only in review', async () => {
    await submittedBatch('Anika', 3);
    await sweep();
    expect(issueMock).not.toHaveBeenCalled();
  });

  it('does not queue issuance again once certificates were issued', async () => {
    const batchId = await approvedBatch(3);
    await issueCertificates(batchId); // sets issuedAt
    await sweep();
    expect(issueMock).not.toHaveBeenCalled();
  });

  it('re-queues delivery only for certificates that are still PENDING and older than 2 minutes', async () => {
    const batchId = await approvedBatch(5);
    await issueCertificates(batchId);
    const certs = await prisma.certificate.findMany({ orderBy: { certNo: 'asc' } });
    const [stuck, fresh, sent, cancelled, failed] = certs;

    await prisma.certificate.updateMany({ where: { id: { in: [stuck.id, sent.id, cancelled.id, failed.id] } }, data: { issuedAt: minutesAgo(10) } });
    await prisma.certificate.update({ where: { id: sent.id }, data: { deliveryStatus: 'SENT' } });
    await prisma.certificate.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });
    await prisma.certificate.update({ where: { id: failed.id }, data: { deliveryStatus: 'FAILED' } });
    // `fresh` stays PENDING but was issued just now

    const result = await sweep();

    expect(deliverMock).toHaveBeenCalledTimes(1);
    expect(deliverMock).toHaveBeenCalledWith(stuck.id);
    expect(deliverMock).not.toHaveBeenCalledWith(fresh.id);
    expect(result.certificates).toBe(1);
  });

  it('runMaintenance runs both escalation and the sweeper', async () => {
    const stale = await submittedBatch('Anika', 3);
    await prisma.batch.update({ where: { id: stale.batchId }, data: { stageEnteredAt: minutesAgo(60 * 30) } });
    const approved = await approvedBatch(3, 'Anika', 100);

    const result = await runMaintenance();

    expect(result.escalated).toEqual([stale.batchId]);
    expect(issueMock).toHaveBeenCalledWith(approved);
  });
});

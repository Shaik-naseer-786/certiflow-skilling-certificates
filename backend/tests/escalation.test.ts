import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/queue.js', () => ({ enqueueIssuance: vi.fn(), enqueueDelivery: vi.fn() }));

import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { signToken } from '../src/middleware/auth.js';
import { decide } from '../src/services/approvalService.js';
import { escalateStaleBatches } from '../src/services/escalationService.js';
import { resetDb, submittedBatch, userByName } from './helpers.js';

const app = createApp();
beforeEach(resetDb);

const ago = (hours: number) => new Date(Date.now() - hours * 3600_000);

describe('Moment 5: batch sits too long', () => {
  it('is escalated once, recorded in the audit log, and visible to the state office', async () => {
    const stale = await submittedBatch('Anika', 3);
    const fresh = await submittedBatch('Anika', 3, 100); // different people, or the duplicate rule would refuse it
    await prisma.batch.update({ where: { id: stale.batchId }, data: { stageEnteredAt: ago(30) } });

    expect(await escalateStaleBatches()).toEqual([stale.batchId]);
    expect(await escalateStaleBatches()).toEqual([]); // running again does not escalate twice

    expect(await prisma.auditLog.count({ where: { entityId: stale.batchId, action: 'BATCH_ESCALATED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: fresh.batchId, action: 'BATCH_ESCALATED' } })).toBe(0);

    const farah = await userByName('Farah');
    const res = await request(app).get('/api/state/stuck').set('Authorization', `Bearer ${signToken(farah.id)}`);
    expect(res.body.batches.map((b: { id: string }) => b.id)).toEqual([stale.batchId]);

    const dev = await userByName('Dev');
    expect((await request(app).get('/api/state/stuck').set('Authorization', `Bearer ${signToken(dev.id)}`)).status).toBe(403);
  });

  it('moving to the next stage restarts the clock', async () => {
    const { batchId } = await submittedBatch('Anika', 3);
    await prisma.batch.update({ where: { id: batchId }, data: { stageEnteredAt: ago(30) } });
    await escalateStaleBatches();
    await decide(await userByName('Dev'), batchId, 'APPROVE');
    await decide(await userByName('Meera'), batchId, 'APPROVE');
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.escalatedAt).toBeNull();
    expect(await escalateStaleBatches()).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { decide } from '../src/services/approvalService.js';
import { submitBatch, uploadCandidates } from '../src/services/batchService.js';
import { goodRows, makeXlsx, resetDb, submittedBatch, userByName } from './helpers.js';

beforeEach(resetDb);

const stageOf = async (id: string) => prisma.batch.findUniqueOrThrow({ where: { id } });
const auditCount = (batchId: string, action: string) => prisma.auditLog.count({ where: { entityId: batchId, action } });

describe('Moment 2: simultaneous approvals', () => {
  it('two officers approving at the same instant move the batch forward exactly once', async () => {
    const { batchId } = await submittedBatch('Anika', 5);
    const [dev, meera] = await Promise.all([userByName('Dev'), userByName('Meera')]);

    await Promise.all([decide(dev, batchId, 'APPROVE'), decide(meera, batchId, 'APPROVE')]);

    const batch = await stageOf(batchId);
    expect(batch.stage).toBe('STATE'); // small batch: district -> state
    expect(await prisma.approval.count({ where: { batchId, stage: 'DISTRICT' } })).toBe(2);
    expect(await auditCount(batchId, 'STAGE_ADVANCED')).toBe(1);
  });

  it('three officers racing: advances once, the late one is refused', async () => {
    const { batchId } = await submittedBatch('Anika', 5);
    const officers = await Promise.all(['Dev', 'Meera', 'Kabir'].map(userByName));

    const results = await Promise.allSettled(officers.map((o) => decide(o, batchId, 'APPROVE')));

    expect(await auditCount(batchId, 'STAGE_ADVANCED')).toBe(1);
    expect((await stageOf(batchId)).stage).toBe('STATE');
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1); // the 3rd arrived after the stage changed
  });

  it('the same officer double-clicking creates one approval, and a single approval is not enough', async () => {
    const { batchId } = await submittedBatch('Anika', 5);
    const dev = await userByName('Dev');

    const results = await Promise.all(Array.from({ length: 5 }, () => decide(dev, batchId, 'APPROVE')));

    expect(await prisma.approval.count({ where: { batchId } })).toBe(1);
    expect(results.filter((r) => r.duplicate)).toHaveLength(4);
    expect((await stageOf(batchId)).stage).toBe('DISTRICT'); // still waiting for a second officer
  });
});

describe('Workflow stages', () => {
  it('a big batch (>= 50) also goes through the quality team', async () => {
    const { batchId } = await submittedBatch('Anika', 60);
    await decide(await userByName('Dev'), batchId, 'APPROVE');
    await decide(await userByName('Meera'), batchId, 'APPROVE');
    expect((await stageOf(batchId)).stage).toBe('QUALITY');
    await decide(await userByName('Neha'), batchId, 'APPROVE');
    expect((await stageOf(batchId)).stage).toBe('STATE');
    const last = await decide(await userByName('Farah'), batchId, 'APPROVE');
    expect(last.fullyApproved).toBe(true);
    expect((await stageOf(batchId)).status).toBe('APPROVED');
  });

  it('rejecting needs a reason and is final', async () => {
    const { batchId } = await submittedBatch('Anika', 5);
    const dev = await userByName('Dev');
    await expect(decide(dev, batchId, 'REJECT')).rejects.toThrow(/reason/);
    await decide(dev, batchId, 'REJECT', 'Duplicate students');
    const batch = await stageOf(batchId);
    expect(batch.status).toBe('REJECTED');
    expect(batch.lastReason).toBe('Duplicate students');
    await expect(submitBatch(await userByName('Anika'), batchId)).rejects.toThrow(/cannot be submitted/);
  });
});

describe('Things that must never happen: wrong person at wrong step', () => {
  it('refuses the wrong role, wrong district and wrong stage', async () => {
    const { batchId } = await submittedBatch('Anika', 5);
    await expect(decide(await userByName('Farah'), batchId, 'APPROVE')).rejects.toMatchObject({ status: 403 }); // state at district step
    await expect(decide(await userByName('Neha'), batchId, 'APPROVE')).rejects.toMatchObject({ status: 403 });
    await expect(decide(await userByName('Ishaan'), batchId, 'APPROVE')).rejects.toMatchObject({ status: 403 }); // other district
    await expect(decide(await userByName('Anika'), batchId, 'APPROVE')).rejects.toMatchObject({ status: 403 }); // centre
    expect(await prisma.approval.count()).toBe(0);
  });

  it('every decision is traceable to who made it and when', async () => {
    const { batchId } = await submittedBatch('Anika', 5);
    const dev = await userByName('Dev');
    await decide(dev, batchId, 'APPROVE');
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: batchId, action: 'DECISION_APPROVE' } });
    expect(log.actorId).toBe(dev.id);
    expect(log.actorName).toBe('Dev');
    expect(log.createdAt).toBeInstanceOf(Date);
  });
});

describe('Moment 6: send back, fix and resubmit', () => {
  it('starts a new version and old approvals no longer count (but stay in history)', async () => {
    const { centre, batchId } = await submittedBatch('Anika', 5);
    const [dev, meera, kabir] = await Promise.all(['Dev', 'Meera', 'Kabir'].map(userByName));

    await decide(dev, batchId, 'APPROVE'); // 1 of 2 approvals on version 1
    await decide(meera, batchId, 'SEND_BACK', 'Fix phone numbers');
    expect((await stageOf(batchId)).status).toBe('SENT_BACK');

    // centre fixes the list and resubmits
    await uploadCandidates(centre, batchId, await makeXlsx(goodRows(6)));
    await submitBatch(centre, batchId);
    const resubmitted = await stageOf(batchId);
    expect(resubmitted.version).toBe(2);
    expect(resubmitted.stage).toBe('DISTRICT');
    expect(await prisma.batchVersion.count({ where: { batchId } })).toBe(2);

    // Dev's old approval does not count: he may approve again, and one approval is still not enough
    await decide(dev, batchId, 'APPROVE');
    expect((await stageOf(batchId)).stage).toBe('DISTRICT');
    await decide(kabir, batchId, 'APPROVE');
    expect((await stageOf(batchId)).stage).toBe('STATE');

    // full history is kept: v1 (approve + send back) and v2 (2 approvals)
    expect(await prisma.approval.count({ where: { batchId } })).toBe(4);
  });

  it('a batch under review cannot be edited', async () => {
    const { centre, batchId } = await submittedBatch('Anika', 5);
    await expect(uploadCandidates(centre, batchId, await makeXlsx(goodRows(3)))).rejects.toMatchObject({ status: 409 });
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { createBatch, submitBatch, uploadCandidates } from '../src/services/batchService.js';
import { cancelCertificate, issueCertificates } from '../src/services/certificateService.js';
import { approveExisting, approvedBatch, goodRows, makeXlsx, resetDb, userByName } from './helpers.js';

beforeEach(resetDb);

const xlsx = (rows: Record<string, unknown>[]) => makeXlsx(rows);

describe('One valid certificate per person per course, across batches', () => {
  it('rejects people who already hold a valid certificate for the same course, and saves nothing', async () => {
    const first = await approvedBatch(3); // phones ...000 to ...002, Electrician
    await issueCertificates(first);

    const anika = await userByName('Anika');
    const batch = await createBatch(anika, 'Second batch');
    // goodRows(5): phones ...000 to ...004. The first three are already certified.
    const err = await uploadCandidates(anika, batch.id, await xlsx(goodRows(5))).catch((e) => e);

    expect(err.status).toBe(422);
    expect(err.details.errors.map((e: { row: number }) => e.row)).toEqual([2, 3, 4]); // sheet rows 2-4
    expect(err.details.errors[0].message).toMatch(/Already holds a valid Electrician certificate \(PRG-/);
    expect(await prisma.candidate.count({ where: { batchId: batch.id } })).toBe(0);
  });

  it('allows the same person to be certified for a DIFFERENT course', async () => {
    const first = await approvedBatch(3);
    await issueCertificates(first);

    const anika = await userByName('Anika');
    const batch = await createBatch(anika, 'Welding batch');
    const rows = goodRows(3).map((r) => ({ ...r, Course: 'Welding' }));
    const res = await uploadCandidates(anika, batch.id, await xlsx(rows));
    expect(res.saved).toBe(3);
  });

  it('rejects people who are already in another batch that is under review', async () => {
    const anika = await userByName('Anika');
    const a = await createBatch(anika, 'Batch A');
    await uploadCandidates(anika, a.id, await xlsx(goodRows(3)));
    await submitBatch(anika, a.id); // now IN_REVIEW

    const b = await createBatch(anika, 'Batch B');
    const err = await uploadCandidates(anika, b.id, await xlsx(goodRows(3))).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.details.errors[0].message).toMatch(/Already in batch "Batch A" \(in review\)/);
  });

  it('does not block on someone else\'s DRAFT batch', async () => {
    const anika = await userByName('Anika');
    const a = await createBatch(anika, 'Batch A');
    await uploadCandidates(anika, a.id, await xlsx(goodRows(3))); // stays a draft
    const b = await createBatch(anika, 'Batch B');
    expect((await uploadCandidates(anika, b.id, await xlsx(goodRows(3)))).saved).toBe(3);
  });

  it('a cancelled certificate frees the person to be certified again', async () => {
    const first = await approvedBatch(3);
    await issueCertificates(first);
    const farah = await userByName('Farah');
    for (const c of await prisma.certificate.findMany()) await cancelCertificate(farah, c.id, 'Issued by mistake');

    const anika = await userByName('Anika');
    const batch = await createBatch(anika, 'Second batch');
    expect((await uploadCandidates(anika, batch.id, await xlsx(goodRows(3)))).saved).toBe(3);
  });

  it('re-checks at submit time, because another batch may have moved on since upload', async () => {
    const anika = await userByName('Anika');
    const a = await createBatch(anika, 'Batch A');
    const b = await createBatch(anika, 'Batch B');
    await uploadCandidates(anika, a.id, await xlsx(goodRows(3))); // both drafts: both uploads are allowed
    await uploadCandidates(anika, b.id, await xlsx(goodRows(3)));

    await submitBatch(anika, a.id); // A goes first
    const err = await submitBatch(anika, b.id).catch((e) => e); // B is now a duplicate
    expect(err.status).toBe(409);
    expect(err.details.errors).toHaveLength(3);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('DRAFT');
  });

  it('DATABASE BACKSTOP: even if a duplicate slips through every check, it cannot be issued twice', async () => {
    const anika = await userByName('Anika');
    const a = await createBatch(anika, 'Batch A');
    const b = await createBatch(anika, 'Batch B');
    await uploadCandidates(anika, a.id, await xlsx(goodRows(3)));
    // B uses a different letter case on purpose: the index must treat Electrician and electrician as the same course
    await uploadCandidates(anika, b.id, await xlsx(goodRows(3).map((r) => ({ ...r, Course: 'electrician' }))));

    await submitBatch(anika, a.id);
    await approveExisting(a.id, 3);
    await issueCertificates(a.id); // A certified: 3 certificates exist

    // Simulate the race that the submit check cannot see: force B to APPROVED directly.
    await prisma.batch.update({ where: { id: b.id }, data: { status: 'APPROVED', stage: null } });
    await issueCertificates(b.id);

    expect(await prisma.certificate.count({ where: { status: 'ISSUED' } })).toBe(3); // still only A's
    expect(await prisma.certificate.count({ where: { batchId: b.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: b.id, action: 'CERTIFICATE_SKIPPED_DUPLICATE' } })).toBe(3);
  });

  it('the same batch re-uploaded after a send-back is not compared against itself', async () => {
    const anika = await userByName('Anika');
    const a = await createBatch(anika, 'Batch A');
    await uploadCandidates(anika, a.id, await xlsx(goodRows(3)));
    await submitBatch(anika, a.id);
    const { decide } = await import('../src/services/approvalService.js');
    await decide(await userByName('Dev'), a.id, 'SEND_BACK', 'please recheck');
    expect((await uploadCandidates(anika, a.id, await xlsx(goodRows(3)))).saved).toBe(3);
  });
});


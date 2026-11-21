import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/queue.js', () => ({ enqueueIssuance: vi.fn(), enqueueDelivery: vi.fn() }));

import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { signToken } from '../src/middleware/auth.js';
import { setProviderBehaviour } from '../src/providers/fakeWhatsapp.js';
import { cancelCertificate, issueCertificates } from '../src/services/certificateService.js';
import { deliverCertificate } from '../src/services/deliveryService.js';
import { approvedBatch, resetDb, userByName } from './helpers.js';

const app = createApp();

beforeEach(async () => {
  await resetDb();
  config.whatsapp.callTimeoutMs = 50;
  setProviderBehaviour({ rng: Math.random, failRate: 0, timeoutRate: 0, timeoutDelayMs: 150 });
});

describe('Never two certificates for one candidate', () => {
  it('issuing many times, even at the same moment, gives each candidate exactly one unique certificate', async () => {
    const batchId = await approvedBatch(60);

    await Promise.all([issueCertificates(batchId), issueCertificates(batchId), issueCertificates(batchId)]);
    await issueCertificates(batchId); // and once more later

    const certs = await prisma.certificate.findMany({ where: { batchId } });
    expect(certs).toHaveLength(60);
    expect(new Set(certs.map((c) => c.certNo)).size).toBe(60); // no shared numbers
    expect(new Set(certs.map((c) => c.candidateId)).size).toBe(60);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })).issuedAt).not.toBeNull();
  });

  it('refuses to issue for a batch that is not approved', async () => {
    const { submittedBatch } = await import('./helpers.js');
    const { batchId } = await submittedBatch('Anika', 3);
    await expect(issueCertificates(batchId)).rejects.toMatchObject({ status: 409 });
  });
});

describe('Moment 3: 60 candidates, unreliable WhatsApp', () => {
  it('every candidate ends up with exactly one message, even with failures and lost replies', async () => {
    setProviderBehaviour({ failRate: 0.3, timeoutRate: 0.3 }); // only 40% of calls are clean
    const batchId = await approvedBatch(60);
    const ids = await issueCertificates(batchId);

    // Simulate the queue: keep retrying each certificate until it succeeds (the real worker does this with backoff).
    let totalCalls = 0;
    for (const id of ids) {
      for (let attempt = 0; attempt < 60; attempt++) {
        totalCalls++;
        try {
          await deliverCertificate(id);
          break;
        } catch {
          /* retry */
        }
      }
    }

    expect(totalCalls).toBeGreaterThan(60); // retries really happened
    const certs = await prisma.certificate.findMany({ where: { batchId } });
    expect(certs.every((c) => c.deliveryStatus === 'SENT')).toBe(true);
    const messages = await prisma.providerMessage.findMany();
    expect(messages).toHaveLength(60); // not 61+: timeouts that DID deliver were not re-sent
    expect(new Set(messages.map((m) => m.idempotencyKey)).size).toBe(60);
  });

  it('delivering an already-sent certificate does nothing', async () => {
    const batchId = await approvedBatch(3);
    const [id] = await issueCertificates(batchId);
    expect(await deliverCertificate(id)).toBe('sent');
    expect(await deliverCertificate(id)).toBe('skipped');
    expect(await prisma.providerMessage.count({ where: { idempotencyKey: id } })).toBe(1);
  });

  it('a provider failure is recorded and thrown so the queue can retry', async () => {
    setProviderBehaviour({ failRate: 1 });
    const batchId = await approvedBatch(3);
    const [id] = await issueCertificates(batchId);
    await expect(deliverCertificate(id)).rejects.toThrow(/503/);
    const cert = await prisma.certificate.findUniqueOrThrow({ where: { id } });
    expect(cert.deliveryStatus).toBe('PENDING');
    expect(cert.deliveryAttempts).toBe(1);
    expect(cert.lastError).toMatch(/503/);
  });

  it('a call that never answers times out', async () => {
    setProviderBehaviour({ timeoutRate: 1 });
    const batchId = await approvedBatch(3);
    const [id] = await issueCertificates(batchId);
    await expect(deliverCertificate(id)).rejects.toThrow(/timed out/);
  });
});

describe('Moment 4: cancelling a certificate', () => {
  it('verification says valid before and invalid right after cancellation', async () => {
    const batchId = await approvedBatch(3);
    const [id] = await issueCertificates(batchId);
    const cert = await prisma.certificate.findUniqueOrThrow({ where: { id } });

    const before = await request(app).get(`/api/public/verify/${cert.certNo}`);
    expect(before.status).toBe(200);
    expect(before.body.valid).toBe(true);

    await cancelCertificate(await userByName('Farah'), id, 'Issued by mistake');

    const after = await request(app).get(`/api/public/verify/${cert.certNo}`);
    expect(after.body.valid).toBe(false);
    expect(after.body.status).toBe('CANCELLED');
    expect(after.body.cancelReason).toBe('Issued by mistake');
  });

  it('only the state office can cancel', async () => {
    const batchId = await approvedBatch(3);
    const [id] = await issueCertificates(batchId);
    for (const name of ['Anika', 'Dev', 'Neha']) {
      const u = await userByName(name);
      const res = await request(app).post(`/api/state/certificates/${id}/cancel`).set('Authorization', `Bearer ${signToken(u.id)}`).send({ reason: 'trying' });
      expect(res.status).toBe(403);
    }
    const farah = await userByName('Farah');
    const ok = await request(app).post(`/api/state/certificates/${id}/cancel`).set('Authorization', `Bearer ${signToken(farah.id)}`).send({ reason: 'Fake' });
    expect(ok.status).toBe(200);
    expect((await prisma.certificate.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED');
    expect(await prisma.auditLog.count({ where: { entityId: id, action: 'CERTIFICATE_CANCELLED' } })).toBe(1);
  });

  it('a cancelled certificate is not delivered and cannot be downloaded', async () => {
    const batchId = await approvedBatch(3);
    const [id] = await issueCertificates(batchId);
    const cert = await prisma.certificate.findUniqueOrThrow({ where: { id } });
    await cancelCertificate(await userByName('Farah'), id, 'Fake');
    expect(await deliverCertificate(id)).toBe('skipped');
    expect(await prisma.providerMessage.count()).toBe(0);
    const res = await request(app).get(`/api/public/certificates/${cert.certNo}/download?token=${cert.downloadToken}`);
    expect(res.status).toBe(410);
  });
});

describe('Public verification and download: no leaks', () => {
  it('verify returns a masked name and never a phone number', async () => {
    const batchId = await approvedBatch(3);
    await issueCertificates(batchId);
    const cert = await prisma.certificate.findFirstOrThrow({ include: { candidate: true } });
    const res = await request(app).get(`/api/public/verify/${cert.certNo}`);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(cert.candidate.phone);
    expect(text).not.toContain(cert.candidate.name);
    expect(res.body.holder).toMatch(/\*/);
  });

  it('unknown and malformed numbers are handled', async () => {
    expect((await request(app).get('/api/public/verify/PRG-2026-AAAAA-BBBBB')).status).toBe(404);
    expect((await request(app).get('/api/public/verify/not-a-number')).status).toBe(400);
  });

  it('download needs the secret token', async () => {
    const batchId = await approvedBatch(3);
    await issueCertificates(batchId);
    const cert = await prisma.certificate.findFirstOrThrow();
    expect((await request(app).get(`/api/public/certificates/${cert.certNo}/download`)).status).toBe(400);
    expect((await request(app).get(`/api/public/certificates/${cert.certNo}/download?token=${'a'.repeat(48)}`)).status).toBe(404);
    const ok = await request(app).get(`/api/public/certificates/${cert.certNo}/download?token=${cert.downloadToken}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('application/pdf');
    expect((ok.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });
});

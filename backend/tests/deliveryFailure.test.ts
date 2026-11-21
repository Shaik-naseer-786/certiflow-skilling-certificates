import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/queue.js', () => ({
  enqueueIssuance: vi.fn(),
  enqueueDelivery: vi.fn(),
  removeDeliveryJob: vi.fn(),
}));

import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { handleDeliveryFailure } from '../src/jobs/processors.js';
import { signToken } from '../src/middleware/auth.js';
import { setProviderBehaviour } from '../src/providers/fakeWhatsapp.js';
import { enqueueDelivery, removeDeliveryJob } from '../src/queue.js';
import { issueCertificates } from '../src/services/certificateService.js';
import { deliverCertificate } from '../src/services/deliveryService.js';
import { approvedBatch, resetDb, userByName } from './helpers.js';

const app = createApp();

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  config.whatsapp.callTimeoutMs = 50;
  setProviderBehaviour({ rng: Math.random, failRate: 0, timeoutRate: 0, timeoutDelayMs: 100 });
});

async function oneCertificate() {
  const batchId = await approvedBatch(3);
  const [id] = await issueCertificates(batchId);
  return id;
}
const certOf = (id: string) => prisma.certificate.findUniqueOrThrow({ where: { id } });

describe('Delivery that keeps failing ends up FAILED (and is visible)', () => {
  it('stays PENDING while attempts remain, and becomes FAILED only after the LAST attempt', async () => {
    const id = await oneCertificate();

    expect(await handleDeliveryFailure(id, 1, 'WhatsApp provider error 503', 3)).toBe(false);
    expect(await handleDeliveryFailure(id, 2, 'WhatsApp provider error 503', 3)).toBe(false);
    expect((await certOf(id)).deliveryStatus).toBe('PENDING');

    expect(await handleDeliveryFailure(id, 3, 'WhatsApp provider error 503', 3)).toBe(true);
    const cert = await certOf(id);
    expect(cert.deliveryStatus).toBe('FAILED');
    expect(cert.lastError).toMatch(/503/);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: 'DELIVERY_FAILED' } })).toBe(1);
  });

  it('reporting the same failure twice writes only one audit row', async () => {
    const id = await oneCertificate();
    await handleDeliveryFailure(id, 3, 'boom', 3);
    await handleDeliveryFailure(id, 3, 'boom', 3);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: 'DELIVERY_FAILED' } })).toBe(1);
  });

  it('full path: every attempt fails, the attempts are counted, then FAILED; a FAILED certificate is not sent again', async () => {
    setProviderBehaviour({ failRate: 1 });
    const id = await oneCertificate();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const err = await deliverCertificate(id).catch((e) => e);
      expect(err.message).toMatch(/503/);
      await handleDeliveryFailure(id, attempt, err.message, 3);
    }
    const cert = await certOf(id);
    expect(cert.deliveryStatus).toBe('FAILED');
    expect(cert.deliveryAttempts).toBe(3);

    setProviderBehaviour({ failRate: 0 });
    expect(await deliverCertificate(id)).toBe('skipped'); // only a human can reset it
    expect(await prisma.providerMessage.count()).toBe(0);
  });
});

describe('State office can retry a FAILED delivery', () => {
  const retry = async (who: string, id: string) =>
    request(app).post(`/api/state/certificates/${id}/retry-delivery`).set('Authorization', `Bearer ${signToken((await userByName(who)).id)}`);

  it('resets it to PENDING, removes the old failed job and queues a new one', async () => {
    const id = await oneCertificate();
    await prisma.certificate.update({ where: { id }, data: { deliveryStatus: 'FAILED', deliveryAttempts: 6, lastError: 'boom' } });

    const res = await retry('Farah', id);

    expect(res.status).toBe(200);
    const cert = await certOf(id);
    expect(cert.deliveryStatus).toBe('PENDING');
    expect(cert.deliveryAttempts).toBe(0);
    expect(cert.lastError).toBeNull();
    expect(removeDeliveryJob).toHaveBeenCalledWith(id); // otherwise BullMQ would ignore the new job (same id)
    expect(enqueueDelivery).toHaveBeenCalledWith(id);
    expect(await deliverCertificate(id)).toBe('sent'); // and it now goes through
  });

  it('only the state office may retry', async () => {
    const id = await oneCertificate();
    await prisma.certificate.update({ where: { id }, data: { deliveryStatus: 'FAILED' } });
    for (const who of ['Anika', 'Dev', 'Neha']) expect((await retry(who, id)).status).toBe(403);
    expect((await certOf(id)).deliveryStatus).toBe('FAILED');
  });

  it('retrying a certificate that was already SENT changes nothing', async () => {
    const id = await oneCertificate();
    await deliverCertificate(id);
    await retry('Farah', id);
    expect((await certOf(id)).deliveryStatus).toBe('SENT');
  });
});

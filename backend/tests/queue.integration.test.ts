import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import IORedis from 'ioredis';

// REAL BullMQ + REAL Redis: nothing is mocked here. Needs Redis (docker compose up -d redis).
// Uses queue prefix "certiflow-test", so it never touches jobs of a running system.

import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { startWorkers } from '../src/jobs/workers.js';
import { runMaintenance } from '../src/jobs/processors.js';
import { setProviderBehaviour } from '../src/providers/fakeWhatsapp.js';
import { closeQueues, enqueueDelivery, enqueueIssuance, purgeQueues, removeDeliveryJob } from '../src/queue.js';
import { resetDelivery } from '../src/services/deliveryService.js';
import { approvedBatch, resetDb, seededRng } from './helpers.js';

const redisUp = await new Promise<boolean>((resolve) => {
  const r = new IORedis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
  r.on('error', () => undefined);
  r.connect()
    .then(() => r.ping())
    .then(() => resolve(true), () => resolve(false))
    .finally(() => r.disconnect());
});
if (!redisUp) console.warn('\n[queue.integration] Redis not reachable at', config.redisUrl, '-> these tests are SKIPPED. Run: docker compose up -d redis\n');

async function waitFor(check: () => Promise<boolean>, ms = 25_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('timed out waiting for the workers');
}
const countBy = (batchId: string, deliveryStatus: 'SENT' | 'FAILED') => prisma.certificate.count({ where: { batchId, deliveryStatus } });

describe.skipIf(!redisUp)('Real queue: BullMQ + Redis', () => {
  let workers: ReturnType<typeof startWorkers> | undefined;

  beforeEach(async () => {
    await resetDb();
    await purgeQueues();
    config.whatsapp.callTimeoutMs = 100;
    config.whatsapp.backoffMs = 20; // fast retries for the test
    config.whatsapp.maxAttempts = 8;
    setProviderBehaviour({ rng: seededRng(7), failRate: 0.3, timeoutRate: 0.1, timeoutDelayMs: 300 });
    workers = startWorkers();
  });
  afterEach(async () => {
    await workers?.close();
    await purgeQueues();
  });
  afterAll(async () => {
    await closeQueues();
  });

  it('approved batch -> certificates -> WhatsApp, through the real queue with a flaky provider', async () => {
    const batchId = await approvedBatch(12);
    await enqueueIssuance(batchId);

    await waitFor(async () => (await countBy(batchId, 'SENT')) === 12);

    expect(await prisma.providerMessage.count()).toBe(12); // exactly one message per certificate
    const attempts = await prisma.certificate.aggregate({ where: { batchId }, _sum: { deliveryAttempts: true } });
    expect(attempts._sum.deliveryAttempts).toBeGreaterThan(12); // retries really happened
  });

  it('adding the same issuance job again and again still gives exactly one certificate each', async () => {
    const batchId = await approvedBatch(6);
    await Promise.all([enqueueIssuance(batchId), enqueueIssuance(batchId), enqueueIssuance(batchId)]);
    await waitFor(async () => (await countBy(batchId, 'SENT')) === 6);

    expect(await prisma.certificate.count({ where: { batchId } })).toBe(6);
    expect(await prisma.auditLog.count({ where: { action: 'CERTIFICATE_ISSUED' } })).toBe(6);
    expect(await prisma.providerMessage.count()).toBe(6);
  });

  it('a provider that always fails: after the last attempt the certificate is FAILED; Retry then delivers it', async () => {
    config.whatsapp.maxAttempts = 3;
    setProviderBehaviour({ failRate: 1, timeoutRate: 0 });
    const batchId = await approvedBatch(3);
    await enqueueIssuance(batchId);

    await waitFor(async () => (await countBy(batchId, 'FAILED')) === 3);

    const certs = await prisma.certificate.findMany({ where: { batchId } });
    expect(certs.every((c) => c.deliveryAttempts === 3 && /503/.test(c.lastError ?? ''))).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'DELIVERY_FAILED' } })).toBe(3);
    expect(await prisma.providerMessage.count()).toBe(0);

    // The state office presses Retry (same steps as the route does) after WhatsApp is back.
    setProviderBehaviour({ failRate: 0 });
    for (const c of certs) {
      await resetDelivery(c.id);
      await removeDeliveryJob(c.id);
      await enqueueDelivery(c.id);
    }
    await waitFor(async () => (await countBy(batchId, 'SENT')) === 3);
    expect(await prisma.providerMessage.count()).toBe(3);
  });

  it('sweeper rescues a batch whose issuance job was never queued (crash after commit / Redis wiped)', async () => {
    setProviderBehaviour({ failRate: 0, timeoutRate: 0 });
    const batchId = await approvedBatch(5); // approved in the database, but NOTHING was enqueued

    await new Promise((r) => setTimeout(r, 500));
    expect(await prisma.certificate.count({ where: { batchId } })).toBe(0); // proves it is stuck

    const result = await runMaintenance(); // what the worker does every minute
    expect(result.swept.batches).toBe(1);

    await waitFor(async () => (await countBy(batchId, 'SENT')) === 5);
  });
});

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config.js';

// BullMQ stores jobs in Redis. Three queues:
//   issuance    - "make certificates for this approved batch"
//   delivery    - "send this one certificate over WhatsApp"
//   maintenance - repeating housekeeping (escalation + sweeper)
export const QUEUES = { issuance: 'issuance', delivery: 'delivery', maintenance: 'maintenance' } as const;

let connection: IORedis | undefined;
export function redis() {
  // maxRetriesPerRequest must be null for BullMQ workers
  connection ??= new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  return connection;
}

// The prefix keeps different environments (and the automated tests) in separate key spaces.
export const queueOptions = () => ({ connection: redis(), prefix: config.queuePrefix });

const queues = new Map<string, Queue>();
function queue(name: string) {
  if (!queues.has(name)) queues.set(name, new Queue(name, queueOptions()));
  return queues.get(name)!;
}

// jobId makes enqueueing idempotent: adding the same id twice is ignored by BullMQ.
// (BullMQ job ids may not contain ':' so we use '-'.)
export async function enqueueIssuance(batchId: string) {
  await queue(QUEUES.issuance).add('issue-batch', { batchId }, {
    jobId: `issue-${batchId}`,
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
}

// Settings are read when the job is added, so they can be changed without a restart.
export async function enqueueDelivery(certId: string) {
  await queue(QUEUES.delivery).add('deliver', { certId }, {
    jobId: `deliver-${certId}`,
    attempts: config.whatsapp.maxAttempts,
    backoff: { type: 'exponential', delay: config.whatsapp.backoffMs }, // 1s, 2s, 4s, 8s...
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
}

// A retry of a FAILED certificate must be a NEW job: the old job with the same id is still stored.
export async function removeDeliveryJob(certId: string) {
  await (await queue(QUEUES.delivery).getJob(`deliver-${certId}`))?.remove().catch(() => undefined);
}

// Registers the repeating maintenance job. Safe to call on every worker start.
export async function scheduleMaintenance() {
  await queue(QUEUES.maintenance).upsertJobScheduler('maintenance-tick', { every: 60_000 }, { name: 'tick' });
}

// Used by tests: wipe all jobs of this prefix, or close connections so the process can exit.
export async function purgeQueues() {
  for (const name of Object.values(QUEUES)) await queue(name).obliterate({ force: true }).catch(() => undefined);
}
export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  await connection?.quit().catch(() => undefined);
  connection = undefined;
}

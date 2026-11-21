import { Worker } from 'bullmq';
import { QUEUES, queueOptions } from '../queue.js';
import { handleDeliveryFailure, processDelivery, processIssuance, runMaintenance } from './processors.js';

// Starts the BullMQ workers (the parts that pull jobs from Redis).
// Returns close() so tests can shut them down.
export function startWorkers() {
  const opts = queueOptions();

  const issuance = new Worker(QUEUES.issuance, (job) => processIssuance(job.data), opts);

  const delivery = new Worker(QUEUES.delivery, (job) => processDelivery(job.data, job.attemptsMade + 1), { ...opts, concurrency: 10 });
  delivery.on('failed', (job, err) => {
    if (job) handleDeliveryFailure(job.data.certId, job.attemptsMade, err.message).catch(() => undefined);
  });

  const maintenance = new Worker(QUEUES.maintenance, () => runMaintenance(), opts);

  const all = [issuance, delivery, maintenance];
  return { close: () => Promise.all(all.map((w) => w.close())) };
}

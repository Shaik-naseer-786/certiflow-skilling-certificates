import { enqueueDelivery } from '../queue.js';
import { config } from '../config.js';
import { issueCertificates } from '../services/certificateService.js';
import { deliverCertificate, markDeliveryFailed } from '../services/deliveryService.js';
import { escalateStaleBatches } from '../services/escalationService.js';
import { sweep } from './sweeper.js';
import { log } from '../log.js';

// The actual work of each job type, kept apart from BullMQ so it can be tested directly.

// Issue certificates for an approved batch, then fan out one delivery job per certificate.
export async function processIssuance(data: { batchId: string }) {
  const pendingIds = await issueCertificates(data.batchId);
  for (const id of pendingIds) await enqueueDelivery(id);
  log('issued', { batchId: data.batchId, deliveriesQueued: pendingIds.length });
}

// One delivery attempt. Throwing makes BullMQ retry with backoff.
export async function processDelivery(data: { certId: string }, attempt: number) {
  const result = await deliverCertificate(data.certId);
  log('delivery', { certId: data.certId, result, attempt });
}

// BullMQ tells us a job failed. Only when it has used ALL its attempts is the
// certificate marked FAILED (so the state office can see it and press Retry).
export async function handleDeliveryFailure(certId: string, attemptsMade: number, error: string, maxAttempts = config.whatsapp.maxAttempts) {
  log('delivery-failed', { certId, attempt: attemptsMade, error });
  if (attemptsMade >= maxAttempts) {
    await markDeliveryFailed(certId, error);
    return true;
  }
  return false;
}

// Runs every minute.
export async function runMaintenance() {
  const escalated = await escalateStaleBatches();
  const swept = await sweep();
  if (escalated.length || swept.batches || swept.certificates) log('maintenance', { escalated, swept });
  return { escalated, swept };
}

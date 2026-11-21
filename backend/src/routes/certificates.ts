import { Router } from 'express';
import { z } from 'zod';
import { idOf } from '../errors.js';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { cancelCertificate } from '../services/certificateService.js';
import { resetDelivery } from '../services/deliveryService.js';
import { enqueueDelivery, removeDeliveryJob } from '../queue.js';

// State-office tools. Everything here is STATE only.
export const certificateRouter = Router();
certificateRouter.use(authenticate, requireRole('STATE'));

certificateRouter.post('/certificates/:id/cancel', async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
  const cert = await cancelCertificate(req.user!, idOf(req), reason);
  res.json({ certificate: { id: cert.id, certNo: cert.certNo, status: cert.status } });
});

certificateRouter.post('/certificates/:id/retry-delivery', async (req, res) => {
  const id = idOf(req);
  await resetDelivery(id);
  // The old (failed) job still exists under the same id and BullMQ would ignore a new one, so remove it first.
  await Promise.resolve(removeDeliveryJob(id)).catch(() => undefined);
  // If Redis is down the certificate is already PENDING again, and the sweeper will queue it later.
  await Promise.resolve(enqueueDelivery(id)).catch(() => undefined);
  res.json({ ok: true });
});

// Batches that sat too long with an officer.
certificateRouter.get('/stuck', async (_req, res) => {
  const batches = await prisma.batch.findMany({
    where: { status: 'IN_REVIEW', escalatedAt: { not: null } },
    orderBy: { stageEnteredAt: 'asc' },
    include: { centre: { select: { name: true } }, _count: { select: { candidates: true } } },
  });
  res.json({ batches });
});

// Audit trail for one batch or certificate (also used by the UI to show history).
certificateRouter.get('/audit', async (req, res) => {
  const entityId = z.string().uuid().optional().parse(req.query.entityId);
  const logs = await prisma.auditLog.findMany({ where: entityId ? { entityId } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
  res.json({ logs });
});

// What the (fake) WhatsApp provider has delivered: lets reviewers see "the phone".
certificateRouter.get('/whatsapp-messages', async (_req, res) => {
  const messages = await prisma.providerMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ messages });
});

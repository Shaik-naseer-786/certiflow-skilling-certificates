import { Router } from 'express';
import { baseUrlOf } from '../http.js';
import multer from 'multer';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { AppError, idOf } from '../errors.js';
import { createBatch, getBatchDetail, listBatches, submitBatch, uploadCandidates } from '../services/batchService.js';
import { decide } from '../services/approvalService.js';
import { enqueueIssuance } from '../queue.js';
import { prisma } from '../db.js';
import { batchVisibility } from '../services/access.js';
import { renderPdf } from '../services/certificateService.js';

export const batchRouter = Router();
batchRouter.use(authenticate);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

batchRouter.get('/', async (req, res) => {
  res.json({ batches: await listBatches(req.user!) });
});

batchRouter.post('/', requireRole('CENTRE'), async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(3).max(100) }).parse(req.body);
  res.status(201).json({ batch: await createBatch(req.user!, name) });
});

batchRouter.get('/:id', async (req, res) => {
  const batch = await getBatchDetail(req.user!, idOf(req));
  // Extra: certificates are shown to anyone who can see the batch
  const certificates = await prisma.certificate.findMany({
    where: { batchId: batch.id },
    orderBy: { issuedAt: 'asc' },
    select: { id: true, certNo: true, status: true, deliveryStatus: true, deliveryAttempts: true, lastError: true, cancelReason: true, candidate: { select: { name: true } } },
  });
  res.json({ batch, certificates });
});

batchRouter.post('/:id/upload', requireRole('CENTRE'), upload.single('file'), async (req, res) => {
  if (!req.file) throw new AppError(400, 'Attach an .xlsx file in the "file" field');
  res.json(await uploadCandidates(req.user!, idOf(req), req.file.buffer));
});

batchRouter.post('/:id/submit', requireRole('CENTRE'), async (req, res) => {
  res.json({ batch: await submitBatch(req.user!, idOf(req)) });
});

const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT', 'SEND_BACK']), reason: z.string().trim().max(500).optional() });

batchRouter.post('/:id/decision', requireRole('DISTRICT_OFFICER', 'QUALITY', 'STATE'), async (req, res) => {
  const { decision, reason } = decisionSchema.parse(req.body);
  const result = await decide(req.user!, idOf(req), decision, reason);
  // After the database transaction has committed, ask the worker to issue certificates.
  // If this call is lost (crash, Redis down) the sweeper job finds the batch later.
  if (result.fullyApproved) await Promise.resolve(enqueueIssuance(result.batchId)).catch(() => undefined);
  res.json(result);
});

// Staff download of a certificate PDF (centre owner, officers of that district, quality, state).
// Same visibility rule as the batch itself; candidates use the token link from WhatsApp instead.
batchRouter.get('/certificates/:id/pdf', async (req, res) => {
  const cert = await prisma.certificate.findFirst({
    where: { id: idOf(req), batch: batchVisibility(req.user!) },
  });
  if (!cert) throw new AppError(404, 'Certificate not found');
  if (cert.status === 'CANCELLED') throw new AppError(410, 'This certificate has been cancelled');
  const pdf = await renderPdf(cert.id, baseUrlOf(req));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${cert.certNo}.pdf"`, 'Cache-Control': 'private, no-store' });
  res.send(pdf);
});

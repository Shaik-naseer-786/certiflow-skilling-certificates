import crypto from 'node:crypto';
import { baseUrlOf } from '../http.js';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';
import { renderPdf, verifyCertificate } from '../services/certificateService.js';

// No login needed here. Only minimal, non-sensitive data leaves through these routes.
export const publicRouter = Router();

const certNoSchema = z.string().regex(/^PRG-\d{4}-[A-Z2-9]{5}-[A-Z2-9]{5}$/, 'Invalid certificate number');

publicRouter.get('/verify/:certNo', async (req, res) => {
  const certNo = certNoSchema.parse(req.params.certNo.toUpperCase());
  const result = await verifyCertificate(certNo);
  if (!result) return res.status(404).json({ valid: false, error: 'No such certificate' });
  res.set('Cache-Control', 'no-store'); // a cancellation must show up immediately
  res.json(result);
});

// Download needs the secret token that was sent to the candidate's phone.
publicRouter.get('/certificates/:certNo/download', async (req, res) => {
  const certNo = certNoSchema.parse(req.params.certNo.toUpperCase());
  const token = z.string().min(10).max(200).parse(req.query.token);
  const cert = await prisma.certificate.findUnique({ where: { certNo } });
  // Same 404 for "no such certificate" and "wrong token": don't confirm which numbers exist.
  const a = Buffer.from(cert?.downloadToken ?? 'x'.repeat(48));
  const b = Buffer.from(token);
  const tokenOk = !!cert && a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!cert || !tokenOk) throw new AppError(404, 'Certificate not found');
  if (cert.status === 'CANCELLED') throw new AppError(410, 'This certificate has been cancelled');
  const pdf = await renderPdf(cert.id, baseUrlOf(req));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${cert.certNo}.pdf"`, 'Cache-Control': 'private, no-store' });
  res.send(pdf);
});

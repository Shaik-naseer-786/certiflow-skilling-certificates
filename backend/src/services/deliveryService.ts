import { prisma } from '../db.js';
import { config } from '../config.js';
import { sendWhatsApp } from '../providers/fakeWhatsapp.js';
import { downloadUrl, verifyUrl } from './certificateService.js';
import { writeAudit } from './audit.js';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`WhatsApp call timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// One delivery attempt. Throws on failure so the queue retries with backoff.
// Safe to repeat: already SENT => no-op, and the provider dedupes by certificate id.
export async function deliverCertificate(certId: string): Promise<'sent' | 'skipped'> {
  const cert = await prisma.certificate.findUnique({ where: { id: certId }, include: { candidate: true } });
  if (!cert || cert.status === 'CANCELLED' || cert.deliveryStatus !== 'PENDING') return 'skipped';

  await prisma.certificate.update({ where: { id: certId }, data: { deliveryAttempts: { increment: 1 } } });
  try {
    await withTimeout(
      sendWhatsApp({
        idempotencyKey: cert.id, // THE key that guarantees one message per certificate
        phone: cert.candidate.phone,
        body:
          `Congratulations ${cert.candidate.name}! Your Pragati Skills Mission certificate (${cert.certNo}) is ready.\n` +
          `Download: ${downloadUrl(cert.certNo, cert.downloadToken)}\nVerify: ${verifyUrl(cert.certNo)}`,
      }),
      config.whatsapp.callTimeoutMs,
    );
  } catch (e) {
    await prisma.certificate.update({ where: { id: certId }, data: { lastError: (e as Error).message } });
    throw e;
  }
  await prisma.$transaction(async (tx) => {
    await tx.certificate.update({ where: { id: certId }, data: { deliveryStatus: 'SENT', lastError: null } });
    await writeAudit(tx, null, 'CERTIFICATE_DELIVERED', 'Certificate', certId, { phone: cert.candidate.phone });
  });
  return 'sent';
}

// Called when the queue has given up (all attempts used).
export async function markDeliveryFailed(certId: string, error: string) {
  await prisma.$transaction(async (tx) => {
    const res = await tx.certificate.updateMany({
      where: { id: certId, deliveryStatus: 'PENDING' },
      data: { deliveryStatus: 'FAILED', lastError: error },
    });
    if (res.count) await writeAudit(tx, null, 'DELIVERY_FAILED', 'Certificate', certId, { error });
  });
}

// State office can push a FAILED certificate back to PENDING to retry it.
export async function resetDelivery(certId: string) {
  await prisma.certificate.updateMany({
    where: { id: certId, deliveryStatus: 'FAILED' },
    data: { deliveryStatus: 'PENDING', deliveryAttempts: 0, lastError: null },
  });
}

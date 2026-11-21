import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { writeAudit } from './audit.js';
import type { AuthUser } from './access.js';

// Unambiguous characters only (no 0/O, 1/I) so numbers can be read out over a phone.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCertNo() {
  const bytes = crypto.randomBytes(10);
  const part = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `PRG-${new Date().getFullYear()}-${part.slice(0, 5)}-${part.slice(5)}`;
}

// Creates one certificate for every candidate of an approved batch that has none yet.
// SAFE TO RUN ANY NUMBER OF TIMES: Certificate.candidateId is UNIQUE, so a repeat
// (job retry, two workers, sweeper) can never create a second certificate.
// Returns the ids of certificates still waiting to be delivered.
export async function issueCertificates(batchId: string): Promise<string[]> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { candidates: { include: { certificate: true } } },
  });
  if (!batch) throw notFound('Batch');
  if (batch.status !== 'APPROVED') throw conflict('Batch is not approved');

  for (const c of batch.candidates) {
    if (c.certificate) continue;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await prisma.$transaction(async (tx) => {
          const cert = await tx.certificate.create({
            data: { certNo: randomCertNo(), candidateId: c.id, batchId, phone: c.phone, course: c.course, downloadToken: crypto.randomBytes(24).toString('hex') },
          });
          await writeAudit(tx, null, 'CERTIFICATE_ISSUED', 'Certificate', cert.id, { certNo: cert.certNo, batchId });
        });
        break;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
        const target = JSON.stringify(e.meta?.target ?? '');
        if (target.includes('certNo')) continue; // number collision (astronomically rare): draw a new number
        if (target.includes('candidateId')) break; // someone else issued it first: fine
        // Anything else is the (phone, course) index: this person already holds a valid certificate
        // for this course, issued through another batch. Do NOT issue; leave a trace for the state office.
        await prisma.$transaction((tx) => writeAudit(tx, null, 'CERTIFICATE_SKIPPED_DUPLICATE', 'Batch', batchId, { candidateId: c.id, phone: c.phone, course: c.course }));
        break;
      }
    }
  }
  await prisma.batch.updateMany({ where: { id: batchId, issuedAt: null }, data: { issuedAt: new Date() } });
  const pending = await prisma.certificate.findMany({ where: { batchId, deliveryStatus: 'PENDING' }, select: { id: true } });
  return pending.map((p) => p.id);
}

export async function cancelCertificate(user: AuthUser, certId: string, reason: string) {
  if (!reason.trim()) throw badRequest('A reason is required');
  return prisma.$transaction(async (tx) => {
    const cert = await tx.certificate.findUnique({ where: { id: certId } });
    if (!cert) throw notFound('Certificate');
    if (cert.status === 'CANCELLED') return cert; // idempotent
    const updated = await tx.certificate.update({
      where: { id: certId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason.trim(), cancelledById: user.id },
    });
    await writeAudit(tx, user, 'CERTIFICATE_CANCELLED', 'Certificate', certId, { certNo: cert.certNo, reason });
    return updated;
  });
}

// "Ravi Kumar" -> "R*** K****": enough for an employer to match, not enough to leak identity.
const mask = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0] + '*'.repeat(Math.max(p.length - 1, 2)))
    .join(' ');

// Public check. Reads straight from the database (no cache) so a cancellation
// is visible on the very next request. Never returns phone numbers.
export async function verifyCertificate(certNo: string) {
  const cert = await prisma.certificate.findUnique({
    where: { certNo },
    include: { candidate: true, batch: { select: { district: true } } },
  });
  if (!cert) return null;
  return {
    certNo: cert.certNo,
    valid: cert.status === 'ISSUED',
    status: cert.status,
    holder: mask(cert.candidate.name),
    course: cert.candidate.course,
    district: cert.batch.district,
    issuedAt: cert.issuedAt,
    ...(cert.status === 'CANCELLED' ? { cancelledAt: cert.cancelledAt, cancelReason: cert.cancelReason } : {}),
  };
}

export const verifyUrl = (certNo: string, base = config.publicUrl) => `${base}/verify/${certNo}`;
export const downloadUrl = (certNo: string, token: string) =>
  `${config.publicUrl}/api/public/certificates/${certNo}/download?token=${token}`;

// Renders the certificate PDF with a QR code pointing at the public verify page.
export async function renderPdf(certId: string, base = config.publicUrl): Promise<Buffer> {
  const cert = await prisma.certificate.findUniqueOrThrow({ where: { id: certId }, include: { candidate: true, batch: true } });
  const qr = await QRCode.toBuffer(verifyUrl(cert.certNo, base), { width: 160, margin: 1 });

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 50, compress: process.env.NODE_ENV !== 'test' });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const w = doc.page.width;
  const h = doc.page.height;
  doc.rect(25, 25, w - 50, h - 50).lineWidth(3).stroke('#1e3a8a');
  doc.fontSize(14).fillColor('#555').text('PRAGATI SKILLS MISSION', 0, 70, { align: 'center' });
  doc.fontSize(34).fillColor('#1e3a8a').text('Certificate of Completion', 0, 100, { align: 'center' });
  doc.fontSize(14).fillColor('#333').text('This is to certify that', 0, 170, { align: 'center' });
  doc.fontSize(28).fillColor('#000').text(cert.candidate.name, 0, 195, { align: 'center' });
  doc.fontSize(14).fillColor('#333').text('has successfully completed the course', 0, 245, { align: 'center' });
  doc.fontSize(20).fillColor('#000').text(cert.candidate.course, 0, 270, { align: 'center' });
  doc.fontSize(12).fillColor('#333').text(`Score: ${cert.candidate.score}%   |   District: ${cert.batch.district}`, 0, 310, { align: 'center' });
  doc.image(qr, 60, h - 200, { width: 120 });
  doc.fontSize(10).fillColor('#333').text('Scan to verify', 60, h - 75, { width: 120, align: 'center' });
  doc.fontSize(8).fillColor('#555').text(verifyUrl(cert.certNo, base), 190, h - 150, { width: 300 }); // readable fallback if the QR cannot be scanned
  doc.fontSize(12).text(`Certificate No: ${cert.certNo}`, 0, h - 120, { align: 'right', width: w - 70 });
  doc.fontSize(10).text(`Issued: ${cert.issuedAt.toISOString().slice(0, 10)}`, 0, h - 100, { align: 'right', width: w - 70 });
  doc.end();
  return done;
}

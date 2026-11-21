import { prisma } from '../db.js';
import type { RowError } from './excel.js';

// Rule D11: one person (phone) gets ONE valid certificate per course, across ALL batches.
// A person may still hold certificates for DIFFERENT courses. A cancelled certificate
// does not count, so the person can be certified again.
//
// Two places already hold this person+course:
//   1. an ISSUED certificate
//   2. a candidate in ANOTHER batch that is under review, or approved but not yet issued
//
// This is the friendly check (tells the centre which row and why). The hard guarantee is
// the partial unique index on Certificate(phone, course) WHERE status = 'ISSUED'.

type Person = { rowNumber: number; phone: string; course: string };
const key = (phone: string, course: string) => `${phone}|${course.toLowerCase()}`;

export async function findCrossBatchDuplicates(batchId: string, people: Person[]): Promise<RowError[]> {
  if (people.length === 0) return [];
  const phones = [...new Set(people.map((p) => p.phone))];

  const [certs, inFlight] = await Promise.all([
    prisma.certificate.findMany({
      where: { status: 'ISSUED', phone: { in: phones } },
      select: { phone: true, course: true, certNo: true },
    }),
    prisma.candidate.findMany({
      where: {
        phone: { in: phones },
        batchId: { not: batchId },
        // under review, or approved but its certificate has not been created yet.
        // (Once a certificate exists, rule 1 above decides; a cancelled one must NOT block.)
        OR: [{ batch: { status: 'IN_REVIEW' } }, { batch: { status: 'APPROVED' }, certificate: null }],
      },
      select: { phone: true, course: true, batch: { select: { name: true, status: true } } },
    }),
  ]);

  const certBy = new Map(certs.map((c) => [key(c.phone, c.course), c.certNo]));
  const flightBy = new Map(inFlight.map((c) => [key(c.phone, c.course), c.batch]));

  const errors: RowError[] = [];
  for (const p of people) {
    const k = key(p.phone, p.course);
    if (certBy.has(k)) {
      errors.push({ row: p.rowNumber, field: 'Phone', message: `Already holds a valid ${p.course} certificate (${certBy.get(k)})` });
    } else if (flightBy.has(k)) {
      const b = flightBy.get(k)!;
      errors.push({ row: p.rowNumber, field: 'Phone', message: `Already in batch "${b.name}" (${b.status.toLowerCase().replace('_', ' ')}) for ${p.course}` });
    }
  }
  return errors;
}

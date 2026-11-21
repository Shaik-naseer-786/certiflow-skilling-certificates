import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/queue.js', () => ({ enqueueIssuance: vi.fn(), enqueueDelivery: vi.fn() }));

import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { signToken } from '../src/middleware/auth.js';
import { issueCertificates, verifyUrl } from '../src/services/certificateService.js';
import { baseUrlOf } from '../src/http.js';
import { approvedBatch, resetDb, userByName } from './helpers.js';

const app = createApp();
beforeEach(resetDb);

const asBinary = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

describe('Staff PDF download', () => {
  it('people who can see the batch get a PDF; strangers and the logged-out do not', async () => {
    const batchId = await approvedBatch(3);
    await issueCertificates(batchId);
    const cert = await prisma.certificate.findFirstOrThrow();
    const url = `/api/batches/certificates/${cert.id}/pdf`;
    const as = async (n: string) => `Bearer ${signToken((await userByName(n)).id)}`;

    const ok = await asBinary(request(app).get(url).set('Authorization', await as('Anika')));
    expect(ok.status).toBe(200);
    expect((ok.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect((await request(app).get(url).set('Authorization', await as('Farah'))).status).toBe(200);
    expect((await request(app).get(url).set('Authorization', await as('Rohan'))).status).toBe(404); // other centre
    expect((await request(app).get(url).set('Authorization', await as('Ishaan'))).status).toBe(404); // other district
    expect((await request(app).get(url)).status).toBe(401);
  });
});

describe('QR link host', () => {
  it('builds links from the address the caller used, not a fixed localhost', () => {
    const req = { protocol: 'http', get: (h: string) => (h === 'host' ? '192.168.1.50:8080' : undefined) } as never;
    expect(baseUrlOf(req)).toBe('http://192.168.1.50:8080');
    expect(verifyUrl('PRG-2026-AAAAA-BBBBB', baseUrlOf(req))).toBe('http://192.168.1.50:8080/verify/PRG-2026-AAAAA-BBBBB');
    expect(verifyUrl('PRG-2026-AAAAA-BBBBB')).toContain('/verify/PRG-2026'); // default still works for WhatsApp links
  });

  it('the download endpoint still works when called through another host name', async () => {
    const batchId = await approvedBatch(3);
    await issueCertificates(batchId);
    const cert = await prisma.certificate.findFirstOrThrow();
    const url = `/api/public/certificates/${cert.certNo}/download?token=${cert.downloadToken}`;
    const res = await asBinary(request(app).get(url).set('Host', '192.168.1.50:8080'));
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });
});

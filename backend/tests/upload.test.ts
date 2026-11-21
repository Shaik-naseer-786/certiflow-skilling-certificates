import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/queue.js', () => ({ enqueueIssuance: vi.fn(), enqueueDelivery: vi.fn() }));

import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { signToken } from '../src/middleware/auth.js';
import { validateRows } from '../src/services/excel.js';
import { goodRows, makeXlsx, resetDb, userByName } from './helpers.js';

const app = createApp();

async function setup() {
  const anika = await userByName('Anika');
  const created = await request(app).post('/api/batches').set('Authorization', `Bearer ${signToken(anika.id)}`).send({ name: 'May batch' });
  return { token: signToken(anika.id), batchId: created.body.batch.id as string };
}

beforeEach(resetDb);

describe('Moment 1: spreadsheet with bad rows', () => {
  it('reports every bad row and saves nothing', async () => {
    const { token, batchId } = await setup();
    const rows = goodRows(5);
    rows[1].Phone = '12345'; // row 3 in the sheet
    rows[3].Name = ''; // row 5
    rows[4].Score = 12; // row 6, below pass mark
    const file = await makeXlsx(rows);

    const res = await request(app).post(`/api/batches/${batchId}/upload`).set('Authorization', `Bearer ${token}`).attach('file', file, 'b.xlsx');

    expect(res.status).toBe(422);
    expect(res.body.errors.map((e: { row: number; field: string }) => `${e.row}:${e.field}`).sort()).toEqual(['3:Phone', '5:Name', '6:Score']);
    expect(await prisma.candidate.count()).toBe(0); // nothing half-saved: even the 2 good rows are not stored
  });

  it('keeps the previous candidates when a re-upload is rejected', async () => {
    const { token, batchId } = await setup();
    await request(app).post(`/api/batches/${batchId}/upload`).set('Authorization', `Bearer ${token}`).attach('file', await makeXlsx(goodRows(4)), 'a.xlsx');
    const bad = goodRows(3);
    bad[0].Phone = 'abc';
    const res = await request(app).post(`/api/batches/${batchId}/upload`).set('Authorization', `Bearer ${token}`).attach('file', await makeXlsx(bad), 'b.xlsx');
    expect(res.status).toBe(422);
    expect(await prisma.candidate.count()).toBe(4);
  });

  it('saves a clean sheet and re-upload replaces the list', async () => {
    const { token, batchId } = await setup();
    const up = (n: number) => makeXlsx(goodRows(n)).then((f) => request(app).post(`/api/batches/${batchId}/upload`).set('Authorization', `Bearer ${token}`).attach('file', f, 'a.xlsx'));
    expect((await up(6)).body.saved).toBe(6);
    expect((await up(3)).body.saved).toBe(3);
    expect(await prisma.candidate.count()).toBe(3);
  });

  it('rejects a file that is not a spreadsheet', async () => {
    const { token, batchId } = await setup();
    const res = await request(app).post(`/api/batches/${batchId}/upload`).set('Authorization', `Bearer ${token}`).attach('file', Buffer.from('hello'), 'x.xlsx');
    expect(res.status).toBe(400);
  });

  it('rejects a sheet with missing columns', async () => {
    const { token, batchId } = await setup();
    const file = await makeXlsx([{ Name: 'Asha Rao', Phone: '9876543210' }], ['Name', 'Phone']);
    const res = await request(app).post(`/api/batches/${batchId}/upload`).set('Authorization', `Bearer ${token}`).attach('file', file, 'x.xlsx');
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Missing column/);
  });
});

describe('validateRows', () => {
  const row = (over: Partial<Record<'name' | 'phone' | 'course' | 'score', string>> = {}, rowNumber = 2) => ({
    rowNumber, name: 'Asha Rao', phone: '9876543210', course: 'Welding', score: '75', ...over,
  });

  it('normalises +91 and spaces in phone numbers', () => {
    const { candidates, errors } = validateRows([row({ phone: '+91 98765-43210' })]);
    expect(errors).toEqual([]);
    expect(candidates[0].phone).toBe('9876543210');
  });

  it('flags duplicate phones inside the sheet', () => {
    const { errors } = validateRows([row({}, 2), row({ name: 'Bina Das' }, 3)]);
    expect(errors).toEqual([{ row: 3, field: 'Phone', message: 'Duplicate of row 2' }]);
  });

  it('flags scores outside 0-100 or below pass mark', () => {
    expect(validateRows([row({ score: '101' })]).errors).toHaveLength(1);
    expect(validateRows([row({ score: 'abc' })]).errors).toHaveLength(1);
    expect(validateRows([row({ score: '10' })]).errors[0].message).toMatch(/below the pass mark/);
  });
});

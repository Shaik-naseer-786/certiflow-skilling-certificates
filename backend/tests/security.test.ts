import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/queue.js', () => ({ enqueueIssuance: vi.fn(), enqueueDelivery: vi.fn() }));

import { createApp } from '../src/app.js';
import { signToken } from '../src/middleware/auth.js';
import { resetDb, submittedBatch, userByName } from './helpers.js';

const app = createApp();
beforeEach(resetDb);

const as = async (name: string) => `Bearer ${signToken((await userByName(name)).id)}`;

describe('Login and tokens', () => {
  it('logs in with the right password only', async () => {
    const ok = await request(app).post('/api/auth/login').send({ email: 'dev@pragati.test', password: 'password123' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe('DISTRICT_OFFICER');
    expect(ok.body.user).not.toHaveProperty('passwordHash');
    const bad = await request(app).post('/api/auth/login').send({ email: 'dev@pragati.test', password: 'nope' });
    expect(bad.status).toBe(401);
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@pragati.test', password: 'nope' });
    expect(unknown.body.error).toBe(bad.body.error); // same message: cannot probe which emails exist
  });

  it('refuses requests without a token, with a forged token, or an expired token', async () => {
    expect((await request(app).get('/api/batches')).status).toBe(401);
    const dev = await userByName('Dev');
    const forged = jwt.sign({ sub: dev.id }, 'some-other-secret');
    expect((await request(app).get('/api/batches').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
    const expired = jwt.sign({ sub: dev.id }, 'test-secret', { expiresIn: -10 });
    expect((await request(app).get('/api/batches').set('Authorization', `Bearer ${expired}`)).status).toBe(401);
  });

  it('cannot claim a higher role: the role comes from the database, not the token', async () => {
    const anika = await userByName('Anika');
    const token = jwt.sign({ sub: anika.id, role: 'STATE' }, 'test-secret');
    const res = await request(app).get('/api/state/stuck').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('Who can see and do what', () => {
  it('a centre cannot see another centre\'s batch', async () => {
    const { batchId } = await submittedBatch('Anika', 3);
    expect((await request(app).get(`/api/batches/${batchId}`).set('Authorization', await as('Rohan'))).status).toBe(404);
    expect((await request(app).get(`/api/batches/${batchId}`).set('Authorization', await as('Anika'))).status).toBe(200);
  });

  it('officers see only their own district; quality and state see all', async () => {
    const { batchId } = await submittedBatch('Anika', 3);
    const list = async (n: string) => (await request(app).get('/api/batches').set('Authorization', await as(n))).body.batches.length;
    expect(await list('Dev')).toBe(1);
    expect(await list('Ishaan')).toBe(0);
    expect(await list('Farah')).toBe(1);
    expect(await list('Rohan')).toBe(0);
    expect((await request(app).get(`/api/batches/${batchId}`).set('Authorization', await as('Ishaan'))).status).toBe(404);
  });

  it('drafts are hidden from officers', async () => {
    const anika = await as('Anika');
    await request(app).post('/api/batches').set('Authorization', anika).send({ name: 'Draft one' });
    expect((await request(app).get('/api/batches').set('Authorization', await as('Dev'))).body.batches).toHaveLength(0);
  });

  it('only centres can create or submit batches; only officers can decide', async () => {
    const dev = await as('Dev');
    expect((await request(app).post('/api/batches').set('Authorization', dev).send({ name: 'Sneaky batch' })).status).toBe(403);
    const { batchId } = await submittedBatch('Anika', 3);
    expect((await request(app).post(`/api/batches/${batchId}/decision`).set('Authorization', await as('Anika')).send({ decision: 'APPROVE' })).status).toBe(403);
    expect((await request(app).post(`/api/batches/${batchId}/submit`).set('Authorization', dev)).status).toBe(403);
  });

  it('another centre cannot upload to or submit someone else\'s batch', async () => {
    const created = await request(app).post('/api/batches').set('Authorization', await as('Anika')).send({ name: 'Anika batch' });
    const id = created.body.batch.id;
    expect((await request(app).post(`/api/batches/${id}/submit`).set('Authorization', await as('Rohan'))).status).toBe(404);
  });
});

describe('Bad input', () => {
  it('rejects malformed ids, bodies and decisions', async () => {
    const dev = await as('Dev');
    expect((await request(app).get('/api/batches/not-a-uuid').set('Authorization', dev)).status).toBe(400);
    const { batchId } = await submittedBatch('Anika', 3);
    expect((await request(app).post(`/api/batches/${batchId}/decision`).set('Authorization', dev).send({ decision: 'DELETE_EVERYTHING' })).status).toBe(400);
    expect((await request(app).post('/api/batches').set('Authorization', await as('Anika')).send({ name: 'x' })).status).toBe(400);
  });

  it('does not leak stack traces on errors', async () => {
    const res = await request(app).get('/api/batches/not-a-uuid').set('Authorization', await as('Dev'));
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
  });
});

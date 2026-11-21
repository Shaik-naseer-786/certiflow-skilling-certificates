import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/queue.js', () => ({ enqueueIssuance: vi.fn(), enqueueDelivery: vi.fn(), removeDeliveryJob: vi.fn() }));

import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { signToken } from '../src/middleware/auth.js';
import { resetDb, userByName } from './helpers.js';

const original = { ...config.rateLimit };
beforeEach(resetDb);
afterEach(() => Object.assign(config.rateLimit, original));

describe('Rate limits', () => {
  it('login: too many attempts from one address get 429 (password guessing is slowed down)', async () => {
    config.rateLimit.login = 3;
    const app = createApp();
    const attempt = () => request(app).post('/api/auth/login').send({ email: 'dev@pragati.test', password: 'wrong' });

    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Too many requests/);
    expect(blocked.headers['ratelimit-limit']).toBe('3');
  });

  it('login limit also blocks a CORRECT password once the limit is used up', async () => {
    config.rateLimit.login = 2;
    const app = createApp();
    const login = (password: string) => request(app).post('/api/auth/login').send({ email: 'dev@pragati.test', password });
    await login('x');
    await login('y');
    expect((await login('password123')).status).toBe(429);
  });

  it('public verification: bursts get 429', async () => {
    config.rateLimit.public = 5;
    const app = createApp();
    const check = () => request(app).get('/api/public/verify/PRG-2026-AAAAA-BBBBB');
    for (let i = 0; i < 5; i++) expect((await check()).status).toBe(404);
    expect((await check()).status).toBe(429);
  });

  it('logged-in API: limited too', async () => {
    config.rateLimit.api = 4;
    const app = createApp();
    const token = signToken((await userByName('Dev')).id);
    const list = () => request(app).get('/api/batches').set('Authorization', `Bearer ${token}`);
    for (let i = 0; i < 4; i++) expect((await list()).status).toBe(200);
    expect((await list()).status).toBe(429);
  });

  it('limits are counted per app instance and reset with a new window (a fresh app starts at zero)', async () => {
    config.rateLimit.public = 1;
    const first = createApp();
    await request(first).get('/api/public/verify/PRG-2026-AAAAA-BBBBB');
    expect((await request(first).get('/api/public/verify/PRG-2026-AAAAA-BBBBB')).status).toBe(429);
    const second = createApp();
    expect((await request(second).get('/api/public/verify/PRG-2026-AAAAA-BBBBB')).status).toBe(404);
  });

  it('normal use is not affected by the default limits', async () => {
    const app = createApp();
    const token = signToken((await userByName('Dev')).id);
    for (let i = 0; i < 30; i++) expect((await request(app).get('/api/batches').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });
});

import { testDatabaseUrl } from './testDb.js';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.QUEUE_PREFIX = 'certiflow-test'; // never touch the real queues

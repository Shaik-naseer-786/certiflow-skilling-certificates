import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import multer from 'multer';
import { AppError } from './errors.js';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { batchRouter } from './routes/batches.js';
import { certificateRouter } from './routes/certificates.js';
import { publicRouter } from './routes/public.js';
import { log } from './log.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind nginx
  app.use(helmet());
  app.use(express.json({ limit: '100kb' })); // bad/huge JSON bodies are rejected

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Rate limits (requests per minute per IP). Created per app so tests can use small limits.
  const limiter = (limit: number) =>
    rateLimit({
      windowMs: 60_000,
      limit,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests, please slow down and try again in a minute' },
    });

  app.use('/api/public', limiter(config.rateLimit.public), publicRouter); // no login needed, so limited
  app.use('/api/auth/login', limiter(config.rateLimit.login)); // slows down password guessing
  app.use('/api/auth', authRouter);
  app.use('/api/batches', limiter(config.rateLimit.api), batchRouter);
  app.use('/api/state', limiter(config.rateLimit.api), certificateRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // One place that turns every error into a clean JSON response.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message, ...(err.details as object) });
    if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid input', issues: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload problem: ${err.message}` });
    log('unhandled-error', { error: (err as Error).message });
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}

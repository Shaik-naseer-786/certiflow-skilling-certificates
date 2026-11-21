// Errors we throw on purpose; the error middleware turns them into HTTP responses.
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const notFound = (what = 'Resource') => new AppError(404, `${what} not found`);
export const forbidden = (msg = 'You are not allowed to do this') => new AppError(403, msg);
export const conflict = (msg: string) => new AppError(409, msg);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, details);

import type { Request } from 'express';
import { z } from 'zod';
// Route ids must be UUIDs; anything else is rejected before it reaches the database.
export const idOf = (req: Request) => z.string().uuid().parse(req.params.id);

import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { AppError, forbidden } from '../errors.js';
import type { AuthUser } from '../services/access.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const signToken = (userId: string) => jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '12h' });

// Verifies the token, then loads the user FRESH from the database. The role is
// never taken from the token, so a tampered or stale token cannot grant power.
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AppError(401, 'Login required');
  let userId: string;
  try {
    userId = (jwt.verify(header.slice(7), config.jwtSecret) as { sub: string }).sub;
  } catch {
    throw new AppError(401, 'Invalid or expired token');
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(401, 'User no longer exists');
  req.user = { id: user.id, name: user.name, role: user.role, district: user.district };
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };

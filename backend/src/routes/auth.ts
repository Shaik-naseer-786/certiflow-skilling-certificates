import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { authenticate, signToken } from '../middleware/auth.js';

export const authRouter = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

authRouter.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Same message for "no such user" and "wrong password": don't reveal which emails exist.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new AppError(401, 'Wrong email or password');
  res.json({ token: signToken(user.id), user: { id: user.id, name: user.name, role: user.role, district: user.district } });
});

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// Demo helper so reviewers can switch between people. Names and roles only, no secrets.
authRouter.get('/demo-users', async (_req, res) => {
  if (!config.demoMode) throw new AppError(404, 'Not found');
  const users = await prisma.user.findMany({ select: { name: true, email: true, role: true, district: true }, orderBy: { name: 'asc' } });
  res.json({ users });
});

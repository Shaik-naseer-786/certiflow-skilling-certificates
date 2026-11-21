import bcrypt from 'bcryptjs';
import { PrismaClient, type Role } from '@prisma/client';

// Demo people from the problem statement. All share one password for easy demos.
export const DEMO_PASSWORD = 'password123';

const users: { name: string; email: string; role: Role; district: string | null }[] = [
  { name: 'Anika', email: 'anika@pragati.test', role: 'CENTRE', district: 'North' },
  { name: 'Rohan', email: 'rohan@pragati.test', role: 'CENTRE', district: 'South' },
  { name: 'Dev', email: 'dev@pragati.test', role: 'DISTRICT_OFFICER', district: 'North' },
  { name: 'Meera', email: 'meera@pragati.test', role: 'DISTRICT_OFFICER', district: 'North' },
  { name: 'Kabir', email: 'kabir@pragati.test', role: 'DISTRICT_OFFICER', district: 'North' },
  { name: 'Ishaan', email: 'ishaan@pragati.test', role: 'DISTRICT_OFFICER', district: 'South' },
  { name: 'Neha', email: 'neha@pragati.test', role: 'QUALITY', district: null },
  { name: 'Farah', email: 'farah@pragati.test', role: 'STATE', district: null },
];

export async function seedUsers(prisma: PrismaClient) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const u of users) {
    await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, passwordHash } });
  }
}

// Only run when executed directly (npm run seed), not when imported by tests.
if (process.argv[1]?.endsWith('seed.ts')) {
  const prisma = new PrismaClient();
  seedUsers(prisma)
    .then(() => console.log(`Seeded ${users.length} demo users (password: ${DEMO_PASSWORD})`))
    .finally(() => prisma.$disconnect());
}

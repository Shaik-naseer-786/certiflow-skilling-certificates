import ExcelJS from 'exceljs';
import { prisma } from '../src/db.js';
import { seedUsers } from '../prisma/seed.js';
import { createBatch, submitBatch, uploadCandidates } from '../src/services/batchService.js';
import { decide } from '../src/services/approvalService.js';
import type { AuthUser } from '../src/services/access.js';

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog","ProviderMessage","Certificate","Approval","BatchVersion","Candidate","Batch","User" RESTART IDENTITY CASCADE',
  );
  await seedUsers(prisma);
}

export async function userByName(name: string): Promise<AuthUser> {
  const u = await prisma.user.findFirstOrThrow({ where: { name } });
  return { id: u.id, name: u.name, role: u.role, district: u.district };
}

// Letters only, because candidate names may not contain digits.
const letters = (i: number) => String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26) % 26);

// offset shifts the phone numbers, so two batches in one test can hold different people.
export function goodRows(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    Name: `Student ${letters(i + offset)}`,
    Phone: String(9000000000 + offset + i),
    Course: 'Electrician',
    Score: 60 + (i % 40),
  }));
}

export async function makeXlsx(rows: Record<string, unknown>[], headers = ['Name', 'Phone', 'Course', 'Score']): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Batch');
  ws.addRow(headers);
  for (const r of rows) ws.addRow(headers.map((h) => r[h]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function draftBatch(centreName: string, candidates: number, offset = 0) {
  const centre = await userByName(centreName);
  const batch = await createBatch(centre, 'Test batch');
  await uploadCandidates(centre, batch.id, await makeXlsx(goodRows(candidates, offset)));
  return { centre, batch };
}

export async function submittedBatch(centreName: string, candidates: number, offset = 0) {
  const { centre, batch } = await draftBatch(centreName, candidates, offset);
  await submitBatch(centre, batch.id);
  return { centre, batchId: batch.id };
}

// Approves an already submitted batch through every stage.
export async function approveExisting(batchId: string, candidates: number) {
  await decide(await userByName('Dev'), batchId, 'APPROVE');
  await decide(await userByName('Meera'), batchId, 'APPROVE');
  if (candidates >= 50) await decide(await userByName('Neha'), batchId, 'APPROVE');
  await decide(await userByName('Farah'), batchId, 'APPROVE');
}

// Walks a new batch through every stage so a test can start from "approved".
export async function approvedBatch(candidates: number, centreName = 'Anika', offset = 0) {
  const { batchId } = await submittedBatch(centreName, candidates, offset);
  await approveExisting(batchId, candidates);
  return batchId;
}

// Seeded random numbers (mulberry32): same sequence every run, so flaky-WhatsApp tests are repeatable.
export function seededRng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generates demo spreadsheets into ../sample-data. Run: npm run sample-data
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

const FIRST = ['Asha', 'Ravi', 'Meena', 'Karan', 'Priya', 'Vikram', 'Sunita', 'Arjun', 'Divya', 'Manoj'];
const LAST = ['Sharma', 'Patel', 'Singh', 'Verma', 'Nair', 'Reddy', 'Gupta', 'Das', 'Khan', 'Joshi'];
const COURSES = ['Electrician', 'Welding', 'Retail Sales', 'Data Entry', 'Tailoring'];

const row = (i: number) => ({
  Name: `${FIRST[i % 10]} ${LAST[Math.floor(i / 10) % 10]}${i >= 100 ? ' ' + String.fromCharCode(65 + (i % 26)) : ''}`,
  Phone: String(9876500000 + i),
  Course: COURSES[i % 5],
  Score: 45 + ((i * 7) % 55),
});

async function write(file: string, rows: Record<string, unknown>[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Batch');
  ws.addRow(['Name', 'Phone', 'Course', 'Score']);
  for (const r of rows) ws.addRow([r.Name, r.Phone, r.Course, r.Score]);
  const out = path.resolve(import.meta.dirname, '../../sample-data', file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await wb.xlsx.writeFile(out);
  console.log('wrote', out);
}

const small = Array.from({ length: 10 }, (_, i) => row(i));
const large = Array.from({ length: 60 }, (_, i) => row(i));
const bad = Array.from({ length: 10 }, (_, i) => row(i));
bad[2].Phone = '12345'; // sheet row 4
bad[4].Name = ''; // sheet row 6
bad[6].Score = 20; // sheet row 8: below pass mark
bad[8].Phone = bad[0].Phone; // sheet row 10: duplicate

await write('batch_10_valid.xlsx', small);
await write('batch_60_valid_needs_quality.xlsx', large);
await write('batch_10_with_errors.xlsx', bad);

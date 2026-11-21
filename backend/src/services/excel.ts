import ExcelJS from 'exceljs';
import { config } from '../config.js';
import { AppError } from '../errors.js';

export type ParsedCandidate = { rowNumber: number; name: string; phone: string; course: string; score: number };
export type RowError = { row: number; field: string; message: string };

// Excel cells can hold numbers, text, rich text, formulas... flatten to a string.
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('').trim();
    if ('text' in v) return String(v.text).trim();
    if ('result' in v) return String(v.result ?? '').trim();
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

const NAME_RE = /^[\p{L}][\p{L} .'-]{1,79}$/u;
const PHONE_RE = /^[6-9]\d{9}$/; // Indian mobile number

// Pure validation of already-extracted rows. Kept separate so it is easy to unit test.
export function validateRows(
  rows: { rowNumber: number; name: string; phone: string; course: string; score: string }[],
): { candidates: ParsedCandidate[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const candidates: ParsedCandidate[] = [];
  const seenPhones = new Map<string, number>();

  for (const r of rows) {
    const err = (field: string, message: string) => errors.push({ row: r.rowNumber, field, message });

    if (!NAME_RE.test(r.name)) err('Name', 'Name is required (2-80 letters)');

    const phone = r.phone.replace(/[\s-]/g, '').replace(/^(\+91|91)(?=\d{10}$)/, '');
    if (!PHONE_RE.test(phone)) err('Phone', 'Phone must be a 10 digit Indian mobile number');
    else if (seenPhones.has(phone)) err('Phone', `Duplicate of row ${seenPhones.get(phone)}`);
    else seenPhones.set(phone, r.rowNumber);

    if (!r.course || r.course.length > 100) err('Course', 'Course is required (max 100 characters)');

    const score = Number(r.score);
    if (r.score === '' || !Number.isFinite(score) || score < 0 || score > 100) err('Score', 'Score must be a number from 0 to 100');
    else if (score < config.passMark) err('Score', `Score ${score} is below the pass mark of ${config.passMark}`);

    if (!errors.some((e) => e.row === r.rowNumber)) {
      candidates.push({ rowNumber: r.rowNumber, name: r.name, phone, course: r.course, score: Math.round(score) });
    }
  }
  return { candidates, errors };
}

// Reads the first sheet. Expected header row: Name | Phone | Course | Score.
export async function parseWorkbook(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new AppError(400, 'File is not a valid .xlsx workbook');
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new AppError(400, 'Workbook has no sheets');

  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => headers.set(cellText(cell.value).toLowerCase(), col));
  const missing = ['name', 'phone', 'course', 'score'].filter((h) => !headers.has(h));
  if (missing.length) throw new AppError(422, `Missing column(s): ${missing.join(', ')}`, { errors: [] });

  if (sheet.rowCount - 1 > config.maxRows) throw new AppError(422, `Too many rows (max ${config.maxRows})`, { errors: [] });

  const rows: Parameters<typeof validateRows>[0] = [];
  for (let n = 2; n <= sheet.rowCount; n++) {
    const row = sheet.getRow(n);
    const get = (h: string) => cellText(row.getCell(headers.get(h)!).value);
    const rec = { rowNumber: n, name: get('name'), phone: get('phone'), course: get('course'), score: get('score') };
    if (!rec.name && !rec.phone && !rec.course && !rec.score) continue; // skip blank rows
    rows.push(rec);
  }
  if (rows.length === 0) throw new AppError(422, 'No candidate rows found', { errors: [] });
  return validateRows(rows);
}

/**
 * CSV format validator and parser for the data reconciliation platform.
 *
 * Validates that a CSV file matches the expected column schema for a
 * given cascade stage before it enters the processing pipeline.
 *
 * Also provides a generic CSV parser that normalises headers (lowercase,
 * trimmed) and handles multiple delimiters (tab, semicolon, pipe, comma).
 */

import type {
  CascadeStage,
  ValidationError,
  ValidationResult,
} from '../types/csv';
import { STAGE_COLUMNS } from '../types/csv';

/**
 * Detect the delimiter used in the CSV header line.
 * Supports tab, semicolon, pipe, and comma (default).
 */
export function detectDelimiter(headerLine: string): string {
  const cleaned = headerLine.replace(/^\uFEFF/, '');
  if (cleaned.includes('\t')) return '\t';
  if (cleaned.includes(';')) return ';';
  if (cleaned.includes('|')) return '|';
  return ',';
}

/**
 * Parse the header row from raw CSV content.
 * Auto-detects the delimiter (tab, semicolon, pipe, or comma)
 * and trims whitespace / BOM from each column name.
 */
function parseHeaders(firstLine: string): string[] {
  const delimiter = detectDelimiter(firstLine);
  return firstLine
    .replace(/^\uFEFF/, '') // strip UTF-8 BOM
    .split(delimiter)
    .map((h) => h.trim());
}

/**
 * Clean a monetary string like "$ 279.800" or "$279,800.50" into a number.
 * Handles:
 *  - Currency symbols ($, €, etc.)
 *  - Thousands separators (dot or comma depending on format)
 *  - Whitespace
 */
export function parseMonetaryValue(raw: string): number {
  if (typeof raw === 'number') return raw;
  // Remove currency symbols and whitespace
  let cleaned = raw.replace(/[^0-9.,\-]/g, '').trim();
  if (cleaned === '') return 0;

  // Detect format: if last separator is a dot with 3 digits after → thousands sep
  // e.g. "279.800" → 279800, "279.80" → 279.80
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');

  if (lastComma > lastDot) {
    // Comma is decimal separator (European format): 1.234,56
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // Dot could be decimal or thousands separator
    const afterDot = cleaned.substring(lastDot + 1);
    if (afterDot.length === 3 && !cleaned.includes(',')) {
      // "279.800" → thousands separator, not decimal
      cleaned = cleaned.replace(/\./g, '');
    } else {
      // "279.80" → decimal separator
      cleaned = cleaned.replace(/,/g, '');
    }
  }

  const value = parseFloat(cleaned);
  return isNaN(value) ? 0 : value;
}

/**
 * Parse a full CSV string into an array of objects with normalised keys.
 *
 * - Headers are lowercased and trimmed.
 * - Delimiter is auto-detected.
 * - Empty trailing rows are skipped.
 *
 * @returns Array of records where keys are the lowercase header names.
 */
export function parseCSV(content: string): Record<string, string>[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0]
    .replace(/^\uFEFF/, '')
    .split(delimiter)
    .map((h) => h.trim().toLowerCase());

  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(delimiter).map((v) => v.trim());
    const record: Record<string, string> = {};

    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] ?? '';
    }

    records.push(record);
  }

  return records;
}

/**
 * Validate that a CSV string conforms to the expected format for `stage`.
 *
 * Checks performed (in order):
 *  1. Empty file → `empty_file` error
 *  2. Missing required columns → one `missing_column` error per column
 *  3. No data rows (header only) → `invalid_format` error
 *
 * Column matching is **case-insensitive** — headers like `INVOICE`,
 * `Invoice`, and `invoice` are all accepted.
 *
 * Extra columns that are not in the schema are silently accepted.
 */
export function validateFileFormat(
  content: string,
  stage: CascadeStage,
): ValidationResult {
  const errors: ValidationError[] = [];

  // 1. Empty file check
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return {
      isValid: false,
      errors: [
        {
          type: 'empty_file',
          message: 'El archivo está vacío',
          details: 'El archivo CSV no contiene datos.',
        },
      ],
    };
  }

  // Split into lines (handle \r\n and \n)
  const lines = trimmed.split(/\r?\n/);

  // 2. Parse headers and check required columns (case-insensitive)
  const headers = parseHeaders(lines[0]);
  const headersLower = headers.map((h) => h.toLowerCase());
  const requiredColumns = STAGE_COLUMNS[stage];

  for (const col of requiredColumns) {
    if (!headersLower.includes(col.toLowerCase())) {
      errors.push({
        type: 'missing_column',
        message: `Columna requerida faltante: ${col}`,
        details: `La etapa "${stage}" requiere la columna "${col}".`,
      });
    }
  }

  // 3. Must have at least one data row beyond the header
  if (lines.length < 2 || lines.slice(1).every((l) => l.trim() === '')) {
    errors.push({
      type: 'invalid_format',
      message: 'El archivo no contiene filas de datos',
      details:
        'El archivo CSV debe contener al menos una fila de datos además del encabezado.',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

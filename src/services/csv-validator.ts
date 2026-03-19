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
 * Split a single CSV line respecting quoted fields (RFC 4180).
 * Handles: "field", "field with ""escaped"" quotes", empty fields.
 *
 * A quoted field must START with a quote (right after delimiter or at
 * the beginning of the line). Quotes appearing mid-field are treated
 * as literal characters.
 *
 * Tolerant mode: if a closing quote is followed by a non-delimiter
 * character (malformed CSV), the quote is treated as literal and
 * parsing continues inside the quoted field.
 */
export function splitCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let fieldStart = true;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          // Escaped quote ""
          current += '"';
          i += 2;
        } else if (i + 1 >= line.length || line[i + 1] === delimiter) {
          // Proper close: quote followed by delimiter or end of line
          inQuotes = false;
          i++;
        } else {
          // Malformed: quote followed by non-delimiter — treat as literal
          current += '"';
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else {
      if (ch === '"' && fieldStart) {
        inQuotes = true;
        fieldStart = false;
        i++;
      } else if (ch === delimiter) {
        fields.push(current.trim());
        current = '';
        fieldStart = true;
        i++;
      } else {
        current += ch;
        fieldStart = false;
        i++;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse the header row from raw CSV content.
 * Uses the given delimiter (or auto-detects) and handles quoted headers.
 */
function parseHeaders(firstLine: string, delimiter?: string): string[] {
  const cleaned = firstLine.replace(/^\uFEFF/, '');
  const delim = delimiter ?? detectDelimiter(cleaned);
  return splitCSVLine(cleaned, delim).map((h) =>
    h.replace(/^"|"$/g, '').trim(),
  );
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
 * - Supports quoted fields (RFC 4180): "value", "value with ""quotes""".
 * - Delimiter can be specified or auto-detected.
 * - Empty trailing rows are skipped.
 *
 * @param content   - Raw CSV text.
 * @param delimiter - Optional delimiter override. Auto-detected if omitted.
 * @returns Array of records where keys are the lowercase header names.
 */
export function parseCSV(content: string, delimiter?: string): Record<string, string>[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const delim = delimiter ?? detectDelimiter(headerLine);
  const headers = splitCSVLine(headerLine, delim).map((h) =>
    h.replace(/^"|"$/g, '').trim().toLowerCase(),
  );

  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = splitCSVLine(line, delim);
    const record: Record<string, string> = {};

    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = (values[j] ?? '').replace(/^"|"$/g, '');
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
  delimiter?: string,
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
  const headers = parseHeaders(lines[0], delimiter);
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

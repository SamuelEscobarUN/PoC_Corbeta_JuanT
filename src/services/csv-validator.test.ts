/**
 * Unit tests for CSV format validation.
 *
 * Covers:
 *  - Valid CSV for each cascade stage
 *  - Missing columns
 *  - Empty file
 *  - Header-only file (no data rows)
 *  - Extra columns (should still be valid)
 *  - Case sensitivity of column names
 */
import { describe, it, expect } from 'vitest';
import { validateFileFormat } from './csv-validator';
import type { CascadeStage } from '../types/csv';
import { STAGE_COLUMNS } from '../types/csv';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Build a minimal valid CSV string for a given stage. */
function validCsv(stage: CascadeStage): string {
  const cols = STAGE_COLUMNS[stage];
  const header = cols.join(',');
  const dataRow = cols.map(() => 'value').join(',');
  return `${header}\n${dataRow}`;
}

/* ------------------------------------------------------------------ */
/*  Valid CSV per stage                                                */
/* ------------------------------------------------------------------ */

describe('validateFileFormat – valid CSV per stage', () => {
  const stages: CascadeStage[] = [
    'geopos_local',
    'geopos_central',
    'integracion',
    'ps_ck_intfc_vtapos',
  ];

  for (const stage of stages) {
    it(`accepts a valid CSV for "${stage}"`, () => {
      const result = validateFileFormat(validCsv(stage), stage);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  }
});

/* ------------------------------------------------------------------ */
/*  Missing columns                                                    */
/* ------------------------------------------------------------------ */

describe('validateFileFormat – missing columns', () => {
  it('reports each missing column individually', () => {
    // CSV with only the first column of integracion
    const csv = 'TICKET_KEY\nval';
    const result = validateFileFormat(csv, 'integracion');

    expect(result.isValid).toBe(false);

    const missingErrors = result.errors.filter(
      (e) => e.type === 'missing_column',
    );
    // integracion has 8 columns; we provided 1 → 7 missing
    expect(missingErrors).toHaveLength(7);

    // Verify specific missing columns are reported
    const missingNames = missingErrors.map((e) =>
      e.message.replace('Columna requerida faltante: ', ''),
    );
    expect(missingNames).toContain('INVOICE');
    expect(missingNames).toContain('TOTAL');
    expect(missingNames).toContain('SKU');
  });

  it('reports a single missing column', () => {
    // geopos_local needs: invoice, total, barcode, description
    const csv = 'invoice,total,barcode\nv1,v2,v3';
    const result = validateFileFormat(csv, 'geopos_local');

    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].type).toBe('missing_column');
    expect(result.errors[0].message).toContain('description');
  });
});

/* ------------------------------------------------------------------ */
/*  Empty file                                                         */
/* ------------------------------------------------------------------ */

describe('validateFileFormat – empty file', () => {
  it('returns empty_file error for an empty string', () => {
    const result = validateFileFormat('', 'geopos_local');

    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].type).toBe('empty_file');
  });

  it('returns empty_file error for whitespace-only content', () => {
    const result = validateFileFormat('   \n  \n  ', 'geopos_central');

    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].type).toBe('empty_file');
  });
});

/* ------------------------------------------------------------------ */
/*  Header only (no data rows)                                         */
/* ------------------------------------------------------------------ */

describe('validateFileFormat – header only', () => {
  it('returns invalid_format when there are no data rows', () => {
    const headerOnly = STAGE_COLUMNS.geopos_local.join(',');
    const result = validateFileFormat(headerOnly, 'geopos_local');

    expect(result.isValid).toBe(false);
    const formatErrors = result.errors.filter(
      (e) => e.type === 'invalid_format',
    );
    expect(formatErrors).toHaveLength(1);
    expect(formatErrors[0].message).toContain('filas de datos');
  });

  it('returns invalid_format when data rows are blank', () => {
    const csv = STAGE_COLUMNS.geopos_local.join(',') + '\n   \n  ';
    const result = validateFileFormat(csv, 'geopos_local');

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.type === 'invalid_format')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Extra columns (should still be valid)                              */
/* ------------------------------------------------------------------ */

describe('validateFileFormat – extra columns', () => {
  it('accepts CSV with extra columns beyond the required ones', () => {
    const cols = [...STAGE_COLUMNS.geopos_local, 'extra1', 'extra2'];
    const header = cols.join(',');
    const dataRow = cols.map(() => 'v').join(',');
    const csv = `${header}\n${dataRow}`;

    const result = validateFileFormat(csv, 'geopos_local');

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Case sensitivity                                                   */
/* ------------------------------------------------------------------ */

describe('validateFileFormat – case sensitivity', () => {
  it('accepts columns with different casing (case-insensitive)', () => {
    // geopos_local expects: invoice, total, barcode, description
    // CSV has uppercase — should still be accepted
    const csv = 'INVOICE,TOTAL,BARCODE,DESCRIPTION\nv1,v2,v3,v4';
    const result = validateFileFormat(csv, 'geopos_local');

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts mixed casing in headers', () => {
    const csv = 'Invoice,Total,Barcode,Description\nv1,v2,v3,v4';
    const result = validateFileFormat(csv, 'geopos_local');

    expect(result.isValid).toBe(true);
  });

  it('accepts integracion columns with correct uppercase', () => {
    const csv = validCsv('integracion');
    const result = validateFileFormat(csv, 'integracion');

    expect(result.isValid).toBe(true);
  });
});

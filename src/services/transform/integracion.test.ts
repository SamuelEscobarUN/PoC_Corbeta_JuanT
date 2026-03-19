import { describe, it, expect } from 'vitest';
import { transformIntegracion } from './integracion';
import type { IntegracionRawRecord } from './types';

const makeRecord = (overrides: Partial<IntegracionRawRecord> = {}): IntegracionRawRecord => ({
  TICKET_KEY: 'TK001',
  INVOICE: 'Z01',
  TOTAL: 1000,
  SKU: 'SKU001',
  CONCESION: 'C1',
  CLI_DOC: 'DOC1',
  TIPO_VENTA: 'TV1',
  INTEGRATION_TICKET_DATE: '2024-01-15',
  ...overrides,
});

describe('transformIntegracion', () => {
  it('sums totals for multiple items under one invoice', () => {
    const records: IntegracionRawRecord[] = [
      makeRecord({ INVOICE: 'Z01', TOTAL: 4950, SKU: 'SKU-A' }),
      makeRecord({ INVOICE: 'Z01', TOTAL: 4729, SKU: 'SKU-B' }),
      makeRecord({ INVOICE: 'Z01', TOTAL: 4990, SKU: 'SKU-C' }),
    ];

    const result = transformIntegracion(records, 'upload-1');

    expect(result.invoices).toHaveLength(1);
    const inv = result.invoices[0];
    expect(inv.invoice).toBe('Z01');
    // CRITICAL: total MUST be the SUM of all item totals
    expect(inv.totalFactura).toBe(4950 + 4729 + 4990);
    expect(inv.itemCount).toBe(3);
    expect(inv.items).toEqual([
      { itemId: 'SKU-A', value: 4950 },
      { itemId: 'SKU-B', value: 4729 },
      { itemId: 'SKU-C', value: 4990 },
    ]);
  });

  it('handles multiple invoices correctly', () => {
    const records: IntegracionRawRecord[] = [
      makeRecord({ INVOICE: 'A01', TOTAL: 5000, SKU: 'S1' }),
      makeRecord({ INVOICE: 'A02', TOTAL: 3000, SKU: 'S2' }),
      makeRecord({ INVOICE: 'A01', TOTAL: 2000, SKU: 'S3' }),
    ];

    const result = transformIntegracion(records, 'upload-2');

    expect(result.invoices).toHaveLength(2);
    expect(result.stage).toBe('integracion');
    expect(result.uploadId).toBe('upload-2');

    const invA01 = result.invoices.find((i) => i.invoice === 'A01')!;
    expect(invA01.totalFactura).toBe(7000);
    expect(invA01.itemCount).toBe(2);

    const invA02 = result.invoices.find((i) => i.invoice === 'A02')!;
    expect(invA02.totalFactura).toBe(3000);
    expect(invA02.itemCount).toBe(1);
  });

  it('handles a single item per invoice', () => {
    const records: IntegracionRawRecord[] = [
      makeRecord({ INVOICE: 'S01', TOTAL: 1500, SKU: 'SOLO1' }),
    ];

    const result = transformIntegracion(records, 'upload-3');

    expect(result.invoices).toHaveLength(1);
    const inv = result.invoices[0];
    expect(inv.totalFactura).toBe(1500);
    expect(inv.itemCount).toBe(1);
    expect(inv.items[0].itemId).toBe('SOLO1');
  });

  it('handles zero total items', () => {
    const records: IntegracionRawRecord[] = [
      makeRecord({ INVOICE: 'Z00', TOTAL: 0, SKU: 'ZS1' }),
      makeRecord({ INVOICE: 'Z00', TOTAL: 0, SKU: 'ZS2' }),
    ];

    const result = transformIntegracion(records, 'upload-4');

    expect(result.invoices).toHaveLength(1);
    const inv = result.invoices[0];
    expect(inv.totalFactura).toBe(0);
    expect(inv.itemCount).toBe(2);
  });

  it('returns empty invoices array for empty input', () => {
    const result = transformIntegracion([], 'upload-5');

    expect(result.invoices).toHaveLength(0);
    expect(result.stage).toBe('integracion');
    expect(result.uploadId).toBe('upload-5');
  });

  it('sets processedAt as a valid ISO timestamp', () => {
    const records: IntegracionRawRecord[] = [
      makeRecord({ INVOICE: 'T01', TOTAL: 100, SKU: 'TS1' }),
    ];

    const result = transformIntegracion(records, 'upload-6');

    expect(result.processedAt).toBeTruthy();
    expect(new Date(result.processedAt).toISOString()).toBe(result.processedAt);
  });

  it('uses SKU as itemId', () => {
    const records: IntegracionRawRecord[] = [
      makeRecord({ INVOICE: 'I01', SKU: 'MY-SKU-123' }),
    ];

    const result = transformIntegracion(records, 'upload-7');

    expect(result.invoices[0].items[0].itemId).toBe('MY-SKU-123');
  });
});

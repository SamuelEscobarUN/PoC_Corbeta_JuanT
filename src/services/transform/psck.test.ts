import { describe, it, expect } from 'vitest';
import { transformPsCk } from './psck';
import type { PsCkRawRecord } from './types';

const makeRecord = (overrides: Partial<PsCkRawRecord> = {}): PsCkRawRecord => ({
  ACCOUNTING_DT: '2024-01-15',
  CK_TIPO_VENTA: 'TV1',
  INV_ITEM_ID: 'ITEM001',
  INVOICE: 'Z01',
  QTY_REQUESTED: 1,
  TOTAL: 1000,
  ...overrides,
});

describe('transformPsCk', () => {
  it('sums totals for multiple items under one invoice', () => {
    const records: PsCkRawRecord[] = [
      makeRecord({ INVOICE: 'Z01', TOTAL: 4950, INV_ITEM_ID: 'ITEM-A' }),
      makeRecord({ INVOICE: 'Z01', TOTAL: 4729, INV_ITEM_ID: 'ITEM-B' }),
      makeRecord({ INVOICE: 'Z01', TOTAL: 4990, INV_ITEM_ID: 'ITEM-C' }),
    ];

    const result = transformPsCk(records, 'upload-1');

    expect(result.invoices).toHaveLength(1);
    const inv = result.invoices[0];
    expect(inv.invoice).toBe('Z01');
    // CRITICAL: total MUST be the SUM of all item totals
    expect(inv.totalFactura).toBe(4950 + 4729 + 4990);
    expect(inv.itemCount).toBe(3);
    expect(inv.items).toEqual([
      { itemId: 'ITEM-A', value: 4950 },
      { itemId: 'ITEM-B', value: 4729 },
      { itemId: 'ITEM-C', value: 4990 },
    ]);
  });

  it('handles multiple invoices correctly', () => {
    const records: PsCkRawRecord[] = [
      makeRecord({ INVOICE: 'A01', TOTAL: 5000, INV_ITEM_ID: 'I1' }),
      makeRecord({ INVOICE: 'A02', TOTAL: 3000, INV_ITEM_ID: 'I2' }),
      makeRecord({ INVOICE: 'A01', TOTAL: 2000, INV_ITEM_ID: 'I3' }),
    ];

    const result = transformPsCk(records, 'upload-2');

    expect(result.invoices).toHaveLength(2);
    expect(result.stage).toBe('ps_ck_intfc_vtapos');
    expect(result.uploadId).toBe('upload-2');

    const invA01 = result.invoices.find((i) => i.invoice === 'A01')!;
    expect(invA01.totalFactura).toBe(7000);
    expect(invA01.itemCount).toBe(2);

    const invA02 = result.invoices.find((i) => i.invoice === 'A02')!;
    expect(invA02.totalFactura).toBe(3000);
    expect(invA02.itemCount).toBe(1);
  });

  it('handles a single item per invoice', () => {
    const records: PsCkRawRecord[] = [
      makeRecord({ INVOICE: 'S01', TOTAL: 1500, INV_ITEM_ID: 'SOLO1' }),
    ];

    const result = transformPsCk(records, 'upload-3');

    expect(result.invoices).toHaveLength(1);
    const inv = result.invoices[0];
    expect(inv.totalFactura).toBe(1500);
    expect(inv.itemCount).toBe(1);
    expect(inv.items[0].itemId).toBe('SOLO1');
  });

  it('handles zero total items', () => {
    const records: PsCkRawRecord[] = [
      makeRecord({ INVOICE: 'Z00', TOTAL: 0, INV_ITEM_ID: 'ZI1' }),
      makeRecord({ INVOICE: 'Z00', TOTAL: 0, INV_ITEM_ID: 'ZI2' }),
    ];

    const result = transformPsCk(records, 'upload-4');

    expect(result.invoices).toHaveLength(1);
    const inv = result.invoices[0];
    expect(inv.totalFactura).toBe(0);
    expect(inv.itemCount).toBe(2);
  });

  it('returns empty invoices array for empty input', () => {
    const result = transformPsCk([], 'upload-5');

    expect(result.invoices).toHaveLength(0);
    expect(result.stage).toBe('ps_ck_intfc_vtapos');
    expect(result.uploadId).toBe('upload-5');
  });

  it('sets processedAt as a valid ISO timestamp', () => {
    const records: PsCkRawRecord[] = [
      makeRecord({ INVOICE: 'T01', TOTAL: 100, INV_ITEM_ID: 'TI1' }),
    ];

    const result = transformPsCk(records, 'upload-6');

    expect(result.processedAt).toBeTruthy();
    expect(new Date(result.processedAt).toISOString()).toBe(result.processedAt);
  });

  it('uses INV_ITEM_ID as itemId', () => {
    const records: PsCkRawRecord[] = [
      makeRecord({ INVOICE: 'I01', INV_ITEM_ID: 'MY-ITEM-456' }),
    ];

    const result = transformPsCk(records, 'upload-7');

    expect(result.invoices[0].items[0].itemId).toBe('MY-ITEM-456');
  });
});

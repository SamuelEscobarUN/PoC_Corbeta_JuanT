import { describe, it, expect } from 'vitest';
import { transformGeopos } from './geopos';
import type { GeoposRawRecord } from './types';

describe('transformGeopos', () => {
  it('groups multiple items under one invoice WITHOUT summing totals', () => {
    const records: GeoposRawRecord[] = [
      { invoice: 'X99', total: 9020, barcode: 'BC001', description: 'Item A' },
      { invoice: 'X99', total: 9020, barcode: 'BC002', description: 'Item B' },
    ];

    const result = transformGeopos(records, 'geopos_local', 'upload-1');

    expect(result.invoices).toHaveLength(1);

    const inv = result.invoices[0];
    expect(inv.invoice).toBe('X99');
    // CRITICAL: total must be 9020, NOT 18040
    expect(inv.totalFactura).toBe(9020);
    expect(inv.itemCount).toBe(2);
    expect(inv.items).toEqual([
      { itemId: 'BC001', description: 'Item A', value: 9020 },
      { itemId: 'BC002', description: 'Item B', value: 9020 },
    ]);
  });

  it('handles multiple invoices correctly', () => {
    const records: GeoposRawRecord[] = [
      { invoice: 'A01', total: 5000, barcode: 'B1', description: 'Desc 1' },
      { invoice: 'A02', total: 3000, barcode: 'B2', description: 'Desc 2' },
      { invoice: 'A01', total: 5000, barcode: 'B3', description: 'Desc 3' },
    ];

    const result = transformGeopos(records, 'geopos_central', 'upload-2');

    expect(result.invoices).toHaveLength(2);
    expect(result.stage).toBe('geopos_central');
    expect(result.uploadId).toBe('upload-2');

    const invA01 = result.invoices.find((i) => i.invoice === 'A01')!;
    expect(invA01.totalFactura).toBe(5000);
    expect(invA01.itemCount).toBe(2);

    const invA02 = result.invoices.find((i) => i.invoice === 'A02')!;
    expect(invA02.totalFactura).toBe(3000);
    expect(invA02.itemCount).toBe(1);
  });

  it('handles a single item per invoice', () => {
    const records: GeoposRawRecord[] = [
      { invoice: 'S01', total: 1500, barcode: 'SOLO1', description: 'Only item' },
    ];

    const result = transformGeopos(records, 'geopos_local', 'upload-3');

    expect(result.invoices).toHaveLength(1);
    const inv = result.invoices[0];
    expect(inv.totalFactura).toBe(1500);
    expect(inv.itemCount).toBe(1);
    expect(inv.items[0].itemId).toBe('SOLO1');
  });

  it('handles invoice with zero total', () => {
    const records: GeoposRawRecord[] = [
      { invoice: 'Z00', total: 0, barcode: 'ZB1', description: 'Free item' },
      { invoice: 'Z00', total: 0, barcode: 'ZB2', description: 'Another free' },
    ];

    const result = transformGeopos(records, 'geopos_central', 'upload-4');

    expect(result.invoices).toHaveLength(1);
    const inv = result.invoices[0];
    expect(inv.totalFactura).toBe(0);
    expect(inv.itemCount).toBe(2);
  });

  it('returns empty invoices array for empty input', () => {
    const result = transformGeopos([], 'geopos_local', 'upload-5');

    expect(result.invoices).toHaveLength(0);
    expect(result.stage).toBe('geopos_local');
    expect(result.uploadId).toBe('upload-5');
  });

  it('sets processedAt as a valid ISO timestamp', () => {
    const records: GeoposRawRecord[] = [
      { invoice: 'T01', total: 100, barcode: 'TB1', description: 'Test' },
    ];

    const result = transformGeopos(records, 'geopos_local', 'upload-6');

    expect(result.processedAt).toBeTruthy();
    expect(new Date(result.processedAt).toISOString()).toBe(result.processedAt);
  });

  it('omits description when empty string is provided', () => {
    const records: GeoposRawRecord[] = [
      { invoice: 'D01', total: 200, barcode: 'DB1', description: '' },
    ];

    const result = transformGeopos(records, 'geopos_local', 'upload-7');

    expect(result.invoices[0].items[0].description).toBeUndefined();
  });
});

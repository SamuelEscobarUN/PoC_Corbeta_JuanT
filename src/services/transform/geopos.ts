/**
 * Geopos Local / Central transformer.
 *
 * CRITICAL BUSINESS RULE:
 * For a given invoice every raw row carries the **same** `total` value
 * (the invoice-level total, NOT the item total). When grouping by
 * invoice we therefore take the `total` from ANY row — we do NOT sum
 * them.
 *
 * Each row represents a distinct item identified by its barcode.
 *
 * Accepts raw records with headers in any case (invoice/INVOICE/Invoice).
 */

import type { CascadeStage } from '../../types/csv';
import type {
  GeoposRawRecord,
  TransformedData,
  TransformedInvoice,
  TransformedItem,
} from './types';
import { parseCSV, parseMonetaryValue } from '../csv-validator';

/**
 * Parse raw CSV content into GeoposRawRecord[], normalising header case
 * and monetary values.
 */
export function parseGeoposCSV(content: string): GeoposRawRecord[] {
  const rows = parseCSV(content);
  return rows.map((row) => ({
    invoice: row['invoice'] ?? '',
    total: parseMonetaryValue(row['total'] ?? '0'),
    barcode: row['barcode'] ?? '',
    description: row['description'] ?? '',
  }));
}

/**
 * Transform an array of raw Geopos CSV records into the normalised
 * {@link TransformedData} structure.
 *
 * @param records  - Parsed CSV rows (one per item).
 * @param stage    - `'geopos_local'` or `'geopos_central'`.
 * @param uploadId - Unique identifier of the source upload.
 * @returns Normalised data ready for S3 storage and downstream processing.
 */
export function transformGeopos(
  records: GeoposRawRecord[],
  stage: CascadeStage,
  uploadId: string,
): TransformedData {
  // Group rows by invoice number
  const invoiceMap = new Map<string, GeoposRawRecord[]>();

  for (const record of records) {
    const existing = invoiceMap.get(record.invoice);
    if (existing) {
      existing.push(record);
    } else {
      invoiceMap.set(record.invoice, [record]);
    }
  }

  // Build normalised invoices
  const invoices: TransformedInvoice[] = [];

  for (const [invoice, rows] of invoiceMap) {
    // Total comes from ANY row (they all carry the same invoice total)
    const totalFactura = rows[0].total;

    const items: TransformedItem[] = rows.map((row) => ({
      itemId: row.barcode,
      description: row.description || undefined,
      value: row.total,
    }));

    invoices.push({
      invoice,
      totalFactura,
      items,
      itemCount: items.length,
    });
  }

  return {
    stage,
    uploadId,
    invoices,
    processedAt: new Date().toISOString(),
  };
}

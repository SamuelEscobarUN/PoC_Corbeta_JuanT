/**
 * PS_CK (ps_ck_intfc_vtapos) transformer.
 *
 * CRITICAL BUSINESS RULE:
 * For PS_CK, each row's TOTAL represents the value PER ITEM.
 * The invoice total must be calculated by SUMMING all TOTAL values
 * for that invoice.
 *
 * Each row represents a distinct item identified by its INV_ITEM_ID.
 *
 * Accepts raw records with headers in any case.
 */

import type { CascadeStage } from '../../types/csv';
import type {
  PsCkRawRecord,
  TransformedData,
  TransformedInvoice,
  TransformedItem,
} from './types';
import { parseCSV, parseMonetaryValue } from '../csv-validator';

/**
 * Parse raw CSV content into PsCkRawRecord[], normalising header case
 * and monetary values.
 */
export function parsePsCkCSV(content: string): PsCkRawRecord[] {
  const rows = parseCSV(content);
  return rows.map((row) => ({
    ACCOUNTING_DT: row['accounting_dt'] ?? '',
    CK_TIPO_VENTA: row['ck_tipo_venta'] ?? '',
    INV_ITEM_ID: row['inv_item_id'] ?? '',
    INVOICE: row['invoice'] ?? '',
    QTY_REQUESTED: parseMonetaryValue(row['qty_requested'] ?? '0'),
    TOTAL: parseMonetaryValue(row['total'] ?? '0'),
  }));
}
/**
 * Transform an array of raw PS_CK CSV records into the normalised
 * {@link TransformedData} structure.
 *
 * @param records  - Parsed CSV rows (one per item).
 * @param uploadId - Unique identifier of the source upload.
 * @returns Normalised data ready for S3 storage and downstream processing.
 */
export function transformPsCk(
  records: PsCkRawRecord[],
  uploadId: string,
): TransformedData {
  const stage: CascadeStage = 'ps_ck_intfc_vtapos';

  // Group rows by invoice number
  const invoiceMap = new Map<string, PsCkRawRecord[]>();

  for (const record of records) {
    const existing = invoiceMap.get(record.INVOICE);
    if (existing) {
      existing.push(record);
    } else {
      invoiceMap.set(record.INVOICE, [record]);
    }
  }

  // Build normalised invoices
  const invoices: TransformedInvoice[] = [];

  for (const [invoice, rows] of invoiceMap) {
    const items: TransformedItem[] = rows.map((row) => ({
      itemId: row.INV_ITEM_ID,
      value: row.TOTAL,
    }));

    // CRITICAL: SUM all item totals to get the invoice total
    const totalFactura = rows.reduce((sum, row) => sum + row.TOTAL, 0);

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

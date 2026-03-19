/**
 * Integración transformer.
 *
 * CRITICAL BUSINESS RULE:
 * For Integración, each row's TOTAL represents the value PER ITEM.
 * The invoice total must be calculated by SUMMING all TOTAL values
 * for that invoice.
 *
 * Each row represents a distinct item identified by its SKU.
 *
 * Accepts raw records with headers in any case.
 */

import type { CascadeStage } from '../../types/csv';
import type {
  IntegracionRawRecord,
  TransformedData,
  TransformedInvoice,
  TransformedItem,
} from './types';
import { parseCSV, parseMonetaryValue } from '../csv-validator';

/**
 * Parse raw CSV content into IntegracionRawRecord[], normalising header case
 * and monetary values.
 */
export function parseIntegracionCSV(content: string): IntegracionRawRecord[] {
  const rows = parseCSV(content);
  return rows.map((row) => ({
    TICKET_KEY: row['ticket_key'] ?? '',
    INVOICE: row['invoice'] ?? '',
    TOTAL: parseMonetaryValue(row['total'] ?? '0'),
    SKU: row['sku'] ?? '',
    CONCESION: row['concesion'] ?? '',
    CLI_DOC: row['cli_doc'] ?? '',
    TIPO_VENTA: row['tipo_venta'] ?? '',
    INTEGRATION_TICKET_DATE: row['integration_ticket_date'] ?? '',
  }));
}
/**
 * Transform an array of raw Integración CSV records into the normalised
 * {@link TransformedData} structure.
 *
 * @param records  - Parsed CSV rows (one per item).
 * @param uploadId - Unique identifier of the source upload.
 * @returns Normalised data ready for S3 storage and downstream processing.
 */
export function transformIntegracion(
  records: IntegracionRawRecord[],
  uploadId: string,
): TransformedData {
  const stage: CascadeStage = 'integracion';

  // Group rows by invoice number
  const invoiceMap = new Map<string, IntegracionRawRecord[]>();

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
      itemId: row.SKU,
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

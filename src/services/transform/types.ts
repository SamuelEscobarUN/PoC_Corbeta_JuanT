/**
 * Normalized data types for the transformation pipeline.
 *
 * After raw CSV records are parsed, each stage-specific transformer
 * groups rows by invoice and produces a uniform {@link TransformedData}
 * structure that downstream services (comparison, quality, AI) consume.
 */

import type { CascadeStage } from '../../types/csv';

/** A single line-item within an invoice. */
export interface TransformedItem {
  /** Item identifier — barcode for Geopos, SKU or INV_ITEM_ID for others. */
  itemId: string;
  /** Human-readable description (when available). */
  description?: string;
  /** Monetary value associated with this item. */
  value: number;
}

/** An invoice with its aggregated total and constituent items. */
export interface TransformedInvoice {
  /** Invoice number / identifier. */
  invoice: string;
  /** Invoice-level total (semantics depend on stage — see transformer). */
  totalFactura: number;
  /** Line-items belonging to this invoice. */
  items: TransformedItem[];
  /** Number of items in this invoice. */
  itemCount: number;
}

/** Top-level container for a fully transformed upload. */
export interface TransformedData {
  /** Cascade stage that produced this data. */
  stage: CascadeStage;
  /** Unique identifier of the source upload. */
  uploadId: string;
  /** Normalized invoices. */
  invoices: TransformedInvoice[];
  /** ISO-8601 timestamp of when the transformation ran. */
  processedAt: string;
}

/** Shape of a raw Geopos CSV row after parsing. */
export interface GeoposRawRecord {
  invoice: string;
  total: number;
  barcode: string;
  description: string;
}

/** Shape of a raw Integración CSV row after parsing. */
export interface IntegracionRawRecord {
  TICKET_KEY: string;
  INVOICE: string;
  TOTAL: number;
  SKU: string;
  CONCESION: string;
  CLI_DOC: string;
  TIPO_VENTA: string;
  INTEGRATION_TICKET_DATE: string;
}

/** Shape of a raw PS_CK CSV row after parsing. */
export interface PsCkRawRecord {
  ACCOUNTING_DT: string;
  CK_TIPO_VENTA: string;
  INV_ITEM_ID: string;
  INVOICE: string;
  QTY_REQUESTED: number;
  TOTAL: number;
}

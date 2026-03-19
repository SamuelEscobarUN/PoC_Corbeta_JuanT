/**
 * CSV validation types for the data reconciliation platform.
 *
 * Defines cascade stages, expected columns per stage, and
 * validation result structures used by the CSV validator.
 */

/** Cascade stages in the reconciliation pipeline. */
export type CascadeStage =
  | 'geopos_local'
  | 'geopos_central'
  | 'integracion'
  | 'ps_ck_intfc_vtapos';

/** Expected column headers for each cascade stage. */
export const STAGE_COLUMNS: Record<CascadeStage, string[]> = {
  geopos_local: ['invoice', 'total', 'barcode', 'description'],
  geopos_central: ['invoice', 'total', 'barcode', 'description'],
  integracion: [
    'TICKET_KEY',
    'INVOICE',
    'TOTAL',
    'SKU',
    'CONCESION',
    'CLI_DOC',
    'TIPO_VENTA',
    'INTEGRATION_TICKET_DATE',
  ],
  ps_ck_intfc_vtapos: [
    'ACCOUNTING_DT',
    'CK_TIPO_VENTA',
    'INV_ITEM_ID',
    'INVOICE',
    'QTY_REQUESTED',
    'TOTAL',
  ],
};

/** Discriminated error types returned by CSV validation. */
export interface ValidationError {
  type: 'missing_column' | 'invalid_format' | 'empty_file';
  message: string;
  details?: string;
}

/** Result of validating a CSV file against a cascade stage schema. */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

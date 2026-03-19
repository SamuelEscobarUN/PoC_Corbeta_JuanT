/**
 * Tipos para el motor de comparación progresiva entre etapas de la cascada.
 *
 * Define los tipos de discrepancia detectables, la estructura de cada
 * discrepancia y el resultado consolidado de una comparación entre dos etapas.
 */

import type { CascadeStage } from './csv';

/** Tipos de discrepancia detectables entre etapas consecutivas. */
export type DiscrepancyType =
  | 'missing_invoice'
  | 'total_difference'
  | 'item_count_difference'
  | 'missing_item';

/** Severidad de una discrepancia. */
export type DiscrepancySeverity = 'low' | 'medium' | 'high' | 'critical';

/** Detalle adicional de una discrepancia (almacenado como JSON en DynamoDB). */
export interface DiscrepancyDetails {
  /** Valor esperado (del source). */
  expectedValue?: string;
  /** Valor encontrado (en el target). */
  actualValue?: string;
  /** Identificador del ítem afectado (para missing_item). */
  itemId?: string;
  /** Descripción legible de la discrepancia. */
  message: string;
}

/** Una discrepancia detectada entre dos etapas consecutivas. */
export interface Discrepancy {
  /** Identificador único de la discrepancia. */
  discrepancyId: string;
  /** Etapa origen (source) de la comparación. */
  sourceStage: CascadeStage;
  /** Etapa destino (target) de la comparación. */
  targetStage: CascadeStage;
  /** Número de factura afectada. */
  invoice: string;
  /** Tipo de discrepancia detectada. */
  type: DiscrepancyType;
  /** Detalles adicionales de la discrepancia. */
  details: DiscrepancyDetails;
  /** Severidad estimada. */
  severity: DiscrepancySeverity;
  /** Timestamp ISO-8601 de detección. */
  detectedAt: string;
}

/** Resumen de conteos por tipo de discrepancia. */
export interface ComparisonSummary {
  missingInvoices: number;
  totalDifferences: number;
  itemCountDifferences: number;
  missingItems: number;
}

/** Resultado consolidado de comparar dos etapas consecutivas. */
export interface ComparisonResult {
  /** Etapa origen. */
  sourceStage: CascadeStage;
  /** Etapa destino. */
  targetStage: CascadeStage;
  /** Total de facturas comparadas (unión de ambas etapas). */
  totalInvoicesCompared: number;
  /** Discrepancias detectadas. */
  discrepancies: Discrepancy[];
  /** Resumen de conteos por tipo. */
  summary: ComparisonSummary;
}

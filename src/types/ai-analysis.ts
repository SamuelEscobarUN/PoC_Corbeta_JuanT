/**
 * Tipos para el motor de IA y análisis de discrepancias.
 *
 * Define las interfaces para hallazgos (Findings), hallazgos a nivel
 * de ítem (ItemFinding) y alertas de anomalías (AnomalyAlert) generadas
 * por el servicio de análisis con Amazon Bedrock.
 */

import type { DiscrepancySeverity } from './comparison';

/** Hallazgo a nivel de ítem individual dentro de una discrepancia. */
export interface ItemFinding {
  /** Identificador del ítem analizado. */
  itemId: string;
  /** Explicación del problema detectado para este ítem. */
  explanation: string;
  /** Acción sugerida para remediar el problema del ítem. */
  suggestedAction: string;
}

/** Hallazgo generado por el motor de IA para una discrepancia. */
export interface Finding {
  /** Identificador único del hallazgo. */
  findingId: string;
  /** Identificador de la discrepancia analizada. */
  discrepancyId: string;
  /** Explicación en lenguaje natural de la discrepancia. */
  explanation: string;
  /** Causa probable identificada por el modelo. */
  probableCause: string;
  /** Recomendación de acción correctiva. */
  recommendation: string;
  /** Severidad del hallazgo. */
  severity: DiscrepancySeverity;
  /** Hallazgos a nivel de ítem (cuando la discrepancia involucra múltiples ítems). */
  itemFindings: ItemFinding[];
  /** Timestamp ISO-8601 de creación del hallazgo. */
  createdAt: string;
}

/** Alerta de anomalía detectada por el motor de IA. */
export interface AnomalyAlert {
  /** Identificador único de la alerta. */
  alertId: string;
  /** Patrón anómalo detectado. */
  pattern: string;
  /** Severidad de la anomalía. */
  severity: DiscrepancySeverity;
  /** Facturas afectadas por la anomalía. */
  affectedInvoices: string[];
  /** Mensaje descriptivo de la anomalía. */
  message: string;
  /** Timestamp ISO-8601 de detección. */
  detectedAt: string;
}

/** Contexto adicional para el análisis de una discrepancia. */
export interface AnalysisContext {
  /** Historial de discrepancias previas para la misma factura. */
  previousDiscrepancies?: number;
  /** Nombre del archivo fuente. */
  sourceFileName?: string;
  /** Información adicional de contexto. */
  additionalInfo?: string;
}

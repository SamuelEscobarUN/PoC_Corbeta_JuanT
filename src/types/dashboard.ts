/**
 * Tipos para el dashboard consolidado de reconciliación.
 *
 * Define las estructuras de resumen, agrupación por etapas,
 * resultados de calidad y estado de remediación que consume
 * el componente de dashboard.
 */

import type { CascadeStage } from './csv';
import type { Discrepancy, DiscrepancyType } from './comparison';

/** Resumen general de reconciliación. */
export interface ReconciliationSummary {
  /** Total de facturas procesadas. */
  totalInvoices: number;
  /** Facturas con al menos una discrepancia. */
  invoicesWithDiscrepancies: number;
  /** Tasa de discrepancia (0-1). */
  discrepancyRate: number;
  /** Conteo de discrepancias por tipo. */
  countByType: Record<DiscrepancyType, number>;
}

/** Discrepancias agrupadas por par de etapas. */
export interface StageDiscrepancies {
  /** Par de etapas (source → target). */
  stagePair: { source: CascadeStage; target: CascadeStage };
  /** Discrepancias del par. */
  discrepancies: Discrepancy[];
  /** Cantidad total de discrepancias en este par. */
  count: number;
}

/** Resumen de resultados de calidad por dataset. */
export interface DatasetQualitySummary {
  /** Identificador del upload/dataset. */
  uploadId: string;
  /** Etapa de la cascada. */
  stage: CascadeStage;
  /** Total de reglas ejecutadas. */
  totalRules: number;
  /** Reglas que pasaron. */
  passed: number;
  /** Reglas que fallaron. */
  failed: number;
}

/** Resumen global de resultados de calidad. */
export interface QualityResultsSummary {
  /** Total de reglas ejecutadas globalmente. */
  totalRules: number;
  /** Total de reglas que pasaron. */
  passed: number;
  /** Total de reglas que fallaron. */
  failed: number;
  /** Desglose por dataset. */
  byDataset: DatasetQualitySummary[];
}

/** Estado de remediación. */
export interface RemediationStatus {
  /** Total de correcciones propuestas. */
  proposed: number;
  /** Correcciones pendientes de aprobación. */
  pendingApproval: number;
  /** Correcciones aprobadas. */
  approved: number;
  /** Correcciones rechazadas. */
  rejected: number;
  /** XML de corrección generados. */
  xmlGenerated: number;
}

/** Datos consolidados del dashboard. */
export interface DashboardData {
  /** Resumen de reconciliación. */
  reconciliation: ReconciliationSummary;
  /** Discrepancias agrupadas por par de etapas. */
  stageDiscrepancies: StageDiscrepancies[];
  /** Resumen de resultados de calidad. */
  quality: QualityResultsSummary;
  /** Estado de remediación. */
  remediation: RemediationStatus;
}

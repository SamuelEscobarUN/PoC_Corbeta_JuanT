/**
 * Tipos para el módulo de remediación y correcciones.
 *
 * Define los estados de corrección, la interfaz principal de Correction,
 * los inputs para proponer/aprobar/rechazar correcciones y los filtros
 * de consulta con paginación.
 */

import type { CascadeStage } from './csv';

/** Estados posibles de una corrección. */
export type CorrectionStatus = 'pending_approval' | 'approved' | 'rejected';

/** Corrección propuesta para remediar una discrepancia. */
export interface Correction {
  /** Identificador único de la corrección. */
  correctionId: string;
  /** Identificador de la discrepancia asociada. */
  discrepancyId: string;
  /** Identificador del hallazgo asociado. */
  findingId: string;
  /** Número de factura afectada. */
  invoice: string;
  /** Ítem afectado (opcional). */
  item?: string;
  /** Etapa de origen de la discrepancia. */
  originStage: CascadeStage;
  /** Valores corregidos (objeto JSON libre). */
  correctedValues: Record<string, unknown>;
  /** Estado actual de la corrección. */
  status: CorrectionStatus;
  /** Usuario que propuso la corrección. */
  proposedBy: string;
  /** Timestamp ISO-8601 de propuesta. */
  proposedAt: string;
  /** Usuario que aprobó la corrección. */
  approvedBy?: string;
  /** Usuario que rechazó la corrección. */
  rejectedBy?: string;
  /** Motivo de rechazo. */
  rejectionReason?: string;
  /** Timestamp ISO-8601 de revisión (aprobación o rechazo). */
  reviewedAt?: string;
  /** Clave S3 del XML generado (solo si aprobada). */
  xmlS3Key?: string;
  /** Timestamp ISO-8601 de creación. */
  createdAt: string;
  /** Timestamp ISO-8601 de última actualización. */
  updatedAt: string;
}

/** Input para proponer una nueva corrección. */
export interface ProposeCorrectionInput {
  /** Identificador de la discrepancia asociada. */
  discrepancyId: string;
  /** Identificador del hallazgo asociado. */
  findingId: string;
  /** Número de factura afectada. */
  invoice: string;
  /** Ítem afectado (opcional). */
  item?: string;
  /** Etapa de origen de la discrepancia. */
  originStage: CascadeStage;
  /** Valores corregidos. */
  correctedValues: Record<string, unknown>;
  /** Usuario que propone la corrección. */
  proposedBy: string;
  /** Identificador de la sesión activa (opcional para retrocompatibilidad). */
  sessionId?: string;
}

/** Input para aprobar una corrección. */
export interface ApproveCorrectionInput {
  /** Identificador de la corrección a aprobar. */
  correctionId: string;
  /** Usuario que aprueba. */
  approvedBy: string;
}

/** Input para rechazar una corrección. */
export interface RejectCorrectionInput {
  /** Identificador de la corrección a rechazar. */
  correctionId: string;
  /** Usuario que rechaza. */
  rejectedBy: string;
  /** Motivo del rechazo. */
  reason: string;
}

/** Filtros para consultar correcciones con paginación. */
export interface CorrectionFilter {
  /** Filtrar por estado. */
  status?: CorrectionStatus;
  /** Número de página (1-indexed). */
  page?: number;
  /** Tamaño de página. */
  pageSize?: number;
}

/** Resultado paginado de correcciones. */
export interface PaginatedCorrections {
  /** Lista de correcciones. */
  items: Correction[];
  /** Token para la siguiente página (si existe). */
  nextToken?: string;
  /** Total de resultados (estimado). */
  total: number;
}

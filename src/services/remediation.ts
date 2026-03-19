/**
 * RemediationService — servicio de remediación y correcciones.
 *
 * Funcionalidades:
 *  - proposeCorrection: registra una corrección con estado `pending_approval`
 *  - approveCorrection: cambia estado a `approved`, dispara generación de XML
 *  - rejectCorrection: cambia estado a `rejected`, registra motivo, notifica vía SNS
 *  - getCorrections: consulta correcciones con filtros por estado y paginación (GSI status-index)
 *  - getCorrection: obtiene una corrección individual por ID
 *
 * Usa Amplify Data (generateClient) para operaciones DynamoDB.
 * Requisitos: 9.1, 9.2, 9.3, 9.7
 */

import { generateClient } from 'aws-amplify/data';

import type { Schema } from '../../amplify/data/resource';
import type {
  Correction,
  CorrectionStatus,
  ProposeCorrectionInput,
  CorrectionFilter,
  PaginatedCorrections,
} from '../types/remediation';

/** Cliente Amplify Data tipado con nuestro esquema. */
const client = generateClient<Schema>();

/** Tamaño de página por defecto para consultas paginadas. */
const DEFAULT_PAGE_SIZE = 20;

export class RemediationService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: RemediationService;

  constructor() {
    // Constructor público para permitir instancias de testing
  }

  static getInstance(): RemediationService {
    if (!RemediationService.instance) {
      RemediationService.instance = new RemediationService();
    }
    return RemediationService.instance;
  }

  /* ------------------------------------------------------------------ */
  /*  Proponer corrección                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Registrar una nueva corrección con estado `pending_approval`.
   *
   * Crea el registro en la tabla Corrections de DynamoDB con los datos
   * proporcionados y timestamps de creación.
   */
  async proposeCorrection(input: ProposeCorrectionInput): Promise<Correction> {
    const now = new Date().toISOString();
    const correctionId = crypto.randomUUID();

    const record = {
      correctionId,
      discrepancyId: input.discrepancyId,
      findingId: input.findingId,
      invoice: input.invoice,
      item: input.item,
      originStage: input.originStage,
      correctedValues: JSON.stringify(input.correctedValues),
      status: 'pending_approval' as const,
      proposedBy: input.proposedBy,
      proposedAt: now,
    };

    try {
      await client.models.Correction.create(record);
    } catch (error) {
      console.error(`Error al crear corrección para factura ${input.invoice}:`, error);
      throw error;
    }

    return {
      correctionId,
      discrepancyId: input.discrepancyId,
      findingId: input.findingId,
      invoice: input.invoice,
      item: input.item,
      originStage: input.originStage,
      correctedValues: input.correctedValues,
      status: 'pending_approval',
      proposedBy: input.proposedBy,
      proposedAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Aprobar corrección                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Cambiar estado de una corrección a `approved`.
   *
   * Actualiza el registro en DynamoDB y dispara la generación de XML
   * (placeholder — la generación real se implementa en tarea 11.4).
   */
  async approveCorrection(correctionId: string, approvedBy: string): Promise<Correction> {
    const now = new Date().toISOString();

    // Obtener la corrección actual
    const existing = await this.getCorrection(correctionId);
    if (!existing) {
      throw new Error(`Corrección ${correctionId} no encontrada`);
    }

    if (existing.status !== 'pending_approval') {
      throw new Error(
        `No se puede aprobar corrección con estado "${existing.status}". Solo se pueden aprobar correcciones pendientes.`,
      );
    }

    try {
      await client.models.Correction.update({
        correctionId,
        status: 'approved' as const,
        reviewedBy: approvedBy,
        reviewedAt: now,
      });
    } catch (error) {
      console.error(`Error al aprobar corrección ${correctionId}:`, error);
      throw error;
    }

    // Disparar generación de XML de corrección
    const approvedCorrection: Correction = {
      ...existing,
      status: 'approved',
      approvedBy,
      reviewedAt: now,
      updatedAt: now,
    };

    try {
      const { xmlGeneratorService } = await import('./xml-generator');
      await xmlGeneratorService.saveCorrectionXml(approvedCorrection);
    } catch (xmlError) {
      console.error(`Error al generar XML para corrección ${correctionId}:`, xmlError);
      // No bloquear la aprobación si falla la generación de XML
    }

    return approvedCorrection;
  }

  /* ------------------------------------------------------------------ */
  /*  Rechazar corrección                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Cambiar estado de una corrección a `rejected`.
   *
   * Registra el motivo de rechazo y envía notificación al operador
   * vía SNS/SES (placeholder).
   */
  async rejectCorrection(
    correctionId: string,
    rejectedBy: string,
    reason: string,
  ): Promise<Correction> {
    const now = new Date().toISOString();

    if (!reason || reason.trim().length === 0) {
      throw new Error('El motivo de rechazo es obligatorio');
    }

    // Obtener la corrección actual
    const existing = await this.getCorrection(correctionId);
    if (!existing) {
      throw new Error(`Corrección ${correctionId} no encontrada`);
    }

    if (existing.status !== 'pending_approval') {
      throw new Error(
        `No se puede rechazar corrección con estado "${existing.status}". Solo se pueden rechazar correcciones pendientes.`,
      );
    }

    try {
      await client.models.Correction.update({
        correctionId,
        status: 'rejected' as const,
        reviewedBy: rejectedBy,
        reviewedAt: now,
        rejectionReason: reason,
      });
    } catch (error) {
      console.error(`Error al rechazar corrección ${correctionId}:`, error);
      throw error;
    }

    // Notificar al operador vía SNS (placeholder)
    await this.notifyOperator(existing, rejectedBy, reason);

    return {
      ...existing,
      status: 'rejected',
      rejectedBy,
      rejectionReason: reason,
      reviewedAt: now,
      updatedAt: now,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Consultar correcciones con filtros y paginación                   */
  /* ------------------------------------------------------------------ */

  /**
   * Consultar correcciones con filtros por estado y paginación.
   *
   * Usa el GSI `status-index` cuando se filtra por estado.
   * Sin filtro de estado, lista todas las correcciones.
   */
  async getCorrections(filter?: CorrectionFilter): Promise<PaginatedCorrections> {
    const pageSize = filter?.pageSize ?? DEFAULT_PAGE_SIZE;

    try {
      let data: Array<Record<string, unknown>>;

      if (filter?.status) {
        // Consultar usando GSI status-index
        const response = await client.models.Correction.listCorrectionByStatusAndProposedAt(
          { status: filter.status },
          { limit: pageSize, sortDirection: 'DESC' },
        );
        data = (response.data ?? []) as unknown as Array<Record<string, unknown>>;
      } else {
        // Listar todas las correcciones
        const response = await client.models.Correction.list({
          limit: pageSize,
        });
        data = (response.data ?? []) as unknown as Array<Record<string, unknown>>;
      }

      const items = data.map((item) => this.mapDynamoToCorrection(item));

      return {
        items,
        total: items.length,
      };
    } catch (error) {
      console.error('Error al consultar correcciones:', error);
      return { items: [], total: 0 };
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Obtener corrección individual                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Obtener una corrección por su ID.
   */
  async getCorrection(correctionId: string): Promise<Correction | null> {
    try {
      const { data } = await client.models.Correction.get({ correctionId });

      if (!data) return null;

      return this.mapDynamoToCorrection(data as unknown as Record<string, unknown>);
    } catch (error) {
      console.error(`Error al obtener corrección ${correctionId}:`, error);
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers internos                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Mapear registro de DynamoDB a interfaz Correction.
   */
  private mapDynamoToCorrection(item: Record<string, unknown>): Correction {
    let correctedValues: Record<string, unknown> = {};
    if (typeof item.correctedValues === 'string') {
      try {
        correctedValues = JSON.parse(item.correctedValues);
      } catch {
        correctedValues = {};
      }
    } else if (item.correctedValues && typeof item.correctedValues === 'object') {
      correctedValues = item.correctedValues as Record<string, unknown>;
    }

    return {
      correctionId: item.correctionId as string,
      discrepancyId: item.discrepancyId as string,
      findingId: item.findingId as string,
      invoice: item.invoice as string,
      item: item.item as string | undefined,
      originStage: item.originStage as Correction['originStage'],
      correctedValues,
      status: item.status as CorrectionStatus,
      proposedBy: item.proposedBy as string,
      proposedAt: (item.proposedAt as string) ?? (item.createdAt as string),
      approvedBy: item.reviewedBy as string | undefined,
      rejectedBy: item.status === 'rejected' ? (item.reviewedBy as string | undefined) : undefined,
      rejectionReason: item.rejectionReason as string | undefined,
      reviewedAt: item.reviewedAt as string | undefined,
      xmlS3Key: item.xmlS3Key as string | undefined,
      createdAt: (item.createdAt as string) ?? (item.proposedAt as string),
      updatedAt: (item.updatedAt as string) ?? (item.proposedAt as string),
    };
  }

  /**
   * Notificar al operador sobre el rechazo de una corrección (placeholder SNS/SES).
   *
   * En producción, esto publicará un mensaje en un topic SNS o enviará
   * un email vía SES al operador que propuso la corrección.
   */
  protected async notifyOperator(
    correction: Correction,
    rejectedBy: string,
    reason: string,
  ): Promise<void> {
    // Placeholder: log de notificación
    console.info(
      `[SNS/SES] Notificación de rechazo enviada a ${correction.proposedBy}. ` +
        `Corrección ${correction.correctionId} rechazada por ${rejectedBy}. ` +
        `Motivo: ${reason}`,
    );
  }
}

/** Instancia singleton por defecto. */
export const remediationService = RemediationService.getInstance();

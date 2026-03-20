/**
 * SessionService — servicio de sesiones de trabajo.
 *
 * Funcionalidades:
 *  - createSession: crea una sesión con estado `in_progress`
 *  - getSession: obtiene una sesión por ID
 *  - listSessions: lista sesiones con filtro por estado (GSI status-date-index) y búsqueda por nombre (client-side)
 *  - updateSessionStatus: cambia estado, registra completedAt si status es `completed`
 *  - updateSessionCounts: actualiza contadores de discrepancias y hallazgos
 *  - getSessionUploads: obtiene uploads asociados a una sesión (GSI sessionId-stage-index)
 *  - getSessionDiscrepancies: obtiene discrepancias por sessionId
 *  - getSessionFindings: obtiene hallazgos por sessionId
 *  - getSessionCorrections: obtiene correcciones por sessionId
 *
 * Usa Amplify Data (generateClient) para operaciones DynamoDB.
 * Requisitos: 1.5, 2.2, 3.3, 3.4, 4.2, 4.3, 6.4
 */

import { generateClient } from 'aws-amplify/data';
import { remove } from 'aws-amplify/storage';

import type { Schema } from '../../amplify/data/resource';
import type {
  Session,
  SessionStatus,
  CreateSessionInput,
  SessionFilters,
  PaginatedSessions,
} from '../types/session';
import type { Discrepancy, DiscrepancyDetails, DiscrepancyType, DiscrepancySeverity } from '../types/comparison';
import type { Finding } from '../types/ai-analysis';
import type { Correction, CorrectionStatus } from '../types/remediation';
import type { UploadRecord } from '../types/upload';
import type { CascadeStage } from '../types/csv';

/** Cliente Amplify Data tipado con nuestro esquema. */
const client = generateClient<Schema>();

/** Transiciones de estado válidas. */
const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  in_progress: ['completed'],
  completed: ['archived'],
  archived: [],
};

export class SessionService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: SessionService;

  constructor() {
    // Constructor público para permitir instancias de testing
  }

  static getInstance(): SessionService {
    if (!SessionService.instance) {
      SessionService.instance = new SessionService();
    }
    return SessionService.instance;
  }

  /* ------------------------------------------------------------------ */
  /*  Crear sesión                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Crear una nueva sesión de trabajo con estado `in_progress`.
   *
   * Genera un sessionId único y registra la fecha de creación.
   */
  async createSession(input: CreateSessionInput): Promise<Session> {
    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();

    const record = {
      sessionId,
      sessionName: input.sessionName,
      status: 'in_progress' as const,
      createdBy: input.createdBy,
      createdAt: now,
      uploadIds: input.uploadIds,
      discrepancyCount: 0,
      findingCount: 0,
    };

    try {
      await client.models.Session.create(record);
    } catch (error) {
      console.error(`Error al crear sesión "${input.sessionName}":`, error);
      throw error;
    }

    return {
      sessionId,
      sessionName: input.sessionName,
      status: 'in_progress',
      createdBy: input.createdBy,
      createdAt: now,
      uploadIds: input.uploadIds,
      discrepancyCount: 0,
      findingCount: 0,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Eliminar sesión                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Eliminar una sesión por su ID.
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      // 1. Obtener uploads asociados a la sesión
      const uploads = await this.getSessionUploads(sessionId);

      // 2. Eliminar cada upload: archivo de S3 + registro de DynamoDB
      await Promise.all(
        uploads.map(async (upload) => {
          try {
            await remove({
              path: upload.s3Key,
              options: { bucket: 'reconciliationStorage' },
            });
          } catch {
            // Best-effort: el archivo puede no existir en S3
          }
          await client.models.Upload.delete({ uploadId: upload.uploadId });
        }),
      );

      // 3. Eliminar la sesión
      await client.models.Session.delete({ sessionId });
    } catch (error) {
      console.error(`Error al eliminar sesión ${sessionId}:`, error);
      throw error;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Obtener sesión por ID                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Obtener una sesión por su ID.
   */
  async getSession(sessionId: string): Promise<Session | null> {
    try {
      const { data } = await client.models.Session.get({ sessionId });

      if (!data) return null;

      return this.mapDynamoToSession(data as unknown as Record<string, unknown>);
    } catch (error) {
      console.error(`Error al obtener sesión ${sessionId}:`, error);
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Listar sesiones con filtros                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Listar sesiones con filtros opcionales por estado y búsqueda por nombre.
   *
   * Si se proporciona filtro de estado, usa el GSI `status-date-index`
   * para consultar por estado ordenado por createdAt descendente.
   * Si no hay filtro de estado, lista todas las sesiones.
   * La búsqueda por nombre se aplica client-side (case-insensitive contains).
   */
  async listSessions(filters?: SessionFilters): Promise<PaginatedSessions> {
    try {
      let data: Array<Record<string, unknown>>;
      let nextToken: string | null = null;

      if (filters?.status) {
        // Consultar usando GSI status-date-index
        const response = await client.models.Session.listSessionByStatusAndCreatedAt(
          { status: filters.status },
          { sortDirection: 'DESC' },
        );
        data = (response.data ?? []) as unknown as Array<Record<string, unknown>>;
        nextToken = response.nextToken ?? null;
      } else {
        // Listar todas las sesiones
        const response = await client.models.Session.list();
        data = (response.data ?? []) as unknown as Array<Record<string, unknown>>;
        nextToken = response.nextToken ?? null;
      }

      let items = data.map((item) => this.mapDynamoToSession(item));

      // Ordenar por createdAt descendente (más recientes primero)
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Aplicar búsqueda por nombre client-side (case-insensitive contains)
      if (filters?.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        items = items.filter((session) =>
          session.sessionName.toLowerCase().includes(query),
        );
      }

      return { items, nextToken };
    } catch (error) {
      console.error('Error al listar sesiones:', error);
      return { items: [], nextToken: null };
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Actualizar estado de sesión                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Cambiar el estado de una sesión.
   *
   * Valida transiciones de estado (no permite archived → in_progress).
   * Si el nuevo estado es `completed`, registra completedAt con la fecha actual.
   */
  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<Session> {
    // Obtener la sesión actual
    const existing = await this.getSession(sessionId);
    if (!existing) {
      throw new Error(`Sesión ${sessionId} no encontrada`);
    }

    // Validar transición de estado
    const allowedTransitions = VALID_TRANSITIONS[existing.status];
    if (!allowedTransitions.includes(status)) {
      throw new Error(
        `Transición de estado inválida: no se puede cambiar de "${existing.status}" a "${status}"`,
      );
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      sessionId,
      status,
    };

    // Si el nuevo estado es completed, registrar completedAt
    if (status === 'completed') {
      updateData.completedAt = now;
    }

    try {
      await client.models.Session.update(updateData as Parameters<typeof client.models.Session.update>[0]);
    } catch (error) {
      console.error(`Error al actualizar estado de sesión ${sessionId}:`, error);
      throw error;
    }

    return {
      ...existing,
      status,
      completedAt: status === 'completed' ? now : existing.completedAt,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Actualizar contadores                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Actualizar los contadores de discrepancias y hallazgos de una sesión.
   */
  async updateSessionCounts(
    sessionId: string,
    discrepancyCount: number,
    findingCount: number,
  ): Promise<void> {
    try {
      await client.models.Session.update({
        sessionId,
        discrepancyCount,
        findingCount,
      });
    } catch (error) {
      console.error(`Error al actualizar contadores de sesión ${sessionId}:`, error);
      throw error;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Obtener uploads de sesión                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Obtener uploads asociados a una sesión.
   *
   * Consulta el GSI sessionId-stage-index para obtener los uploads
   * asociados a una sesión, ordenados por etapa.
   */
  async getSessionUploads(sessionId: string): Promise<UploadRecord[]> {
    try {
      const response = await client.models.Upload.listUploadBySessionIdAndStage(
        { sessionId },
        { sortDirection: 'ASC' },
      );

      return (response.data ?? []).map((item) => ({
        uploadId: item.uploadId,
        sessionId: item.sessionId ?? undefined,
        stage: item.stage as CascadeStage,
        fileName: item.fileName,
        fileSize: item.fileSize ?? 0,
        status: item.status as UploadRecord['status'],
        s3Key: item.s3Key,
        uploadedBy: item.uploadedBy,
        uploadedAt: item.uploadedAt,
        errorMessage: item.errorMessage ?? undefined,
      }));
    } catch (error) {
      console.error(`Error al obtener uploads de sesión ${sessionId}:`, error);
      return [];
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Obtener artefactos de sesión                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Obtener discrepancias asociadas a una sesión.
   *
   * Usa la partition key sessionId del modelo Discrepancy.
   */
  async getSessionDiscrepancies(sessionId: string): Promise<Discrepancy[]> {
    try {
      const { data } = await client.models.Discrepancy.list({
        filter: { sessionId: { eq: sessionId } },
      });

      return (data ?? []).map((item) => {
        const raw = item as unknown as Record<string, unknown>;
        const details: DiscrepancyDetails = raw.details
          ? (raw.details as unknown as DiscrepancyDetails)
          : { message: '' };

        return {
          discrepancyId: raw.discrepancyId as string,
          sourceStage: raw.sourceStage as Discrepancy['sourceStage'],
          targetStage: raw.targetStage as Discrepancy['targetStage'],
          invoice: raw.invoice as string,
          type: raw.type as DiscrepancyType,
          details,
          severity: this.inferDiscrepancySeverity(raw.type as DiscrepancyType),
          detectedAt: raw.detectedAt as string,
        };
      });
    } catch (error) {
      console.error(`Error al obtener discrepancias de sesión ${sessionId}:`, error);
      return [];
    }
  }

  /**
   * Obtener hallazgos IA asociados a una sesión.
   */
  async getSessionFindings(sessionId: string): Promise<Finding[]> {
    try {
      const { data } = await client.models.Finding.list({
        filter: { sessionId: { eq: sessionId } },
      });

      return (data ?? []).map((item) => {
        const raw = item as unknown as Record<string, unknown>;
        return {
          findingId: raw.findingId as string,
          discrepancyId: raw.discrepancyId as string,
          explanation: raw.explanation as string,
          probableCause: raw.probableCause as string,
          recommendation: raw.recommendation as string,
          severity: (raw.severity as Finding['severity']) ?? 'medium',
          itemFindings: [],
          createdAt: (raw.analyzedAt as string) ?? '',
        };
      });
    } catch (error) {
      console.error(`Error al obtener hallazgos de sesión ${sessionId}:`, error);
      return [];
    }
  }

  /**
   * Obtener correcciones asociadas a una sesión.
   */
  async getSessionCorrections(sessionId: string): Promise<Correction[]> {
    try {
      const { data } = await client.models.Correction.list({
        filter: { sessionId: { eq: sessionId } },
      });

      return (data ?? []).map((item) => {
        const raw = item as unknown as Record<string, unknown>;
        return this.mapDynamoToCorrection(raw);
      });
    } catch (error) {
      console.error(`Error al obtener correcciones de sesión ${sessionId}:`, error);
      return [];
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers internos                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Mapear registro de DynamoDB a interfaz Session.
   */
  private mapDynamoToSession(item: Record<string, unknown>): Session {
    return {
      sessionId: item.sessionId as string,
      sessionName: item.sessionName as string,
      status: item.status as SessionStatus,
      createdBy: item.createdBy as string,
      createdAt: item.createdAt as string,
      completedAt: item.completedAt as string | undefined,
      uploadIds: (item.uploadIds as string[]) ?? [],
      discrepancyCount: (item.discrepancyCount as number) ?? 0,
      findingCount: (item.findingCount as number) ?? 0,
    };
  }

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
   * Inferir severidad a partir del tipo de discrepancia.
   */
  private inferDiscrepancySeverity(type: DiscrepancyType): DiscrepancySeverity {
    switch (type) {
      case 'missing_invoice':
        return 'high';
      case 'total_difference':
        return 'medium';
      case 'item_count_difference':
        return 'medium';
      case 'missing_item':
        return 'high';
      default:
        return 'medium';
    }
  }
}

/** Instancia singleton por defecto. */
export const sessionService = SessionService.getInstance();

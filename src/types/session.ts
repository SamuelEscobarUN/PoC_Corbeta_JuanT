/**
 * Tipos para sesiones de trabajo de la plataforma de reconciliación.
 *
 * Define el estado de una sesión, su estructura, los datos de entrada
 * para creación, filtros de consulta y paginación.
 */

/** Estados posibles de una sesión de trabajo. */
export type SessionStatus = 'in_progress' | 'completed' | 'archived';

/** Una sesión de trabajo persistida en DynamoDB. */
export interface Session {
  sessionId: string;
  sessionName: string;
  status: SessionStatus;
  createdBy: string;
  createdAt: string;
  completedAt?: string;
  uploadIds: string[];
  discrepancyCount?: number;
  findingCount?: number;
}

/** Datos de entrada para crear una nueva sesión. */
export interface CreateSessionInput {
  sessionName: string;
  uploadIds: string[];
  createdBy: string;
}

/** Filtros opcionales para consultar sesiones. */
export interface SessionFilters {
  status?: SessionStatus;
  searchQuery?: string;
}

/** Resultado paginado de sesiones. */
export interface PaginatedSessions {
  items: Session[];
  nextToken?: string | null;
}

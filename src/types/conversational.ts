/**
 * Tipos para el agente conversacional de reconciliación.
 *
 * Define las interfaces para intenciones de consulta, mensajes
 * de conversación y resultados de consulta procesados por el
 * servicio ConversationalAgentService.
 */

/** Intenciones de consulta soportadas por el agente conversacional. */
export type QueryIntent =
  | 'invoice_search'
  | 'discrepancy_query'
  | 'item_tracking'
  | 'incident_summary'
  | 'finding_explanation'
  | 'quality_query'
  | 'general';

/** Mensaje individual en la conversación. */
export interface ConversationMessage {
  /** Rol del emisor del mensaje. */
  role: 'user' | 'assistant';
  /** Contenido textual del mensaje. */
  content: string;
  /** Timestamp ISO-8601 del mensaje. */
  timestamp: string;
  /** Datos estructurados asociados al mensaje (opcional). */
  data?: unknown;
}

/** Resultado de procesar una consulta del usuario. */
export interface QueryResult {
  /** Intención clasificada de la consulta. */
  intent: QueryIntent;
  /** Respuesta generada en lenguaje natural. */
  response: string;
  /** Datos estructurados asociados a la respuesta (opcional). */
  data?: unknown;
}

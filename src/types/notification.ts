/**
 * Tipos para el servicio de notificaciones SNS/SES.
 *
 * Define las interfaces para alertas de calidad, notificaciones
 * de aprobación y rechazo de correcciones.
 */

/** Resultado de envío de una notificación. */
export interface NotificationResult {
  /** Indica si la notificación fue enviada exitosamente. */
  success: boolean;
  /** Identificador del mensaje (placeholder). */
  messageId: string;
  /** Timestamp ISO-8601 de envío. */
  sentAt: string;
}

/** Payload para alerta de calidad. */
export interface QualityAlertNotification {
  ruleId: string;
  datasetId: string;
  message: string;
}

/** Payload para notificación de corrección aprobada. */
export interface CorrectionApprovedNotification {
  correctionId: string;
  operatorEmail: string;
}

/** Payload para notificación de corrección rechazada. */
export interface CorrectionRejectedNotification {
  correctionId: string;
  operatorEmail: string;
  reason: string;
}

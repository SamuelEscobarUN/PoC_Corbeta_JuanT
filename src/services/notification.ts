/**
 * NotificationService — servicio stub para notificaciones SNS/SES.
 *
 * Proporciona métodos para enviar alertas de calidad y notificaciones
 * de aprobación/rechazo de correcciones. Actualmente es un placeholder
 * que registra en consola; la integración real con SNS/SES se haría
 * en el backend Lambda.
 *
 * Requisitos: 12.4
 */

import type {
  NotificationResult,
  QualityAlertNotification,
  CorrectionApprovedNotification,
  CorrectionRejectedNotification,
} from '../types/notification';

export class NotificationService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: NotificationService;

  constructor() {
    // Constructor público para permitir instancias de testing
  }

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /* ------------------------------------------------------------------ */
  /*  Alerta de calidad                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Enviar alerta de calidad cuando una regla falla.
   *
   * Stub: registra en consola. En producción se enviaría vía SNS/SES.
   */
  async sendQualityAlert(
    ruleId: string,
    datasetId: string,
    message: string,
  ): Promise<NotificationResult> {
    const payload: QualityAlertNotification = { ruleId, datasetId, message };
    const result = this.buildResult();

    console.info(
      `[SNS/SES] Alerta de calidad enviada — regla: ${ruleId}, dataset: ${datasetId}`,
      payload,
    );

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Corrección aprobada                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Enviar notificación de corrección aprobada al operador.
   *
   * Stub: registra en consola. En producción se enviaría vía SES.
   */
  async sendCorrectionApproved(
    correctionId: string,
    operatorEmail: string,
  ): Promise<NotificationResult> {
    const payload: CorrectionApprovedNotification = { correctionId, operatorEmail };
    const result = this.buildResult();

    console.info(
      `[SNS/SES] Notificación de aprobación enviada a ${operatorEmail} — corrección: ${correctionId}`,
      payload,
    );

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Corrección rechazada                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Enviar notificación de corrección rechazada al operador.
   *
   * Stub: registra en consola. En producción se enviaría vía SES.
   */
  async sendCorrectionRejected(
    correctionId: string,
    operatorEmail: string,
    reason: string,
  ): Promise<NotificationResult> {
    const payload: CorrectionRejectedNotification = { correctionId, operatorEmail, reason };
    const result = this.buildResult();

    console.info(
      `[SNS/SES] Notificación de rechazo enviada a ${operatorEmail} — corrección: ${correctionId}, motivo: ${reason}`,
      payload,
    );

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers internos                                                  */
  /* ------------------------------------------------------------------ */

  private buildResult(): NotificationResult {
    return {
      success: true,
      messageId: crypto.randomUUID(),
      sentAt: new Date().toISOString(),
    };
  }
}

/** Instancia singleton por defecto. */
export const notificationService = NotificationService.getInstance();

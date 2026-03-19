/**
 * Tests para NotificationService — servicio stub de notificaciones SNS/SES.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from './notification';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    service = new NotificationService();
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  describe('sendQualityAlert', () => {
    it('retorna resultado exitoso con messageId y timestamp', async () => {
      const result = await service.sendQualityAlert(
        'rule-1',
        'dataset-1',
        'Regla de completitud falló',
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBeTruthy();
      expect(result.sentAt).toBeTruthy();
    });

    it('registra en consola los datos de la alerta', async () => {
      await service.sendQualityAlert('rule-2', 'dataset-2', 'Fallo de formato');

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('Alerta de calidad'),
        expect.objectContaining({ ruleId: 'rule-2', datasetId: 'dataset-2' }),
      );
    });
  });

  describe('sendCorrectionApproved', () => {
    it('retorna resultado exitoso', async () => {
      const result = await service.sendCorrectionApproved(
        'corr-1',
        'operador@ejemplo.com',
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBeTruthy();
    });

    it('registra en consola la notificación de aprobación', async () => {
      await service.sendCorrectionApproved('corr-1', 'op@test.com');

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('aprobación'),
        expect.objectContaining({ correctionId: 'corr-1', operatorEmail: 'op@test.com' }),
      );
    });
  });

  describe('sendCorrectionRejected', () => {
    it('retorna resultado exitoso', async () => {
      const result = await service.sendCorrectionRejected(
        'corr-2',
        'operador@ejemplo.com',
        'Datos incorrectos',
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBeTruthy();
    });

    it('registra en consola la notificación de rechazo con motivo', async () => {
      await service.sendCorrectionRejected('corr-2', 'op@test.com', 'Motivo X');

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('rechazo'),
        expect.objectContaining({
          correctionId: 'corr-2',
          operatorEmail: 'op@test.com',
          reason: 'Motivo X',
        }),
      );
    });
  });

  describe('singleton', () => {
    it('getInstance retorna la misma instancia', () => {
      const a = NotificationService.getInstance();
      const b = NotificationService.getInstance();
      expect(a).toBe(b);
    });
  });
});

/**
 * Tests para ReconciliationPipelineService — orquestación end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReconciliationPipelineService } from './reconciliation-pipeline';
import type { TransformedData } from './transform/types';
import type { QualityExecutionSummary } from '../types/quality';
import type { ComparisonResult } from '../types/comparison';
import type { Finding } from '../types/ai-analysis';
import type { Correction } from '../types/remediation';

// ---- Mocks de servicios ----

const mockTransformUpload = vi.fn();
const mockExecuteRules = vi.fn();
const mockCompareStages = vi.fn();
const mockSaveDiscrepancies = vi.fn();
const mockAnalyzeDiscrepancy = vi.fn();
const mockSaveFinding = vi.fn();
const mockApproveCorrection = vi.fn();
const mockRejectCorrection = vi.fn();
const mockSendQualityAlert = vi.fn();
const mockSendCorrectionApproved = vi.fn();
const mockSendCorrectionRejected = vi.fn();

const mockTransformationService = { transformUpload: mockTransformUpload } as any;
const mockQualityRulesService = { executeRules: mockExecuteRules } as any;
const mockComparisonService = {
  compareStages: mockCompareStages,
  saveDiscrepancies: mockSaveDiscrepancies,
} as any;
const mockAIAnalysisService = {
  analyzeDiscrepancy: mockAnalyzeDiscrepancy,
  saveFinding: mockSaveFinding,
} as any;
const mockRemediationService = {
  approveCorrection: mockApproveCorrection,
  rejectCorrection: mockRejectCorrection,
} as any;
const mockNotificationService = {
  sendQualityAlert: mockSendQualityAlert,
  sendCorrectionApproved: mockSendCorrectionApproved,
  sendCorrectionRejected: mockSendCorrectionRejected,
} as any;

// ---- Datos de prueba ----

const sampleTransformed: TransformedData = {
  stage: 'geopos_local',
  uploadId: 'upload-1',
  invoices: [
    { invoice: 'INV-001', totalFactura: 100, items: [{ itemId: 'ITEM-1', value: 100 }], itemCount: 1 },
  ],
  processedAt: new Date().toISOString(),
};

const sampleQualityPassed: QualityExecutionSummary = {
  uploadId: 'upload-1',
  stage: 'geopos_local',
  totalRules: 2,
  passed: 2,
  failed: 0,
  results: [
    {
      uploadId: 'upload-1',
      ruleId: 'r1',
      ruleName: 'Completitud',
      ruleExpression: 'completeness',
      result: 'passed',
      details: { recordsEvaluated: 10, recordsPassed: 10, recordsFailed: 0, compliancePercent: 100, message: 'OK' },
      executedAt: new Date().toISOString(),
    },
    {
      uploadId: 'upload-1',
      ruleId: 'r2',
      ruleName: 'Unicidad',
      ruleExpression: 'uniqueness',
      result: 'passed',
      details: { recordsEvaluated: 10, recordsPassed: 10, recordsFailed: 0, compliancePercent: 100, message: 'OK' },
      executedAt: new Date().toISOString(),
    },
  ],
  alerts: [],
  executedAt: new Date().toISOString(),
};

const sampleQualityFailed: QualityExecutionSummary = {
  uploadId: 'upload-1',
  stage: 'geopos_local',
  totalRules: 2,
  passed: 1,
  failed: 1,
  results: [
    {
      uploadId: 'upload-1',
      ruleId: 'r1',
      ruleName: 'Completitud',
      ruleExpression: 'completeness',
      result: 'passed',
      details: { recordsEvaluated: 10, recordsPassed: 10, recordsFailed: 0, compliancePercent: 100, message: 'OK' },
      executedAt: new Date().toISOString(),
    },
    {
      uploadId: 'upload-1',
      ruleId: 'r2',
      ruleName: 'Formato',
      ruleExpression: 'format',
      result: 'failed',
      details: { recordsEvaluated: 10, recordsPassed: 5, recordsFailed: 5, compliancePercent: 50, message: '5 registros con formato inválido' },
      executedAt: new Date().toISOString(),
    },
  ],
  alerts: [],
  executedAt: new Date().toISOString(),
};

const sampleComparison: ComparisonResult = {
  sourceStage: 'geopos_local',
  targetStage: 'geopos_central',
  totalInvoicesCompared: 1,
  discrepancies: [
    {
      discrepancyId: 'disc-1',
      sourceStage: 'geopos_local',
      targetStage: 'geopos_central',
      invoice: 'INV-001',
      type: 'total_difference',
      details: { expectedValue: '100', actualValue: '90', message: 'Total difiere' },
      severity: 'medium',
      detectedAt: new Date().toISOString(),
    },
  ],
  summary: { missingInvoices: 0, totalDifferences: 1, itemCountDifferences: 0, missingItems: 0 },
};

const sampleFinding: Finding = {
  findingId: 'find-1',
  discrepancyId: 'disc-1',
  explanation: 'Diferencia de total detectada',
  probableCause: 'Error de sincronización',
  recommendation: 'Verificar datos origen',
  severity: 'medium',
  itemFindings: [],
  createdAt: new Date().toISOString(),
};

const sampleCorrection: Correction = {
  correctionId: 'corr-1',
  discrepancyId: 'disc-1',
  findingId: 'find-1',
  invoice: 'INV-001',
  originStage: 'geopos_local',
  correctedValues: { total: 100 },
  status: 'approved',
  proposedBy: 'operator@test.com',
  proposedAt: new Date().toISOString(),
  approvedBy: 'admin@test.com',
  reviewedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('ReconciliationPipelineService', () => {
  let pipeline: ReconciliationPipelineService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    pipeline = new ReconciliationPipelineService(
      mockTransformationService,
      mockQualityRulesService,
      mockComparisonService,
      mockAIAnalysisService,
      mockRemediationService,
      mockNotificationService,
    );
  });

  describe('processUpload', () => {
    it('ejecuta transformación, calidad, comparación y análisis IA en orden', async () => {
      mockTransformUpload.mockResolvedValue(sampleTransformed);
      mockExecuteRules.mockResolvedValue(sampleQualityPassed);
      mockCompareStages.mockReturnValue(sampleComparison);
      mockSaveDiscrepancies.mockResolvedValue(undefined);
      mockAnalyzeDiscrepancy.mockResolvedValue(sampleFinding);
      mockSaveFinding.mockResolvedValue(undefined);

      const previousData: TransformedData = {
        stage: 'geopos_local',
        uploadId: 'prev-1',
        invoices: [],
        processedAt: new Date().toISOString(),
      };

      const result = await pipeline.processUpload(
        'upload-1',
        'geopos_local',
        [] as any,
        previousData,
      );

      // Verificar orden de llamadas
      expect(mockTransformUpload).toHaveBeenCalledBefore(mockExecuteRules);
      expect(mockExecuteRules).toHaveBeenCalledBefore(mockCompareStages);
      expect(mockCompareStages).toHaveBeenCalledBefore(mockAnalyzeDiscrepancy);

      expect(result.transformed).toEqual(sampleTransformed);
      expect(result.quality).toEqual(sampleQualityPassed);
      expect(result.comparison).toEqual(sampleComparison);
      expect(result.findings).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });

    it('detiene el flujo si la transformación falla', async () => {
      mockTransformUpload.mockRejectedValue(new Error('Etapa no soportada'));

      const result = await pipeline.processUpload('upload-1', 'geopos_local', [] as any);

      expect(result.transformed).toBeNull();
      expect(result.quality).toBeNull();
      expect(result.comparison).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('transformación');
      expect(mockExecuteRules).not.toHaveBeenCalled();
    });

    it('no compara si la calidad falla y envía notificaciones', async () => {
      mockTransformUpload.mockResolvedValue(sampleTransformed);
      mockExecuteRules.mockResolvedValue(sampleQualityFailed);
      mockSendQualityAlert.mockResolvedValue({ success: true, messageId: 'msg-1', sentAt: '' });

      const previousData: TransformedData = {
        stage: 'geopos_local',
        uploadId: 'prev-1',
        invoices: [],
        processedAt: new Date().toISOString(),
      };

      const result = await pipeline.processUpload(
        'upload-1',
        'geopos_local',
        [] as any,
        previousData,
      );

      expect(result.quality?.failed).toBe(1);
      expect(result.comparison).toBeNull();
      expect(mockCompareStages).not.toHaveBeenCalled();
      expect(mockSendQualityAlert).toHaveBeenCalledWith(
        'r2',
        'upload-1',
        expect.stringContaining('Formato'),
      );
    });

    it('no compara si no hay datos de etapa anterior', async () => {
      mockTransformUpload.mockResolvedValue(sampleTransformed);
      mockExecuteRules.mockResolvedValue(sampleQualityPassed);

      const result = await pipeline.processUpload('upload-1', 'geopos_local', [] as any);

      expect(result.comparison).toBeNull();
      expect(mockCompareStages).not.toHaveBeenCalled();
    });

    it('continúa si el análisis IA falla para una discrepancia', async () => {
      mockTransformUpload.mockResolvedValue(sampleTransformed);
      mockExecuteRules.mockResolvedValue(sampleQualityPassed);

      const comparisonWith2 = {
        ...sampleComparison,
        discrepancies: [
          sampleComparison.discrepancies[0],
          { ...sampleComparison.discrepancies[0], discrepancyId: 'disc-2' },
        ],
      };
      mockCompareStages.mockReturnValue(comparisonWith2);
      mockSaveDiscrepancies.mockResolvedValue(undefined);
      mockAnalyzeDiscrepancy
        .mockRejectedValueOnce(new Error('Bedrock timeout'))
        .mockResolvedValueOnce(sampleFinding);
      mockSaveFinding.mockResolvedValue(undefined);

      const previousData: TransformedData = {
        stage: 'geopos_local',
        uploadId: 'prev-1',
        invoices: [],
        processedAt: new Date().toISOString(),
      };

      const result = await pipeline.processUpload(
        'upload-1',
        'geopos_local',
        [] as any,
        previousData,
      );

      expect(result.findings).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('análisis IA');
    });

    it('persiste discrepancias cuando se detectan', async () => {
      mockTransformUpload.mockResolvedValue(sampleTransformed);
      mockExecuteRules.mockResolvedValue(sampleQualityPassed);
      mockCompareStages.mockReturnValue(sampleComparison);
      mockSaveDiscrepancies.mockResolvedValue(undefined);
      mockAnalyzeDiscrepancy.mockResolvedValue(sampleFinding);
      mockSaveFinding.mockResolvedValue(undefined);

      const previousData: TransformedData = {
        stage: 'geopos_local',
        uploadId: 'prev-1',
        invoices: [],
        processedAt: new Date().toISOString(),
      };

      await pipeline.processUpload('upload-1', 'geopos_local', [] as any, previousData);

      expect(mockSaveDiscrepancies).toHaveBeenCalledWith(sampleComparison.discrepancies);
    });
  });

  describe('processCorrection', () => {
    it('aprueba corrección y envía notificación', async () => {
      mockApproveCorrection.mockResolvedValue(sampleCorrection);
      mockSendCorrectionApproved.mockResolvedValue({ success: true, messageId: 'msg-1', sentAt: '' });

      const result = await pipeline.processCorrection(
        'corr-1',
        'approve',
        'admin@test.com',
        undefined,
        'operator@test.com',
      );

      expect(result.correction).toEqual(sampleCorrection);
      expect(result.notified).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockApproveCorrection).toHaveBeenCalledWith('corr-1', 'admin@test.com');
      expect(mockSendCorrectionApproved).toHaveBeenCalledWith('corr-1', 'operator@test.com');
    });

    it('rechaza corrección con motivo y envía notificación', async () => {
      const rejectedCorrection = { ...sampleCorrection, status: 'rejected' as const, rejectionReason: 'Datos incorrectos' };
      mockRejectCorrection.mockResolvedValue(rejectedCorrection);
      mockSendCorrectionRejected.mockResolvedValue({ success: true, messageId: 'msg-2', sentAt: '' });

      const result = await pipeline.processCorrection(
        'corr-1',
        'reject',
        'admin@test.com',
        'Datos incorrectos',
        'operator@test.com',
      );

      expect(result.correction).toEqual(rejectedCorrection);
      expect(result.notified).toBe(true);
      expect(mockRejectCorrection).toHaveBeenCalledWith('corr-1', 'admin@test.com', 'Datos incorrectos');
      expect(mockSendCorrectionRejected).toHaveBeenCalledWith('corr-1', 'operator@test.com', 'Datos incorrectos');
    });

    it('retorna error si se rechaza sin motivo', async () => {
      const result = await pipeline.processCorrection(
        'corr-1',
        'reject',
        'admin@test.com',
      );

      expect(result.error).toContain('motivo de rechazo');
      expect(result.correction).toBeNull();
      expect(mockRejectCorrection).not.toHaveBeenCalled();
    });

    it('maneja error del servicio de remediación', async () => {
      mockApproveCorrection.mockRejectedValue(new Error('Corrección no encontrada'));

      const result = await pipeline.processCorrection(
        'corr-999',
        'approve',
        'admin@test.com',
        undefined,
        'op@test.com',
      );

      expect(result.error).toContain('Corrección no encontrada');
      expect(result.correction).toBeNull();
      expect(result.notified).toBe(false);
    });

    it('no envía notificación si no se proporciona email', async () => {
      mockApproveCorrection.mockResolvedValue(sampleCorrection);

      const result = await pipeline.processCorrection(
        'corr-1',
        'approve',
        'admin@test.com',
      );

      expect(result.correction).toEqual(sampleCorrection);
      expect(result.notified).toBe(false);
      expect(mockSendCorrectionApproved).not.toHaveBeenCalled();
    });
  });

  describe('singleton', () => {
    it('getInstance retorna la misma instancia', () => {
      const a = ReconciliationPipelineService.getInstance();
      const b = ReconciliationPipelineService.getInstance();
      expect(a).toBe(b);
    });
  });
});

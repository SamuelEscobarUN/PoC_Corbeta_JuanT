/**
 * ReconciliationPipelineService — orquesta el flujo completo de
 * reconciliación de datos end-to-end.
 *
 * Flujo de processUpload:
 *  1. Transformar datos crudos vía TransformationService
 *  2. Ejecutar reglas de calidad vía QualityRulesService
 *  3. Si la calidad pasa, comparar con etapa anterior vía ComparisonService
 *  4. Para cada discrepancia, analizar vía AIAnalysisService
 *  5. Enviar notificaciones para fallos de calidad
 *
 * Flujo de processCorrection:
 *  1. Aprobar o rechazar vía RemediationService
 *  2. Si se aprueba, la generación de XML ya está integrada en RemediationService
 *  3. Enviar notificación al operador
 *
 * Requisitos: 2.3, 12.1, 12.2, 12.3, 12.4, 12.5
 */

import type { CascadeStage } from '../types/csv';
import type { TransformedData } from './transform/types';
import type { QualityExecutionSummary } from '../types/quality';
import type { ComparisonResult } from '../types/comparison';
import type { Finding } from '../types/ai-analysis';
import type { Correction } from '../types/remediation';

import { TransformationService, type RawRecords } from './transform/index';
import { QualityRulesService } from './quality-rules';
import { ComparisonService } from './comparison';
import { AIAnalysisService } from './ai-analysis';
import { RemediationService } from './remediation';
import { NotificationService } from './notification';

/** Resultado del procesamiento de un upload completo. */
export interface PipelineUploadResult {
  uploadId: string;
  stage: CascadeStage;
  transformed: TransformedData | null;
  quality: QualityExecutionSummary | null;
  comparison: ComparisonResult | null;
  findings: Finding[];
  errors: string[];
}

/** Resultado del procesamiento de una corrección. */
export interface PipelineCorrectionResult {
  correctionId: string;
  action: 'approve' | 'reject';
  correction: Correction | null;
  notified: boolean;
  error?: string;
}

export class ReconciliationPipelineService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: ReconciliationPipelineService;

  private transformationService: TransformationService;
  private qualityRulesService: QualityRulesService;
  private comparisonService: ComparisonService;
  private aiAnalysisService: AIAnalysisService;
  private remediationService: RemediationService;
  private notificationService: NotificationService;

  constructor(
    transformationService?: TransformationService,
    qualityRulesService?: QualityRulesService,
    comparisonService?: ComparisonService,
    aiAnalysisService?: AIAnalysisService,
    remediationService?: RemediationService,
    notificationService?: NotificationService,
  ) {
    this.transformationService = transformationService ?? TransformationService.getInstance();
    this.qualityRulesService = qualityRulesService ?? QualityRulesService.getInstance();
    this.comparisonService = comparisonService ?? ComparisonService.getInstance();
    this.aiAnalysisService = aiAnalysisService ?? AIAnalysisService.getInstance();
    this.remediationService = remediationService ?? RemediationService.getInstance();
    this.notificationService = notificationService ?? NotificationService.getInstance();
  }

  static getInstance(): ReconciliationPipelineService {
    if (!ReconciliationPipelineService.instance) {
      ReconciliationPipelineService.instance = new ReconciliationPipelineService();
    }
    return ReconciliationPipelineService.instance;
  }

  /* ------------------------------------------------------------------ */
  /*  Procesamiento de upload (flujo completo)                          */
  /* ------------------------------------------------------------------ */

  /**
   * Orquestar el flujo completo de procesamiento de un upload:
   * carga → transformación → calidad → comparación → IA
   *
   * @param uploadId - ID del upload a procesar
   * @param stage - Etapa de la cascada
   * @param rawData - Datos crudos parseados del CSV
   * @param previousStageData - Datos transformados de la etapa anterior (para comparación)
   */
  async processUpload(
    uploadId: string,
    stage: CascadeStage,
    rawData: RawRecords,
    previousStageData?: TransformedData,
  ): Promise<PipelineUploadResult> {
    const result: PipelineUploadResult = {
      uploadId,
      stage,
      transformed: null,
      quality: null,
      comparison: null,
      findings: [],
      errors: [],
    };

    // Paso 1: Transformar datos
    try {
      result.transformed = await this.transformationService.transformUpload(
        uploadId,
        stage,
        rawData,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Error en transformación: ${msg}`);
      console.error(`[Pipeline] Error en transformación para upload ${uploadId}:`, error);
      return result;
    }

    // Paso 2: Ejecutar reglas de calidad
    try {
      const dataForQuality = this.transformedToRecords(result.transformed);
      result.quality = await this.qualityRulesService.executeRules(
        uploadId,
        stage,
        dataForQuality,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Error en validación de calidad: ${msg}`);
      console.error(`[Pipeline] Error en calidad para upload ${uploadId}:`, error);
    }

    // Paso 2.5: Notificar fallos de calidad
    if (result.quality && result.quality.failed > 0) {
      try {
        for (const failedResult of result.quality.results.filter(r => r.result === 'failed')) {
          await this.notificationService.sendQualityAlert(
            failedResult.ruleId,
            uploadId,
            `Regla "${failedResult.ruleName}" falló: ${failedResult.details.message}`,
          );
        }
      } catch (error) {
        console.error(`[Pipeline] Error al enviar notificaciones de calidad:`, error);
      }
    }

    // Paso 3: Comparar con etapa anterior (si hay datos previos y calidad pasó)
    const qualityPassed = !result.quality || result.quality.failed === 0;
    if (qualityPassed && previousStageData && result.transformed) {
      try {
        result.comparison = this.comparisonService.compareStages(
          previousStageData,
          result.transformed,
        );

        // Persistir discrepancias
        if (result.comparison.discrepancies.length > 0) {
          await this.comparisonService.saveDiscrepancies(result.comparison.discrepancies);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Error en comparación: ${msg}`);
        console.error(`[Pipeline] Error en comparación para upload ${uploadId}:`, error);
      }
    }

    // Paso 4: Analizar discrepancias con IA
    if (result.comparison && result.comparison.discrepancies.length > 0) {
      for (const discrepancy of result.comparison.discrepancies) {
        try {
          const finding = await this.aiAnalysisService.analyzeDiscrepancy(discrepancy);
          await this.aiAnalysisService.saveFinding(finding);
          result.findings.push(finding);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          result.errors.push(`Error en análisis IA para discrepancia ${discrepancy.discrepancyId}: ${msg}`);
          console.error(`[Pipeline] Error en análisis IA:`, error);
        }
      }
    }

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Procesamiento de corrección                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Manejar el flujo de aprobación o rechazo de una corrección.
   *
   * @param correctionId - ID de la corrección
   * @param action - Acción a realizar: 'approve' o 'reject'
   * @param adminId - ID del administrador que ejecuta la acción
   * @param reason - Motivo de rechazo (requerido si action es 'reject')
   * @param operatorEmail - Email del operador para notificación
   */
  async processCorrection(
    correctionId: string,
    action: 'approve' | 'reject',
    adminId: string,
    reason?: string,
    operatorEmail?: string,
  ): Promise<PipelineCorrectionResult> {
    const result: PipelineCorrectionResult = {
      correctionId,
      action,
      correction: null,
      notified: false,
    };

    try {
      if (action === 'approve') {
        result.correction = await this.remediationService.approveCorrection(
          correctionId,
          adminId,
        );
      } else {
        if (!reason) {
          result.error = 'El motivo de rechazo es obligatorio';
          return result;
        }
        result.correction = await this.remediationService.rejectCorrection(
          correctionId,
          adminId,
          reason,
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.error = msg;
      console.error(`[Pipeline] Error al procesar corrección ${correctionId}:`, error);
      return result;
    }

    // Enviar notificación al operador
    if (operatorEmail && result.correction) {
      try {
        if (action === 'approve') {
          await this.notificationService.sendCorrectionApproved(correctionId, operatorEmail);
        } else {
          await this.notificationService.sendCorrectionRejected(
            correctionId,
            operatorEmail,
            reason ?? '',
          );
        }
        result.notified = true;
      } catch (error) {
        console.error(`[Pipeline] Error al enviar notificación:`, error);
      }
    }

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers internos                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Convertir datos transformados a registros clave-valor para reglas de calidad.
   */
  private transformedToRecords(data: TransformedData): Record<string, string>[] {
    const records: Record<string, string>[] = [];
    for (const inv of data.invoices) {
      for (const item of inv.items) {
        records.push({
          invoice: inv.invoice,
          totalFactura: String(inv.totalFactura),
          itemId: item.itemId,
          description: item.description ?? '',
          value: String(item.value),
        });
      }
    }
    return records;
  }
}

/** Instancia singleton por defecto. */
export const reconciliationPipelineService = ReconciliationPipelineService.getInstance();

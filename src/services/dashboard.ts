/**
 * DashboardService — servicio que consolida métricas de reconciliación,
 * discrepancias, calidad y remediación para el dashboard.
 *
 * Métodos:
 *  - getReconciliationSummary: total facturas, con discrepancias, tasa, conteo por tipo
 *  - getDiscrepanciesByStage: discrepancias agrupadas por par de etapas
 *  - getQualityResults: reglas ejecutadas, pasadas, fallidas por dataset
 *  - getRemediationStatus: propuestas, pendientes, aprobadas, rechazadas, XML generados
 *  - getDashboardData: consolida todos los datos del dashboard
 *
 * Usa Amplify Data (generateClient) para consultas DynamoDB.
 * Requisitos: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import { generateClient } from 'aws-amplify/data';
import { remove } from 'aws-amplify/storage';

import type { Schema } from '../../amplify/data/resource';
import type { CascadeStage } from '../types/csv';
import type {
  Discrepancy,
  DiscrepancyType,
  DiscrepancyDetails,
  DiscrepancySeverity,
} from '../types/comparison';
import type {
  ReconciliationSummary,
  StageDiscrepancies,
  QualityResultsSummary,
  DatasetQualitySummary,
  RemediationStatus,
  DashboardData,
  PlatformSummary,
} from '../types/dashboard';
import { ComparisonPairs } from '../amplify-config';

/** Cliente Amplify Data tipado con nuestro esquema. */
const client = generateClient<Schema>();



export class DashboardService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: DashboardService;

  constructor() {
    // Constructor público para permitir instancias de testing
  }

  static getInstance(): DashboardService {
    if (!DashboardService.instance) {
      DashboardService.instance = new DashboardService();
    }
    return DashboardService.instance;
  }

  /* ------------------------------------------------------------------ */
  /*  Resumen de reconciliación                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Obtener resumen general de reconciliación.
   *
   * Consulta todas las discrepancias y calcula:
   * - Total de facturas únicas con discrepancias
   * - Tasa de discrepancia respecto al total de facturas procesadas
   * - Conteo por tipo de discrepancia
   */
  async getReconciliationSummary(
    totalInvoices: number,
  ): Promise<ReconciliationSummary> {
    const discrepancies = await this.fetchAllDiscrepancies();

    // Facturas únicas con discrepancias
    const invoicesWithDisc = new Set(discrepancies.map((d) => d.invoice));

    // Conteo por tipo
    const countByType = this.buildCountByType(discrepancies);

    // Tasa de discrepancia
    const discrepancyRate =
      totalInvoices > 0 ? invoicesWithDisc.size / totalInvoices : 0;

    return {
      totalInvoices,
      invoicesWithDiscrepancies: invoicesWithDisc.size,
      discrepancyRate,
      countByType,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Discrepancias agrupadas por par de etapas                         */
  /* ------------------------------------------------------------------ */

  /**
   * Obtener discrepancias agrupadas por par de etapas (source → target).
   *
   * Agrupa las discrepancias según los pares de comparación definidos
   * en ComparisonPairs y retorna conteo y lista por cada par.
   */
  async getDiscrepanciesByStage(): Promise<StageDiscrepancies[]> {
    const discrepancies = await this.fetchAllDiscrepancies();

    // Crear mapa de agrupación por clave "source|target"
    const groupMap = new Map<string, Discrepancy[]>();

    for (const disc of discrepancies) {
      const key = `${disc.sourceStage}|${disc.targetStage}`;
      const group = groupMap.get(key) ?? [];
      group.push(disc);
      groupMap.set(key, group);
    }

    // Construir resultado para cada par de comparación definido
    const result: StageDiscrepancies[] = ComparisonPairs.map((pair) => {
      const key = `${pair.source}|${pair.target}`;
      const pairDiscrepancies = groupMap.get(key) ?? [];
      return {
        stagePair: {
          source: pair.source as unknown as CascadeStage,
          target: pair.target as unknown as CascadeStage,
        },
        discrepancies: pairDiscrepancies,
        count: pairDiscrepancies.length,
      };
    });

    // Incluir pares no definidos en ComparisonPairs (si existen)
    const definedKeys = new Set(
      ComparisonPairs.map((p) => `${p.source}|${p.target}`),
    );
    for (const [key, discs] of groupMap) {
      if (!definedKeys.has(key)) {
        const [source, target] = key.split('|');
        result.push({
          stagePair: {
            source: source as CascadeStage,
            target: target as CascadeStage,
          },
          discrepancies: discs,
          count: discs.length,
        });
      }
    }

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Resultados de calidad                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Obtener resumen de resultados de calidad agrupados por dataset.
   *
   * Consulta la tabla QualityResults y agrupa por uploadId/stage.
   */
  async getQualityResults(): Promise<QualityResultsSummary> {
    const results = await this.fetchAllQualityResults();

    let totalPassed = 0;
    let totalFailed = 0;

    // Agrupar por uploadId
    const datasetMap = new Map<
      string,
      { stage: CascadeStage; passed: number; failed: number }
    >();

    for (const result of results) {
      const uploadId = result.uploadId as string;
      const isPassed = result.result === 'passed';

      if (isPassed) totalPassed++;
      else totalFailed++;

      const existing = datasetMap.get(uploadId);
      if (existing) {
        if (isPassed) existing.passed++;
        else existing.failed++;
      } else {
        datasetMap.set(uploadId, {
          stage: (result.stage as CascadeStage) ?? ('geopos_local' as CascadeStage),
          passed: isPassed ? 1 : 0,
          failed: isPassed ? 0 : 1,
        });
      }
    }

    // Construir desglose por dataset
    const byDataset: DatasetQualitySummary[] = [];
    for (const [uploadId, data] of datasetMap) {
      byDataset.push({
        uploadId,
        stage: data.stage,
        totalRules: data.passed + data.failed,
        passed: data.passed,
        failed: data.failed,
      });
    }

    return {
      totalRules: totalPassed + totalFailed,
      passed: totalPassed,
      failed: totalFailed,
      byDataset,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Estado de remediación                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Obtener estado de remediación.
   *
   * Consulta la tabla Corrections y cuenta por estado.
   * Cuenta XML generados verificando la presencia de xmlS3Key.
   */
  async getRemediationStatus(): Promise<RemediationStatus> {
    const corrections = await this.fetchAllCorrections();

    let pendingApproval = 0;
    let approved = 0;
    let rejected = 0;
    let xmlGenerated = 0;

    for (const corr of corrections) {
      const status = corr.status as string;
      switch (status) {
        case 'pending_approval':
          pendingApproval++;
          break;
        case 'approved':
          approved++;
          break;
        case 'rejected':
          rejected++;
          break;
      }

      // Contar XML generados (correcciones aprobadas con xmlS3Key)
      if (corr.xmlS3Key) {
        xmlGenerated++;
      }
    }

    return {
      proposed: corrections.length,
      pendingApproval,
      approved,
      rejected,
      xmlGenerated,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Dashboard consolidado                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Obtener todos los datos del dashboard en una sola llamada.
   */
  async getDashboardData(totalInvoices: number): Promise<DashboardData> {
    // Fetch all data once to avoid duplicate AppSync queries
    const [discrepancies, qualityResults, corrections, uploads, sessions] = await Promise.all([
      this.fetchAllDiscrepancies(),
      this.fetchAllQualityResults(),
      this.fetchAllCorrections(),
      this.fetchAllUploads(),
      this.fetchAllSessions(),
    ]);

    // Platform summary
    const uploadsByStage: Record<string, number> = {};
    for (const u of uploads) {
      const stage = u.stage as string;
      uploadsByStage[stage] = (uploadsByStage[stage] ?? 0) + 1;
    }
    let sessionsInProgress = 0;
    let sessionsCompleted = 0;
    for (const s of sessions) {
      if (s.status === 'in_progress') sessionsInProgress++;
      else if (s.status === 'completed') sessionsCompleted++;
    }
    const platform: PlatformSummary = {
      totalUploads: uploads.length,
      totalSessions: sessions.length,
      sessionsInProgress,
      sessionsCompleted,
      uploadsByStage,
    };

    // Use real upload count as totalInvoices if the default was passed
    const effectiveTotal = uploads.length > 0 ? uploads.length : totalInvoices;

    // Build reconciliation summary from pre-fetched discrepancies
    const invoicesWithDisc = new Set(discrepancies.map((d) => d.invoice));
    const countByType = this.buildCountByType(discrepancies);
    const discrepancyRate =
      effectiveTotal > 0 ? invoicesWithDisc.size / effectiveTotal : 0;

    const reconciliation: ReconciliationSummary = {
      totalInvoices: effectiveTotal,
      invoicesWithDiscrepancies: invoicesWithDisc.size,
      discrepancyRate,
      countByType,
    };

    // Build stage discrepancies from pre-fetched discrepancies
    const groupMap = new Map<string, Discrepancy[]>();
    for (const disc of discrepancies) {
      const key = `${disc.sourceStage}|${disc.targetStage}`;
      const group = groupMap.get(key) ?? [];
      group.push(disc);
      groupMap.set(key, group);
    }
    const stageDiscrepancies: StageDiscrepancies[] = ComparisonPairs.map((pair) => {
      const key = `${pair.source}|${pair.target}`;
      const pairDiscs = groupMap.get(key) ?? [];
      return {
        stagePair: { source: pair.source as unknown as CascadeStage, target: pair.target as unknown as CascadeStage },
        discrepancies: pairDiscs,
        count: pairDiscs.length,
      };
    });
    const definedKeys = new Set(ComparisonPairs.map((p) => `${p.source}|${p.target}`));
    for (const [key, discs] of groupMap) {
      if (!definedKeys.has(key)) {
        const [source, target] = key.split('|');
        stageDiscrepancies.push({
          stagePair: { source: source as CascadeStage, target: target as CascadeStage },
          discrepancies: discs,
          count: discs.length,
        });
      }
    }

    // Build quality summary from pre-fetched results
    const datasetMap = new Map<string, { passed: number; failed: number; rules: string[] }>();
    let qPassed = 0;
    let qFailed = 0;
    for (const qr of qualityResults) {
      const result = qr.result as string;
      const uploadId = qr.uploadId as string;
      const ruleName = (qr.ruleName as string) ?? '';
      if (result === 'passed') qPassed++;
      else if (result === 'failed') qFailed++;
      const ds = datasetMap.get(uploadId) ?? { passed: 0, failed: 0, rules: [] };
      if (result === 'passed') ds.passed++;
      else if (result === 'failed') ds.failed++;
      ds.rules.push(ruleName);
      datasetMap.set(uploadId, ds);
    }
    const byDataset: DatasetQualitySummary[] = Array.from(datasetMap.entries()).map(
      ([uploadId, summary]) => ({
        uploadId,
        stage: '' as CascadeStage,
        totalRules: summary.rules.length,
        passed: summary.passed,
        failed: summary.failed,
      }),
    );
    const quality: QualityResultsSummary = {
      totalRules: qualityResults.length,
      passed: qPassed,
      failed: qFailed,
      byDataset,
    };

    // Build remediation status from pre-fetched corrections
    let pendingApproval = 0;
    let approved = 0;
    let rejected = 0;
    let xmlGenerated = 0;
    for (const corr of corrections) {
      const status = corr.status as string;
      if (status === 'pending_approval') pendingApproval++;
      else if (status === 'approved') approved++;
      else if (status === 'rejected') rejected++;
      if (corr.xmlS3Key) xmlGenerated++;
    }
    const remediation: RemediationStatus = {
      proposed: corrections.length,
      pendingApproval,
      approved,
      rejected,
      xmlGenerated,
    };

    return { reconciliation, stageDiscrepancies, quality, remediation, platform };
  }

  /* ------------------------------------------------------------------ */
  /*  Limpieza de datos                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Eliminar todos los registros de todas las tablas.
   * Útil para limpiar datos de prueba.
   */
  async purgeAllData(): Promise<{ deleted: Record<string, number> }> {
    const deleted: Record<string, number> = {};

    // 1. Corrections (PK: correctionId) — eliminar XML de S3 si existe
    const corrections = await this.fetchAllCorrections();
    for (const c of corrections) {
      try {
        const xmlKey = c.xmlS3Key as string;
        if (xmlKey) {
          await remove({
            path: xmlKey,
            options: { bucket: 'reconciliationStorage' },
          });
        }
      } catch { /* best-effort */ }
      try {
        await client.models.Correction.delete({ correctionId: c.correctionId as string });
      } catch { /* best-effort */ }
    }
    deleted.corrections = corrections.length;

    // 2. Findings (PK: discrepancyId, SK: findingId)
    try {
      const { data: findings } = await client.models.Finding.list({ limit: 1000 });
      for (const f of (findings ?? [])) {
        try {
          await client.models.Finding.delete({
            discrepancyId: f.discrepancyId,
            findingId: f.findingId,
          });
        } catch { /* best-effort */ }
      }
      deleted.findings = (findings ?? []).length;
    } catch {
      deleted.findings = 0;
    }

    // 3. Discrepancies (PK: sessionId, SK: discrepancyId)
    try {
      const { data: discrepancies } = await client.models.Discrepancy.list({ limit: 1000 });
      for (const d of (discrepancies ?? [])) {
        try {
          await client.models.Discrepancy.delete({
            sessionId: d.sessionId,
            discrepancyId: d.discrepancyId,
          });
        } catch { /* best-effort */ }
      }
      deleted.discrepancies = (discrepancies ?? []).length;
    } catch {
      deleted.discrepancies = 0;
    }

    // 4. QualityResults (PK: uploadId, SK: ruleId)
    try {
      const { data: qr } = await client.models.QualityResult.list({ limit: 1000 });
      for (const q of (qr ?? [])) {
        try {
          await client.models.QualityResult.delete({
            uploadId: q.uploadId,
            ruleId: q.ruleId,
          });
        } catch { /* best-effort */ }
      }
      deleted.qualityResults = (qr ?? []).length;
    } catch {
      deleted.qualityResults = 0;
    }

    // 5. Uploads (PK: uploadId) — eliminar archivo de S3 + registro DynamoDB
    const uploads = await this.fetchAllUploads();
    for (const u of uploads) {
      try {
        const s3Key = u.s3Key as string;
        if (s3Key) {
          await remove({
            path: s3Key,
            options: { bucket: 'reconciliationStorage' },
          });
        }
      } catch { /* best-effort: archivo puede no existir */ }
      try {
        await client.models.Upload.delete({ uploadId: u.uploadId as string });
      } catch { /* best-effort */ }
    }
    deleted.uploads = uploads.length;

    // 6. Sessions (PK: sessionId)
    const sessions = await this.fetchAllSessions();
    for (const s of sessions) {
      try {
        await client.models.Session.delete({ sessionId: s.sessionId as string });
      } catch { /* best-effort */ }
    }
    deleted.sessions = sessions.length;

    return { deleted };
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers internos — consultas DynamoDB                             */
  /* ------------------------------------------------------------------ */

  /**
   * Obtener todas las discrepancias de DynamoDB.
   */
  private async fetchAllDiscrepancies(): Promise<Discrepancy[]> {
    try {
      const { data } = await client.models.Discrepancy.list({ limit: 1000 });

      return (data ?? []).map((item) => {
        const details: DiscrepancyDetails = item.details
          ? (item.details as unknown as DiscrepancyDetails)
          : { message: '' };

        return {
          discrepancyId: item.discrepancyId as string,
          sourceStage: item.sourceStage as CascadeStage,
          targetStage: item.targetStage as CascadeStage,
          invoice: item.invoice as string,
          type: item.type as DiscrepancyType,
          details,
          severity: this.inferSeverity(item.type as DiscrepancyType),
          detectedAt: item.detectedAt as string,
        };
      });
    } catch (error) {
      console.error('Error al consultar discrepancias:', error);
      return [];
    }
  }

  /**
   * Obtener todos los resultados de calidad de DynamoDB.
   */
  private async fetchAllQualityResults(): Promise<Record<string, unknown>[]> {
    try {
      const { data } = await client.models.QualityResult.list({ limit: 1000 });
      return (data ?? []) as unknown as Record<string, unknown>[];
    } catch (error) {
      console.error('Error al consultar resultados de calidad:', error);
      return [];
    }
  }

  /**
   * Obtener todas las correcciones de DynamoDB.
   */
  private async fetchAllCorrections(): Promise<Record<string, unknown>[]> {
    try {
      const { data } = await client.models.Correction.list({ limit: 1000 });
      return (data ?? []) as unknown as Record<string, unknown>[];
    } catch (error) {
      console.error('Error al consultar correcciones:', error);
      return [];
    }
  }

  /**
   * Obtener todos los uploads de DynamoDB.
   */
  private async fetchAllUploads(): Promise<Record<string, unknown>[]> {
    try {
      const { data } = await client.models.Upload.list({ limit: 1000 });
      return (data ?? []) as unknown as Record<string, unknown>[];
    } catch (error) {
      console.error('Error al consultar uploads:', error);
      return [];
    }
  }

  /**
   * Obtener todas las sesiones de DynamoDB.
   */
  private async fetchAllSessions(): Promise<Record<string, unknown>[]> {
    try {
      const { data } = await client.models.Session.list({ limit: 1000 });
      return (data ?? []) as unknown as Record<string, unknown>[];
    } catch (error) {
      console.error('Error al consultar sesiones:', error);
      return [];
    }
  }

  /**
   * Construir conteo por tipo de discrepancia.
   */
  private buildCountByType(
    discrepancies: Discrepancy[],
  ): Record<DiscrepancyType, number> {
    const countByType: Record<DiscrepancyType, number> = {
      missing_invoice: 0,
      total_difference: 0,
      item_count_difference: 0,
      missing_item: 0,
    };

    for (const disc of discrepancies) {
      if (disc.type in countByType) {
        countByType[disc.type]++;
      }
    }

    return countByType;
  }

  /**
   * Inferir severidad a partir del tipo de discrepancia.
   */
  private inferSeverity(type: DiscrepancyType): DiscrepancySeverity {
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
export const dashboardService = DashboardService.getInstance();

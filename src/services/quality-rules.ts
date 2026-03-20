/**
 * QualityRulesService — gestiona reglas de calidad de datos y ejecuta
 * validaciones delegando al backend (Lambda + Glue Data Quality).
 *
 * CRUD opera contra DynamoDB vía Amplify Data (client.models.QualityRule).
 * La ejecución de reglas se delega a la custom query AppSync
 * `executeQualityRules` que invoca la Lambda quality-evaluator.
 *
 * Usa Amplify Data (generateClient) para operaciones DynamoDB.
 */

import { generateClient } from 'aws-amplify/data';

import type { Schema } from '../../amplify/data/resource';
import type { CascadeStage } from '../types/csv';
import type {
  QualityRule,
  QualityRuleType,
  CreateQualityRuleInput,
  UpdateQualityRuleInput,
  QualityExecutionSummary,
  ResultFilters,
} from '../types/quality';
import { validateDqdlExpression, generateBaseExpression } from './dqdl-translator';

/** Cliente Amplify Data tipado con nuestro esquema. */
const client = generateClient<Schema>();

export class QualityRulesService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: QualityRulesService;

  private constructor() {}

  static getInstance(): QualityRulesService {
    if (!QualityRulesService.instance) {
      QualityRulesService.instance = new QualityRulesService();
    }
    return QualityRulesService.instance;
  }

  /** Crear instancia independiente para tests (sin singleton). */
  static createForTesting(): QualityRulesService {
    return new QualityRulesService();
  }

  /* ------------------------------------------------------------------ */
  /*  CRUD de reglas de calidad (DynamoDB)                              */
  /* ------------------------------------------------------------------ */

  /**
   * Crear una nueva regla de calidad y persistirla en DynamoDB.
   */
  async createRule(input: CreateQualityRuleInput): Promise<QualityRule> {
    const ruleId = crypto.randomUUID();
    const now = new Date().toISOString();

    const record = {
      ruleId,
      ruleName: input.ruleName,
      stage: input.stage,
      type: input.type,
      expression: input.expression,
      targetColumn: input.targetColumn,
      threshold: input.threshold ?? 1.0,
      enabled: input.enabled ?? true,
      createdAt: now,
    };

    await client.models.QualityRule.create(record);

    return {
      ruleId,
      ruleName: input.ruleName,
      stage: input.stage,
      type: input.type as QualityRuleType,
      expression: input.expression,
      targetColumn: input.targetColumn,
      threshold: input.threshold ?? 1.0,
      enabled: input.enabled ?? true,
      createdAt: now,
    };
  }

  /**
   * Actualizar una regla existente en DynamoDB.
   * Retorna la regla actualizada o null si no existe.
   */
  async updateRule(ruleId: string, input: UpdateQualityRuleInput): Promise<QualityRule | null> {
    const existing = await this.getRule(ruleId);
    if (!existing) return null;

    const updateData: Record<string, unknown> = { ruleId };
    if (input.ruleName !== undefined) updateData.ruleName = input.ruleName;
    if (input.expression !== undefined) updateData.expression = input.expression;
    if (input.targetColumn !== undefined) updateData.targetColumn = input.targetColumn;
    if (input.threshold !== undefined) updateData.threshold = input.threshold;
    if (input.enabled !== undefined) updateData.enabled = input.enabled;

    await client.models.QualityRule.update(
      updateData as Parameters<typeof client.models.QualityRule.update>[0],
    );

    return {
      ...existing,
      ...(input.ruleName !== undefined && { ruleName: input.ruleName }),
      ...(input.expression !== undefined && { expression: input.expression }),
      ...(input.targetColumn !== undefined && { targetColumn: input.targetColumn }),
      ...(input.threshold !== undefined && { threshold: input.threshold }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
    };
  }

  /**
   * Eliminar una regla por su ID de DynamoDB.
   * Retorna true si se eliminó, false si no existía.
   */
  async deleteRule(ruleId: string): Promise<boolean> {
    try {
      const existing = await this.getRule(ruleId);
      if (!existing) return false;

      await client.models.QualityRule.delete({ ruleId });
      return true;
    } catch (error) {
      console.error(`Error al eliminar regla ${ruleId}:`, error);
      return false;
    }
  }

  /**
   * Listar reglas de calidad desde DynamoDB, opcionalmente filtradas por etapa.
   * Si se especifica etapa, usa el GSI stage-index.
   */
  async listRules(stage?: CascadeStage): Promise<QualityRule[]> {
    try {
      if (stage) {
        const response = await client.models.QualityRule.listQualityRuleByStageAndCreatedAt(
          { stage },
          { sortDirection: 'ASC' },
        );
        return (response.data ?? []).map((item) =>
          this.mapDynamoToRule(item as unknown as Record<string, unknown>),
        );
      }

      const response = await client.models.QualityRule.list();
      return (response.data ?? []).map((item) =>
        this.mapDynamoToRule(item as unknown as Record<string, unknown>),
      );
    } catch (error) {
      console.error('Error al listar reglas:', error);
      return [];
    }
  }

  /**
   * Obtener una regla por su ID desde DynamoDB.
   */
  async getRule(ruleId: string): Promise<QualityRule | null> {
    try {
      const { data } = await client.models.QualityRule.get({ ruleId });
      if (!data) return null;
      return this.mapDynamoToRule(data as unknown as Record<string, unknown>);
    } catch (error) {
      console.error(`Error al obtener regla ${ruleId}:`, error);
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Ejecución de reglas (delegada al backend)                        */
  /* ------------------------------------------------------------------ */

  /**
   * Ejecutar reglas de calidad para un upload invocando la Lambda
   * quality-evaluator a través de la custom query AppSync.
   *
   * @param uploadId - ID del upload asociado.
   * @param stage    - Etapa de la cascada.
   */
  async executeRules(
    uploadId: string,
    stage: CascadeStage,
  ): Promise<QualityExecutionSummary> {
    const { data, errors } = await client.queries.executeQualityRules({
      uploadId,
      stage,
    });

    if (errors && errors.length > 0) {
      throw new Error(errors.map((e) => e.message).join('; '));
    }

    if (!data) {
      throw new Error('No se recibió respuesta de la ejecución de reglas');
    }

    const parsed: QualityExecutionSummary = JSON.parse(data);
    return parsed;
  }

  /* ------------------------------------------------------------------ */
  /*  Validación DQDL                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Validar una expresión DQDL usando el traductor local.
   * Para tipos con expresión base (completeness, uniqueness, range, format),
   * genera la expresión base si se proporciona una columna.
   */
  validateExpression(
    expression: string,
    type: QualityRuleType,
  ): { valid: boolean; error?: string } {
    if (type === 'custom') {
      return validateDqdlExpression(expression);
    }

    // Para tipos estándar, validar la expresión DQDL directamente
    return validateDqdlExpression(expression);
  }

  /**
   * Generar una expresión DQDL base para un tipo de regla y columna.
   */
  generateBaseExpression(type: QualityRuleType, column: string): string {
    return generateBaseExpression(type, column);
  }

  /* ------------------------------------------------------------------ */
  /*  Consulta de resultados históricos                                */
  /* ------------------------------------------------------------------ */

  /**
   * Consultar resultados de ejecución históricos desde DynamoDB.
   * Soporta filtros por etapa y rango de fechas.
   * Retorna resultados ordenados por fecha descendente.
   */
  async getExecutionResults(
    filters?: ResultFilters,
  ): Promise<QualityExecutionSummary[]> {
    try {
      const response = await client.models.QualityResult.list();
      const rawResults = (response.data ?? []) as unknown as Array<Record<string, unknown>>;

      // Agrupar resultados por uploadId para construir summaries
      const grouped = new Map<string, Array<Record<string, unknown>>>();
      for (const result of rawResults) {
        const uploadId = result.uploadId as string;
        if (!grouped.has(uploadId)) {
          grouped.set(uploadId, []);
        }
        grouped.get(uploadId)!.push(result);
      }

      let summaries: QualityExecutionSummary[] = [];

      for (const [uploadId, results] of grouped) {
        const resultRecords = results.map((r) => {
          const details = typeof r.details === 'string'
            ? JSON.parse(r.details)
            : r.details ?? {};

          return {
            uploadId: r.uploadId as string,
            ruleId: r.ruleId as string,
            ruleName: (r.ruleName as string) ?? '',
            ruleExpression: (r.ruleExpression as string) ?? '',
            result: (r.result as 'passed' | 'failed') ?? 'failed',
            details: {
              recordsEvaluated: details.recordsEvaluated ?? 0,
              recordsPassed: details.recordsPassed ?? 0,
              recordsFailed: details.recordsFailed ?? 0,
              compliancePercent: details.compliancePercent ?? 0,
              message: details.message ?? '',
            },
            executedAt: (r.executedAt as string) ?? '',
          };
        });

        const passed = resultRecords.filter((r) => r.result === 'passed').length;
        const failed = resultRecords.filter((r) => r.result === 'failed').length;

        // Determine stage from the upload context or first result
        const executedAt = resultRecords.length > 0
          ? resultRecords.reduce((latest, r) =>
              r.executedAt > latest ? r.executedAt : latest, resultRecords[0].executedAt)
          : '';

        summaries.push({
          uploadId,
          stage: '' as CascadeStage, // Will be enriched if stage filter is applied
          totalRules: resultRecords.length,
          passed,
          failed,
          results: resultRecords,
          alerts: [],
          executedAt,
        });
      }

      // Apply filters
      if (filters?.stage) {
        summaries = summaries.filter((s) =>
          s.stage === filters.stage ||
          s.results.some((r) => r.ruleExpression.includes(filters.stage!)),
        );
      }

      if (filters?.dateFrom) {
        summaries = summaries.filter((s) => s.executedAt >= filters.dateFrom!);
      }

      if (filters?.dateTo) {
        summaries = summaries.filter((s) => s.executedAt <= filters.dateTo!);
      }

      // Sort by executedAt descending (most recent first)
      summaries.sort((a, b) => b.executedAt.localeCompare(a.executedAt));

      return summaries;
    } catch (error) {
      console.error('Error al consultar resultados históricos:', error);
      return [];
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers internos                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Mapear registro de DynamoDB a interfaz QualityRule.
   */
  private mapDynamoToRule(item: Record<string, unknown>): QualityRule {
    return {
      ruleId: item.ruleId as string,
      ruleName: item.ruleName as string,
      stage: item.stage as CascadeStage,
      type: item.type as QualityRuleType,
      expression: item.expression as string,
      targetColumn: item.targetColumn as string | undefined,
      threshold: (item.threshold as number) ?? 1.0,
      enabled: (item.enabled as boolean) ?? true,
      createdAt: item.createdAt as string,
      updatedBy: item.updatedBy as string | undefined,
    };
  }
}

/** Instancia singleton por defecto. */
export const qualityRulesService = QualityRulesService.getInstance();

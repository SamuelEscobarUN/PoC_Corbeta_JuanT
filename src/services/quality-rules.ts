/**
 * QualityRulesService — gestiona reglas de calidad de datos y ejecuta
 * validaciones sobre los datos cargados por etapa de la cascada.
 *
 * Integra con AWS Glue Data Quality (placeholder) para ejecutar reglas
 * configuradas, registra resultados en la tabla QualityResults de DynamoDB
 * y genera alertas vía SNS cuando una regla falla.
 *
 * Usa Amplify Data (generateClient) para operaciones DynamoDB.
 */

import { generateClient } from 'aws-amplify/data';

import type { Schema } from '../../amplify/data/resource';
import type { CascadeStage } from '../types/csv';
import type {
  QualityRule,
  CreateQualityRuleInput,
  UpdateQualityRuleInput,
  QualityResultRecord,
  QualityResultDetails,
  QualityExecutionSummary,
  QualityAlert,
  AlertSeverity,
} from '../types/quality';

/** Cliente Amplify Data tipado con nuestro esquema. */
const client = generateClient<Schema>();

export class QualityRulesService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: QualityRulesService;

  /**
   * Almacén en memoria de reglas de calidad.
   * En producción se persistirían en DynamoDB o Glue Data Catalog.
   */
  private rulesStore: Map<string, QualityRule> = new Map();

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
  /*  CRUD de reglas de calidad                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Crear una nueva regla de calidad para una etapa.
   */
  createRule(input: CreateQualityRuleInput): QualityRule {
    const ruleId = crypto.randomUUID();
    const rule: QualityRule = {
      ruleId,
      ruleName: input.ruleName,
      stage: input.stage,
      type: input.type,
      expression: input.expression,
      targetColumn: input.targetColumn,
      threshold: input.threshold ?? 1.0,
      enabled: input.enabled ?? true,
      createdAt: new Date().toISOString(),
    };
    this.rulesStore.set(ruleId, rule);
    return rule;
  }

  /**
   * Actualizar una regla existente.
   * Retorna la regla actualizada o null si no existe.
   */
  updateRule(ruleId: string, input: UpdateQualityRuleInput): QualityRule | null {
    const existing = this.rulesStore.get(ruleId);
    if (!existing) return null;

    const updated: QualityRule = {
      ...existing,
      ...(input.ruleName !== undefined && { ruleName: input.ruleName }),
      ...(input.expression !== undefined && { expression: input.expression }),
      ...(input.targetColumn !== undefined && { targetColumn: input.targetColumn }),
      ...(input.threshold !== undefined && { threshold: input.threshold }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
    };
    this.rulesStore.set(ruleId, updated);
    return updated;
  }

  /**
   * Eliminar una regla por su ID.
   * Retorna true si se eliminó, false si no existía.
   */
  deleteRule(ruleId: string): boolean {
    return this.rulesStore.delete(ruleId);
  }

  /**
   * Listar reglas de calidad filtradas por etapa.
   * Si no se especifica etapa, retorna todas las reglas.
   */
  listRules(stage?: CascadeStage): QualityRule[] {
    const all = Array.from(this.rulesStore.values());
    if (!stage) return all;
    return all.filter((r) => r.stage === stage);
  }

  /**
   * Obtener una regla por su ID.
   */
  getRule(ruleId: string): QualityRule | null {
    return this.rulesStore.get(ruleId) ?? null;
  }

  /* ------------------------------------------------------------------ */
  /*  Ejecución de reglas                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Ejecutar todas las reglas activas configuradas para la etapa dada
   * contra los datos proporcionados.
   *
   * - Evalúa cada regla contra los datos usando el motor de evaluación.
   * - Registra cada resultado (passed/failed) en DynamoDB QualityResults.
   * - Genera alertas para las reglas que fallan.
   * - Retorna un resumen con conteos de passed/failed.
   *
   * @param uploadId - ID del upload asociado.
   * @param stage    - Etapa de la cascada.
   * @param data     - Datos a validar (arreglo de registros clave-valor).
   */
  async executeRules(
    uploadId: string,
    stage: CascadeStage,
    data: Record<string, string>[],
  ): Promise<QualityExecutionSummary> {
    const rules = this.listRules(stage).filter((r) => r.enabled);
    const now = new Date().toISOString();
    const results: QualityResultRecord[] = [];
    const alerts: QualityAlert[] = [];

    for (const rule of rules) {
      // Evaluar la regla contra los datos
      const details = this.evaluateRule(rule, data);
      const passed = details.compliancePercent / 100 >= rule.threshold;
      const result: QualityResultRecord = {
        uploadId,
        ruleId: rule.ruleId,
        ruleName: rule.ruleName,
        ruleExpression: rule.expression,
        result: passed ? 'passed' : 'failed',
        details,
        executedAt: now,
      };

      results.push(result);

      // Registrar resultado en DynamoDB
      await this.saveResultToDynamo(result);

      // Generar alerta si la regla falló
      if (!passed) {
        const alert = this.createAlert(uploadId, rule, stage, details, now);
        alerts.push(alert);
        await this.publishAlert(alert);
      }
    }

    return {
      uploadId,
      stage,
      totalRules: rules.length,
      passed: results.filter((r) => r.result === 'passed').length,
      failed: results.filter((r) => r.result === 'failed').length,
      results,
      executedAt: now,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Motor de evaluación de reglas                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Evaluar una regla contra un conjunto de datos.
   * Delega al evaluador correspondiente según el tipo de regla.
   *
   * En producción, esto se integraría con AWS Glue Data Quality.
   * Aquí implementamos evaluación local para los tipos básicos.
   */
  evaluateRule(rule: QualityRule, data: Record<string, string>[]): QualityResultDetails {
    const totalRecords = data.length;

    if (totalRecords === 0) {
      return {
        recordsEvaluated: 0,
        recordsPassed: 0,
        recordsFailed: 0,
        compliancePercent: 0,
        message: 'No hay registros para evaluar',
      };
    }

    switch (rule.type) {
      case 'completeness':
        return this.evaluateCompleteness(rule, data);
      case 'uniqueness':
        return this.evaluateUniqueness(rule, data);
      case 'range':
        return this.evaluateRange(rule, data);
      case 'format':
        return this.evaluateFormat(rule, data);
      default:
        // Para tipos no implementados localmente (referential, custom),
        // se delegaría a Glue Data Quality.
        return this.evaluateCustom(rule, data);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Evaluadores por tipo de regla                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Completeness: verifica que la columna objetivo no tenga valores nulos o vacíos.
   */
  private evaluateCompleteness(
    rule: QualityRule,
    data: Record<string, string>[],
  ): QualityResultDetails {
    const column = rule.targetColumn;
    if (!column) {
      return this.buildDetails(data.length, 0, 'No se especificó columna objetivo');
    }

    let passed = 0;
    for (const row of data) {
      const value = row[column];
      if (value !== undefined && value !== null && value.trim() !== '') {
        passed++;
      }
    }

    const failed = data.length - passed;
    return this.buildDetails(
      data.length,
      passed,
      failed > 0
        ? `${failed} registros con valores vacíos en columna "${column}"`
        : `Todos los registros tienen valores en columna "${column}"`,
    );
  }

  /**
   * Uniqueness: verifica que los valores de la columna objetivo sean únicos.
   */
  private evaluateUniqueness(
    rule: QualityRule,
    data: Record<string, string>[],
  ): QualityResultDetails {
    const column = rule.targetColumn;
    if (!column) {
      return this.buildDetails(data.length, 0, 'No se especificó columna objetivo');
    }

    const seen = new Map<string, number>();
    for (const row of data) {
      const value = row[column] ?? '';
      seen.set(value, (seen.get(value) ?? 0) + 1);
    }

    // Registros con valores duplicados se consideran fallidos
    let duplicateCount = 0;
    for (const count of seen.values()) {
      if (count > 1) duplicateCount += count;
    }

    const passed = data.length - duplicateCount;
    return this.buildDetails(
      data.length,
      passed,
      duplicateCount > 0
        ? `${duplicateCount} registros con valores duplicados en columna "${column}"`
        : `Todos los valores son únicos en columna "${column}"`,
    );
  }

  /**
   * Range: verifica que los valores numéricos estén dentro del rango
   * especificado en la expresión (formato: "min,max").
   */
  private evaluateRange(
    rule: QualityRule,
    data: Record<string, string>[],
  ): QualityResultDetails {
    const column = rule.targetColumn;
    if (!column) {
      return this.buildDetails(data.length, 0, 'No se especificó columna objetivo');
    }

    // Parsear rango de la expresión (formato: "min,max")
    const parts = rule.expression.split(',').map((s) => s.trim());
    const min = parseFloat(parts[0]);
    const max = parseFloat(parts[1]);

    if (isNaN(min) || isNaN(max)) {
      return this.buildDetails(data.length, 0, 'Expresión de rango inválida (formato: "min,max")');
    }

    let passed = 0;
    for (const row of data) {
      const value = parseFloat(row[column]);
      if (!isNaN(value) && value >= min && value <= max) {
        passed++;
      }
    }

    const failed = data.length - passed;
    return this.buildDetails(
      data.length,
      passed,
      failed > 0
        ? `${failed} registros fuera del rango [${min}, ${max}] en columna "${column}"`
        : `Todos los valores están en el rango [${min}, ${max}] en columna "${column}"`,
    );
  }

  /**
   * Format: verifica que los valores coincidan con la expresión regular.
   */
  private evaluateFormat(
    rule: QualityRule,
    data: Record<string, string>[],
  ): QualityResultDetails {
    const column = rule.targetColumn;
    if (!column) {
      return this.buildDetails(data.length, 0, 'No se especificó columna objetivo');
    }

    let regex: RegExp;
    try {
      regex = new RegExp(rule.expression);
    } catch {
      return this.buildDetails(data.length, 0, `Expresión regular inválida: "${rule.expression}"`);
    }

    let passed = 0;
    for (const row of data) {
      const value = row[column] ?? '';
      if (regex.test(value)) {
        passed++;
      }
    }

    const failed = data.length - passed;
    return this.buildDetails(
      data.length,
      passed,
      failed > 0
        ? `${failed} registros no coinciden con el formato en columna "${column}"`
        : `Todos los registros coinciden con el formato en columna "${column}"`,
    );
  }

  /**
   * Custom/Referential: evaluación placeholder.
   * En producción se delegaría a AWS Glue Data Quality.
   */
  private evaluateCustom(
    rule: QualityRule,
    data: Record<string, string>[],
  ): QualityResultDetails {
    return this.buildDetails(
      data.length,
      data.length,
      `Regla "${rule.ruleName}" evaluada vía Glue Data Quality (placeholder)`,
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers internos                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Construir objeto de detalles de resultado.
   */
  private buildDetails(
    total: number,
    passed: number,
    message: string,
  ): QualityResultDetails {
    const failed = total - passed;
    const compliancePercent = total > 0 ? (passed / total) * 100 : 0;
    return {
      recordsEvaluated: total,
      recordsPassed: passed,
      recordsFailed: failed,
      compliancePercent,
      message,
    };
  }

  /**
   * Persistir resultado de regla en DynamoDB (tabla QualityResults).
   */
  private async saveResultToDynamo(result: QualityResultRecord): Promise<void> {
    try {
      await client.models.QualityResult.create({
        uploadId: result.uploadId,
        ruleId: result.ruleId,
        ruleName: result.ruleName,
        ruleExpression: result.ruleExpression,
        result: result.result,
        details: JSON.stringify(result.details),
        executedAt: result.executedAt,
      });
    } catch (error) {
      // Registrar error pero no interrumpir la ejecución
      console.error(
        `Error al guardar resultado de regla ${result.ruleId}:`,
        error,
      );
    }
  }

  /**
   * Crear objeto de alerta a partir de una regla fallida.
   */
  private createAlert(
    uploadId: string,
    rule: QualityRule,
    stage: CascadeStage,
    details: QualityResultDetails,
    timestamp: string,
  ): QualityAlert {
    // Determinar severidad según el porcentaje de cumplimiento
    const severity = this.determineSeverity(details.compliancePercent);

    return {
      alertId: crypto.randomUUID(),
      uploadId,
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      stage,
      severity,
      message: `Regla "${rule.ruleName}" falló: ${details.message}`,
      details,
      createdAt: timestamp,
    };
  }

  /**
   * Determinar severidad de la alerta según el porcentaje de cumplimiento.
   */
  private determineSeverity(compliancePercent: number): AlertSeverity {
    if (compliancePercent < 25) return 'critical';
    if (compliancePercent < 50) return 'high';
    if (compliancePercent < 75) return 'medium';
    return 'low';
  }

  /**
   * Publicar alerta vía SNS (placeholder).
   * En producción se enviaría a un topic SNS configurado.
   */
  private async publishAlert(alert: QualityAlert): Promise<void> {
    // Placeholder: en producción se usaría AWS SNS
    // await snsClient.publish({
    //   TopicArn: QUALITY_ALERTS_TOPIC_ARN,
    //   Subject: `Alerta de calidad: ${alert.ruleName}`,
    //   Message: JSON.stringify(alert),
    // });
    console.warn(
      `[Alerta de calidad] ${alert.severity.toUpperCase()}: ${alert.message}`,
    );
  }
}

/** Instancia singleton por defecto. */
export const qualityRulesService = QualityRulesService.getInstance();

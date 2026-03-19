/**
 * Tipos para reglas de calidad, resultados y alertas.
 *
 * Define las estructuras usadas por QualityRulesService para
 * configurar reglas por etapa, registrar resultados de ejecución
 * y generar alertas cuando una regla falla.
 */

import type { CascadeStage } from './csv';

/** Tipos de regla de calidad soportados (compatibles con AWS Glue Data Quality). */
export type QualityRuleType =
  | 'completeness'    // Verifica que no haya valores nulos
  | 'uniqueness'      // Verifica unicidad de valores
  | 'range'           // Verifica que valores estén en un rango
  | 'format'          // Verifica formato de valores (regex)
  | 'referential'     // Verifica integridad referencial
  | 'custom';         // Expresión personalizada

/** Configuración de una regla de calidad. */
export interface QualityRule {
  ruleId: string;
  ruleName: string;
  /** Etapa de la cascada donde aplica la regla. */
  stage: CascadeStage;
  /** Tipo de regla. */
  type: QualityRuleType;
  /** Expresión de la regla (sintaxis Glue Data Quality DQDL). */
  expression: string;
  /** Columna objetivo (opcional, depende del tipo de regla). */
  targetColumn?: string;
  /** Umbral de aprobación (0-1). Por defecto 1.0 = 100% cumplimiento. */
  threshold: number;
  /** Si la regla está activa. */
  enabled: boolean;
  /** Fecha de creación. */
  createdAt: string;
  /** Último usuario que modificó la regla. */
  updatedBy?: string;
}

/** Entrada para crear una regla de calidad. */
export interface CreateQualityRuleInput {
  ruleName: string;
  stage: CascadeStage;
  type: QualityRuleType;
  expression: string;
  targetColumn?: string;
  threshold?: number;
  enabled?: boolean;
}

/** Entrada para actualizar una regla de calidad. */
export interface UpdateQualityRuleInput {
  ruleName?: string;
  expression?: string;
  targetColumn?: string;
  threshold?: number;
  enabled?: boolean;
}

/** Resultado de la ejecución de una regla individual. */
export type QualityResultStatus = 'passed' | 'failed';

/** Resultado registrado en DynamoDB por cada regla ejecutada. */
export interface QualityResultRecord {
  uploadId: string;
  ruleId: string;
  ruleName: string;
  ruleExpression: string;
  result: QualityResultStatus;
  details: QualityResultDetails;
  executedAt: string;
}

/** Detalles del resultado de ejecución de una regla. */
export interface QualityResultDetails {
  /** Número de registros evaluados. */
  recordsEvaluated: number;
  /** Número de registros que pasaron la regla. */
  recordsPassed: number;
  /** Número de registros que fallaron la regla. */
  recordsFailed: number;
  /** Porcentaje de cumplimiento (0-100). */
  compliancePercent: number;
  /** Mensaje descriptivo del resultado. */
  message: string;
}

/** Resumen de ejecución de todas las reglas para un upload. */
export interface QualityExecutionSummary {
  uploadId: string;
  stage: CascadeStage;
  totalRules: number;
  passed: number;
  failed: number;
  /** Resultados individuales por regla. */
  results: QualityResultRecord[];
  executedAt: string;
}

/** Severidad de una alerta de calidad. */
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

/** Alerta generada cuando una regla de calidad falla. */
export interface QualityAlert {
  alertId: string;
  uploadId: string;
  ruleId: string;
  ruleName: string;
  stage: CascadeStage;
  severity: AlertSeverity;
  message: string;
  details: QualityResultDetails;
  createdAt: string;
}

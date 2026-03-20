/**
 * Pure helper functions for the quality-evaluator Lambda.
 *
 * Extracted from handler.ts so they can be tested without AWS SDK dependencies.
 * The handler re-uses these functions at runtime.
 */

// ─── Types ───────────────────────────────────────────────────────

/** Severity levels for quality alerts. */
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

/** Result status for a single rule evaluation. */
export type QualityResultStatus = 'passed' | 'failed';

/** Details of a single rule evaluation result. */
export interface QualityResultDetails {
  recordsEvaluated: number;
  recordsPassed: number;
  recordsFailed: number;
  compliancePercent: number;
  message: string;
}

/** A single quality result record persisted to DynamoDB. */
export interface QualityResultRecord {
  uploadId: string;
  ruleId: string;
  ruleName: string;
  ruleExpression: string;
  result: QualityResultStatus;
  details: QualityResultDetails;
  executedAt: string;
}

/** Alert generated when a quality rule fails. */
export interface QualityAlert {
  alertId: string;
  uploadId: string;
  ruleId: string;
  ruleName: string;
  stage: string;
  severity: AlertSeverity;
  message: string;
  details: QualityResultDetails;
  createdAt: string;
}

/** Summary returned to the frontend after execution. */
export interface QualityExecutionSummary {
  uploadId: string;
  stage: string;
  totalRules: number;
  passed: number;
  failed: number;
  results: QualityResultRecord[];
  alerts: QualityAlert[];
  executedAt: string;
}

/** Shape of a single Glue Data Quality rule result. */
export interface GlueRuleResult {
  Name?: string;
  Description?: string;
  Result?: string; // "PASS" | "FAIL"
  EvaluatedMetrics?: Record<string, number>;
  EvaluationMessage?: string;
}

// ─── Pure helper functions ───────────────────────────────────────

/**
 * Determines alert severity based on compliance percentage.
 *
 * Thresholds:
 * - < 25%  → critical
 * - 25-49% → high
 * - 50-74% → medium
 * - >= 75% → low
 */
export function determineSeverity(compliancePercent: number): AlertSeverity {
  if (compliancePercent < 25) return 'critical';
  if (compliancePercent < 50) return 'high';
  if (compliancePercent < 75) return 'medium';
  return 'low';
}

/**
 * Maps a Glue Data Quality rule result to a QualityResultRecord.
 */
export function mapGlueResult(
  glueResult: GlueRuleResult,
  ruleId: string,
  ruleName: string,
  ruleExpression: string,
  uploadId: string,
  executedAt: string,
): QualityResultRecord {
  const metrics = glueResult.EvaluatedMetrics ?? {};

  const recordsEvaluated = metrics['Dataset.*.RowCount']
    ?? metrics['RowCount']
    ?? Object.values(metrics).find((v) => typeof v === 'number')
    ?? 0;

  const outcome = glueResult.Result?.toUpperCase();
  const result: QualityResultStatus = outcome === 'PASS' ? 'passed' : 'failed';

  let recordsPassed: number;
  let recordsFailed: number;

  if (metrics['Dataset.*.PassedCount'] !== undefined && metrics['Dataset.*.FailedCount'] !== undefined) {
    recordsPassed = metrics['Dataset.*.PassedCount'];
    recordsFailed = metrics['Dataset.*.FailedCount'];
  } else if (recordsEvaluated > 0 && result === 'passed') {
    recordsPassed = recordsEvaluated;
    recordsFailed = 0;
  } else if (recordsEvaluated > 0 && result === 'failed') {
    recordsPassed = 0;
    recordsFailed = recordsEvaluated;
  } else {
    recordsPassed = 0;
    recordsFailed = 0;
  }

  const compliancePercent =
    recordsEvaluated > 0
      ? (recordsPassed / recordsEvaluated) * 100
      : result === 'passed'
        ? 100
        : 0;

  const message =
    glueResult.EvaluationMessage
    ?? (result === 'passed'
      ? `Rule "${ruleName}" passed with ${compliancePercent.toFixed(1)}% compliance`
      : `Rule "${ruleName}" failed with ${compliancePercent.toFixed(1)}% compliance`);

  return {
    uploadId,
    ruleId,
    ruleName,
    ruleExpression,
    result,
    details: {
      recordsEvaluated,
      recordsPassed,
      recordsFailed,
      compliancePercent,
      message,
    },
    executedAt,
  };
}

/**
 * Builds a QualityExecutionSummary from individual result records.
 *
 * Invariants:
 * - totalRules === results.length
 * - passed + failed === totalRules
 * - alerts are generated only for failed rules
 */
export function buildSummary(
  uploadId: string,
  stage: string,
  results: QualityResultRecord[],
  executedAt: string,
): QualityExecutionSummary {
  const passed = results.filter((r) => r.result === 'passed').length;
  const failed = results.filter((r) => r.result === 'failed').length;

  const alerts: QualityAlert[] = results
    .filter((r) => r.result === 'failed')
    .map((r) => ({
      alertId: `alert-${r.ruleId}-${Date.now()}`,
      uploadId,
      ruleId: r.ruleId,
      ruleName: r.ruleName,
      stage,
      severity: determineSeverity(r.details.compliancePercent),
      message: `Quality rule "${r.ruleName}" failed: ${r.details.compliancePercent.toFixed(1)}% compliance`,
      details: r.details,
      createdAt: executedAt,
    }));

  return {
    uploadId,
    stage,
    totalRules: results.length,
    passed,
    failed,
    results,
    alerts,
    executedAt,
  };
}

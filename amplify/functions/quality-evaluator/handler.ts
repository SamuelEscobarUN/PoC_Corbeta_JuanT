import type { AppSyncResolverHandler } from 'aws-lambda';
import {
  GlueClient,
  StartDataQualityRulesetEvaluationRunCommand,
  GetDataQualityResultCommand,
  GetDataQualityRulesetEvaluationRunCommand,
} from '@aws-sdk/client-glue';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

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

/** Shape of a QualityRule record from DynamoDB. */
interface QualityRuleRecord {
  ruleId: string;
  ruleName: string;
  stage: string;
  type: string;
  expression: string;
  targetColumn?: string;
  threshold: number;
  enabled: boolean;
  createdAt: string;
  updatedBy?: string;
}

/** Shape of an Upload record from DynamoDB. */
interface UploadRecord {
  uploadId: string;
  s3Key: string;
  stage: string;
  fileName: string;
  status: string;
}

/** Shape of a single Glue Data Quality rule result. */
export interface GlueRuleResult {
  Name?: string;
  Description?: string;
  Result?: string; // "PASS" | "FAIL"
  EvaluatedMetrics?: Record<string, number>;
  EvaluationMessage?: string;
}

// ─── DQDL Translation (inlined to avoid cross-project import issues) ─────

/**
 * Translates a single quality rule to its DQDL expression.
 * Inlined from src/services/dqdl-translator.ts for Lambda bundling.
 */
function translateSingleRule(rule: QualityRuleRecord): string {
  const { type, targetColumn, threshold, expression } = rule;

  switch (type) {
    case 'completeness': {
      if (!targetColumn?.trim()) {
        throw new Error(`Rule "${rule.ruleName}" (${rule.ruleId}): targetColumn is required for type "completeness"`);
      }
      return `Completeness "${targetColumn}" >= ${threshold}`;
    }
    case 'uniqueness': {
      if (!targetColumn?.trim()) {
        throw new Error(`Rule "${rule.ruleName}" (${rule.ruleId}): targetColumn is required for type "uniqueness"`);
      }
      return `Uniqueness "${targetColumn}" >= ${threshold}`;
    }
    case 'range': {
      if (!targetColumn?.trim()) {
        throw new Error(`Rule "${rule.ruleName}" (${rule.ruleId}): targetColumn is required for type "range"`);
      }
      const parts = expression.split(',');
      if (parts.length !== 2) {
        throw new Error(`Rule "${rule.ruleName}" (${rule.ruleId}): invalid range format "${expression}". Expected "min,max"`);
      }
      const min = Number(parts[0].trim());
      const max = Number(parts[1].trim());
      if (isNaN(min) || isNaN(max)) {
        throw new Error(`Rule "${rule.ruleName}" (${rule.ruleId}): non-numeric range values in "${expression}"`);
      }
      if (min > max) {
        throw new Error(`Rule "${rule.ruleName}" (${rule.ruleId}): min (${min}) cannot be greater than max (${max})`);
      }
      return `ColumnValues "${targetColumn}" between ${min} and ${max}`;
    }
    case 'format': {
      if (!targetColumn?.trim()) {
        throw new Error(`Rule "${rule.ruleName}" (${rule.ruleId}): targetColumn is required for type "format"`);
      }
      return `ColumnValues "${targetColumn}" matches "${expression}"`;
    }
    case 'custom': {
      if (!expression?.trim()) {
        throw new Error(`Rule "${rule.ruleName}" (${rule.ruleId}): custom expression cannot be empty`);
      }
      return expression;
    }
    default:
      throw new Error(`Rule "${rule.ruleName}" (${rule.ruleId}): unsupported rule type "${type}"`);
  }
}

/**
 * Translates an array of rules to a DQDL ruleset string.
 */
function translateRulesToDqdl(rules: QualityRuleRecord[]): { ruleset: string; errors: Array<{ ruleId: string; ruleName: string; message: string }> } {
  const errors: Array<{ ruleId: string; ruleName: string; message: string }> = [];
  const expressions: string[] = [];

  for (const rule of rules) {
    try {
      const expr = translateSingleRule(rule);
      expressions.push(expr);
    } catch (err) {
      errors.push({
        ruleId: rule.ruleId,
        ruleName: rule.ruleName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const ruleset =
    expressions.length > 0
      ? `Rules = [\n${expressions.map((e) => `  ${e}`).join(',\n')}\n]`
      : 'Rules = []';

  return { ruleset, errors };
}

// ─── Exported helper functions (testable independently) ──────────

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
 *
 * @param glueResult - The raw Glue rule result
 * @param ruleId - The platform rule ID
 * @param ruleName - The platform rule name
 * @param ruleExpression - The DQDL expression that was evaluated
 * @param uploadId - The upload being evaluated
 * @param executedAt - ISO timestamp of execution
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

  // Derive passed/failed counts from metrics when available
  let recordsPassed: number;
  let recordsFailed: number;

  if (metrics['Dataset.*.PassedCount'] !== undefined && metrics['Dataset.*.FailedCount'] !== undefined) {
    recordsPassed = metrics['Dataset.*.PassedCount'];
    recordsFailed = metrics['Dataset.*.FailedCount'];
  } else if (recordsEvaluated > 0 && result === 'passed') {
    recordsPassed = recordsEvaluated;
    recordsFailed = 0;
  } else if (recordsEvaluated > 0 && result === 'failed') {
    // Use any available metric hints, otherwise assume all failed
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

// ─── AWS Clients ─────────────────────────────────────────────────

const glueClient = new GlueClient({});
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ─── Environment variables ───────────────────────────────────────

const QUALITY_RULE_TABLE = process.env.TABLE_NAME ?? '';
const UPLOAD_TABLE = process.env.UPLOAD_TABLE_NAME ?? '';
const QUALITY_RESULT_TABLE = process.env.QUALITY_RESULT_TABLE_NAME ?? '';
const BUCKET_NAME = process.env.BUCKET_NAME ?? '';

// ─── DynamoDB helpers ────────────────────────────────────────────

/**
 * Fetches active quality rules for a given stage from DynamoDB.
 * Uses the stage-index GSI and filters by enabled=true.
 */
async function getActiveRules(stage: string): Promise<QualityRuleRecord[]> {
  const result = await ddbClient.send(
    new QueryCommand({
      TableName: QUALITY_RULE_TABLE,
      IndexName: 'stage-index',
      KeyConditionExpression: '#stage = :stage',
      FilterExpression: '#enabled = :enabled',
      ExpressionAttributeNames: {
        '#stage': 'stage',
        '#enabled': 'enabled',
      },
      ExpressionAttributeValues: {
        ':stage': stage,
        ':enabled': true,
      },
    }),
  );

  return (result.Items ?? []) as QualityRuleRecord[];
}

/**
 * Fetches upload metadata from DynamoDB.
 */
async function getUpload(uploadId: string): Promise<UploadRecord | null> {
  const result = await ddbClient.send(
    new GetCommand({
      TableName: UPLOAD_TABLE,
      Key: { uploadId },
    }),
  );

  return (result.Item as UploadRecord) ?? null;
}

/**
 * Persists quality result records to DynamoDB using BatchWrite.
 * Splits into chunks of 25 (DynamoDB limit).
 */
async function persistResults(records: QualityResultRecord[]): Promise<void> {
  const BATCH_SIZE = 25;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await ddbClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [QUALITY_RESULT_TABLE]: batch.map((record) => ({
            PutRequest: {
              Item: {
                uploadId: record.uploadId,
                ruleId: record.ruleId,
                ruleName: record.ruleName,
                ruleExpression: record.ruleExpression,
                result: record.result,
                details: record.details,
                executedAt: record.executedAt,
              },
            },
          })),
        },
      }),
    );
  }
}

// ─── Glue Data Quality helpers ───────────────────────────────────

const GLUE_POLL_INTERVAL_MS = 3000;
const GLUE_MAX_POLL_ATTEMPTS = 60; // ~3 minutes max

/**
 * Starts a Glue Data Quality evaluation run and waits for completion.
 * Returns the array of rule results.
 */
async function executeGlueDataQuality(
  s3Key: string,
  dqdlRuleset: string,
): Promise<GlueRuleResult[]> {
  // Start the evaluation run
  const startResponse = await glueClient.send(
    new StartDataQualityRulesetEvaluationRunCommand({
      DataSource: {
        GlueTable: {
          DatabaseName: 'default',
          TableName: 'quality_evaluation',
          AdditionalOptions: {
            // Point to the specific CSV file in S3
            'pushDownPredicate': `s3://${BUCKET_NAME}/${s3Key}`,
          },
        },
      },
      RulesetNames: ['inline-ruleset'],
      AdditionalRunOptions: {
        CloudWatchMetricsEnabled: false,
      },
    }),
  );

  const runId = startResponse.RunId;
  if (!runId) {
    throw new Error('Glue Data Quality did not return a RunId');
  }

  // Poll for completion
  for (let attempt = 0; attempt < GLUE_MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(GLUE_POLL_INTERVAL_MS);

    const runStatus = await glueClient.send(
      new GetDataQualityRulesetEvaluationRunCommand({
        RunId: runId,
      }),
    );

    const status = runStatus.Status;

    if (status === 'SUCCEEDED') {
      break;
    }

    if (status === 'FAILED' || status === 'STOPPED' || status === 'ERROR') {
      const errorMsg = runStatus.ErrorString ?? `Glue DQ run ${status}`;
      throw new Error(`Glue Data Quality run failed: ${errorMsg}`);
    }

    // RUNNING, STARTING, STOPPING — continue polling
  }

  // Get the results
  const resultResponse = await glueClient.send(
    new GetDataQualityResultCommand({
      ResultId: runId,
    }),
  );

  return (resultResponse.RuleResults ?? []) as GlueRuleResult[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main Handler ────────────────────────────────────────────────

/**
 * AppSync resolver handler for executing quality rules via AWS Glue Data Quality.
 *
 * Flow:
 * 1. Validate input and fetch upload metadata
 * 2. Fetch active rules for the stage
 * 3. Translate rules to DQDL
 * 4. Execute via Glue Data Quality
 * 5. Map results, generate alerts, build summary
 * 6. Persist results to DynamoDB
 * 7. Return summary as JSON string
 */
export const handler: AppSyncResolverHandler<
  { uploadId: string; stage: string },
  string
> = async (event) => {
  const { uploadId, stage } = event.arguments;
  const executedAt = new Date().toISOString();

  try {
    // 1. Fetch upload metadata
    const upload = await getUpload(uploadId);
    if (!upload) {
      return JSON.stringify({ error: `Upload ${uploadId} no encontrado` });
    }

    const s3Key = upload.s3Key;
    if (!s3Key) {
      return JSON.stringify({ error: `Archivo S3 no encontrado: upload ${uploadId} no tiene s3Key` });
    }

    // 2. Fetch active rules for the stage
    const activeRules = await getActiveRules(stage);

    if (activeRules.length === 0) {
      // No active rules — return empty summary (not an error per design)
      const emptySummary: QualityExecutionSummary = {
        uploadId,
        stage,
        totalRules: 0,
        passed: 0,
        failed: 0,
        results: [],
        alerts: [],
        executedAt,
      };
      return JSON.stringify(emptySummary);
    }

    // 3. Translate rules to DQDL
    const { ruleset, errors: dqdlErrors } = translateRulesToDqdl(activeRules);

    if (dqdlErrors.length > 0) {
      const firstError = dqdlErrors[0];
      return JSON.stringify({
        error: `Error DQDL en regla ${firstError.ruleId}: ${firstError.message}`,
      });
    }

    if (ruleset === 'Rules = []') {
      // All rules failed translation — return error
      return JSON.stringify({
        error: 'No se pudieron traducir las reglas a DQDL',
      });
    }

    // 4. Execute via Glue Data Quality
    let glueResults: GlueRuleResult[];
    try {
      glueResults = await executeGlueDataQuality(s3Key, ruleset);
    } catch (glueError) {
      const errorMsg = glueError instanceof Error ? glueError.message : String(glueError);
      console.error('Glue Data Quality error:', errorMsg);
      return JSON.stringify({ error: `Error Glue DQ: ${errorMsg}` });
    }

    // 5. Map results to QualityResultRecords
    const resultRecords: QualityResultRecord[] = activeRules.map((rule, index) => {
      const glueResult = glueResults[index] ?? {
        Result: 'FAIL',
        EvaluatedMetrics: {},
        EvaluationMessage: 'No result returned from Glue',
      };

      let ruleExpression: string;
      try {
        ruleExpression = translateSingleRule(rule);
      } catch {
        ruleExpression = rule.expression;
      }

      return mapGlueResult(
        glueResult,
        rule.ruleId,
        rule.ruleName,
        ruleExpression,
        uploadId,
        executedAt,
      );
    });

    // 6. Build summary with alerts
    const summary = buildSummary(uploadId, stage, resultRecords, executedAt);

    // 7. Persist results to DynamoDB (non-blocking — don't fail the response)
    try {
      await persistResults(resultRecords);
    } catch (persistError) {
      console.error('Error persisting results to DynamoDB:', persistError);
      // Continue — results are still returned to the frontend
    }

    return JSON.stringify(summary);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('Quality evaluator error:', errorMsg);
    return JSON.stringify({ error: errorMsg });
  }
};

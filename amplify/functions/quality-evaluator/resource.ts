import { defineFunction } from '@aws-amplify/backend';

/**
 * Lambda function that evaluates data quality rules using AWS Glue Data Quality.
 * Receives uploadId and stage, executes DQDL rules against CSV data in S3,
 * and returns a QualityExecutionSummary.
 */
export const qualityEvaluatorFn = defineFunction({
  name: 'quality-evaluator',
  entry: './handler.ts',
});

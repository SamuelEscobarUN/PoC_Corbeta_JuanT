import { defineFunction } from '@aws-amplify/backend';

/**
 * Lambda function for the reconciliation API.
 * Handles backend processing: transformations, comparisons,
 * AI analysis via Bedrock, and XML generation.
 */
export const reconciliationApi = defineFunction({
  name: 'reconciliation-api',
  entry: './handler.ts',
  timeoutSeconds: 300,
  memoryMB: 512,
  environment: {
    STAGE: 'dev',
  },
});

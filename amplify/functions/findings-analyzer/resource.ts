import { defineFunction } from '@aws-amplify/backend';

/**
 * Lambda function that analyzes discrepancies using Amazon Bedrock Nova Premier.
 * Receives discrepancies and returns AI-generated findings.
 */
export const findingsAnalyzer = defineFunction({
  name: 'findings-analyzer',
  entry: './handler.ts',
  timeoutSeconds: 120,
  memoryMB: 256,
  environment: {
    BEDROCK_MODEL_ID: 'amazon.nova-premier-v1:0',
    AWS_BEDROCK_REGION: 'us-east-1',
  },
});

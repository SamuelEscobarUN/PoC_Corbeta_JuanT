import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * Amplify Data configuration using DynamoDB via AppSync (GraphQL).
 *
 * Tables and key schema (mapped from design):
 * - Uploads:        PK=UPLOAD#{uploadId}, SK=METADATA
 * - Discrepancies:  PK=SESSION#{sessionId}, SK=DISC#{discrepancyId}
 *                   GSI invoice-index: PK=invoice, SK=detectedAt
 * - Findings:       PK=DISC#{discrepancyId}, SK=FINDING#{findingId}
 * - Corrections:    PK=CORRECTION#{correctionId}, SK=METADATA
 *                   GSI status-index: PK=status, SK=proposedAt
 * - QualityResults: PK=UPLOAD#{uploadId}, SK=QUALITY#{ruleId}
 */
const schema = a.schema({
  Upload: a
    .model({
      uploadId: a.id().required(),
      stage: a.string().required(),
      fileName: a.string().required(),
      fileSize: a.integer(),
      status: a.enum(['uploaded', 'processing', 'transformed', 'compared', 'error']),
      s3Key: a.string().required(),
      uploadedBy: a.string().required(),
      uploadedAt: a.datetime().required(),
      errorMessage: a.string(),
    })
    .identifier(['uploadId'])
    .secondaryIndexes((index) => [
      index('stage').sortKeys(['uploadedAt']).name('stage-date-index'),
      index('status').sortKeys(['uploadedAt']).name('status-date-index'),
    ])
    .authorization((allow) => [
      allow.group('Administrator'),
      allow.group('Operator'),
    ]),

  Discrepancy: a
    .model({
      sessionId: a.string().required(),
      discrepancyId: a.id().required(),
      invoice: a.string().required(),
      type: a.enum([
        'missing_invoice',
        'total_difference',
        'item_count_difference',
        'missing_item',
      ]),
      sourceStage: a.string().required(),
      targetStage: a.string().required(),
      expectedValue: a.string(),
      actualValue: a.string(),
      detectedAt: a.datetime().required(),
      details: a.json(),
    })
    .identifier(['sessionId', 'discrepancyId'])
    .secondaryIndexes((index) => [
      index('invoice').sortKeys(['detectedAt']).name('invoice-index'),
    ])
    .authorization((allow) => [
      allow.group('Administrator'),
      allow.group('Operator'),
    ]),

  Finding: a
    .model({
      discrepancyId: a.string().required(),
      findingId: a.id().required(),
      explanation: a.string().required(),
      probableCause: a.string().required(),
      recommendation: a.string().required(),
      severity: a.enum(['low', 'medium', 'high', 'critical']),
      itemDetails: a.json(),
      analyzedAt: a.datetime().required(),
    })
    .identifier(['discrepancyId', 'findingId'])
    .authorization((allow) => [
      allow.group('Administrator'),
      allow.group('Operator'),
    ]),

  Correction: a
    .model({
      correctionId: a.id().required(),
      discrepancyId: a.string().required(),
      findingId: a.string().required(),
      invoice: a.string().required(),
      item: a.string(),
      originStage: a.string().required(),
      correctedValues: a.json().required(),
      status: a.enum(['pending_approval', 'approved', 'rejected']),
      proposedBy: a.string().required(),
      proposedAt: a.datetime().required(),
      reviewedBy: a.string(),
      reviewedAt: a.datetime(),
      rejectionReason: a.string(),
      xmlS3Key: a.string(),
    })
    .identifier(['correctionId'])
    .secondaryIndexes((index) => [
      index('status').sortKeys(['proposedAt']).name('status-index'),
    ])
    .authorization((allow) => [
      allow.group('Administrator'),
      allow.group('Operator'),
    ]),

  QualityResult: a
    .model({
      uploadId: a.string().required(),
      ruleId: a.string().required(),
      ruleName: a.string().required(),
      ruleExpression: a.string(),
      result: a.enum(['passed', 'failed']),
      details: a.json(),
      executedAt: a.datetime().required(),
    })
    .identifier(['uploadId', 'ruleId'])
    .authorization((allow) => [
      allow.group('Administrator'),
      allow.group('Operator'),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});

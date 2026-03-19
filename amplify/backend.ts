import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { reconciliationApi } from './functions/reconciliation-api/resource';

/**
 * Amplify Gen 2 backend definition.
 * Combines all resources: Auth (Cognito), Data (DynamoDB via AppSync),
 * Storage (S3), and Functions (Lambda).
 */
export const backend = defineBackend({
  auth,
  data,
  storage,
  reconciliationApi,
});

// Grant Bedrock InvokeModel permission to the findings-analyzer Lambda
// The function is defined inline in data/resource.ts as a custom query handler
const dataStack = backend.data.resources.cfnResources;
// Access the findings-analyzer function through the data resource
const findingsAnalyzerLambda = backend.data.resources.functions['findings-analyzer'];
if (findingsAnalyzerLambda) {
  findingsAnalyzerLambda.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['bedrock:InvokeModel', 'bedrock:Converse'],
      resources: ['arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-premier-v1:0'],
    }),
  );
}

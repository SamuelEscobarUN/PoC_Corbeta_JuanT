import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
// TODO: Re-enable when Docker is available for Lambda bundling
// import { reconciliationApi } from './functions/reconciliation-api/resource';

/**
 * Amplify Gen 2 backend definition.
 * Combines all resources: Auth (Cognito), Data (DynamoDB via AppSync),
 * Storage (S3), and Functions (Lambda).
 */
export const backend = defineBackend({
  auth,
  data,
  storage,
  // reconciliationApi,
});

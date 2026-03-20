import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { reconciliationApi } from './functions/reconciliation-api/resource';
import { userManagementFn } from './functions/user-management/resource';
import { qualityEvaluatorFn } from './functions/quality-evaluator/resource';

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
  userManagementFn,
  qualityEvaluatorFn,
});

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

// Grant Cognito Admin permissions to the user-management-query Lambda
const userPoolId = backend.auth.resources.userPool.userPoolId;
backend.userManagementFn.addEnvironment('USER_POOL_ID', userPoolId);
backend.userManagementFn.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      'cognito-idp:ListUsers',
      'cognito-idp:AdminListGroupsForUser',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:AdminRemoveUserFromGroup',
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminDeleteUser',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminUpdateUserAttributes',
    ],
    resources: [backend.auth.resources.userPool.userPoolArn],
  }),
);

// ─── Quality Evaluator Lambda: permissions and environment ───────
// S3 bucket for reading uploaded CSV files
const uploadsBucket = backend.storage.resources.bucket;

// Pass bucket name to the Lambda
backend.qualityEvaluatorFn.addEnvironment(
  'BUCKET_NAME',
  uploadsBucket.bucketName,
);

// Grant Glue Data Quality permissions
backend.qualityEvaluatorFn.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      'glue:StartDataQualityRulesetEvaluationRun',
      'glue:GetDataQualityResult',
      'glue:GetDataQualityRulesetEvaluationRun',
    ],
    resources: ['*'],
  }),
);

// Grant S3 read access for the uploads bucket
backend.qualityEvaluatorFn.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['s3:GetObject', 's3:ListBucket'],
    resources: [uploadsBucket.bucketArn, `${uploadsBucket.bucketArn}/*`],
  }),
);

// Grant DynamoDB access for QualityRule (read), Upload (read), QualityResult (write)
backend.qualityEvaluatorFn.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:Scan',
      'dynamodb:PutItem',
      'dynamodb:BatchWriteItem',
      'dynamodb:ListTables',
    ],
    resources: ['*'],
  }),
);

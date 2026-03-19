import { defineAuth } from '@aws-amplify/backend';

/**
 * Amplify Auth configuration with Amazon Cognito.
 * Defines two user groups: Administrator and Operator.
 * - Administrator: Full access to all platform features including user management,
 *   quality rule configuration, and correction approval/rejection.
 * - Operator: Access to upload files, view discrepancies, propose corrections,
 *   and interact with the conversational agent.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  userAttributes: {
    preferredUsername: {
      required: false,
      mutable: true,
    },
  },
  groups: ['Administrator', 'Operator'],
});

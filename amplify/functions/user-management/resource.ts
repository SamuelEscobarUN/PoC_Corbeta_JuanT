import { defineFunction } from '@aws-amplify/backend';

export const userManagementFn = defineFunction({
  name: 'user-management-query',
  entry: './handler.ts',
});

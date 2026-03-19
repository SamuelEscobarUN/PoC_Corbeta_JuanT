import { defineStorage } from '@aws-amplify/backend';

/**
 * Amplify Storage configuration with Amazon S3.
 *
 * S3 prefix structure:
 * - uploads/{stage}/{yyyy}/{mm}/{dd}/{uploadId}/raw.csv     → Raw CSV uploads
 * - normalized/{stage}/{uploadId}/normalized.json            → Transformed/normalized data
 * - corrections/{correctionId}/correction.xml                → Generated correction XML files
 *
 * Access rules:
 * - Authenticated users can read all paths
 * - Authenticated users can write to uploads/ (file upload)
 * - Only the backend (Lambda) writes to normalized/ and corrections/
 */
export const storage = defineStorage({
  name: 'reconciliationStorage',
  access: (allow) => ({
    'uploads/*': [
      allow.authenticated.to(['read', 'write', 'delete']),
      allow.groups(['Administrator', 'Operator']).to(['read', 'write', 'delete']),
    ],
    'normalized/*': [
      allow.authenticated.to(['read']),
      allow.groups(['Administrator', 'Operator']).to(['read']),
    ],
    'corrections/*': [
      allow.authenticated.to(['read']),
      allow.groups(['Administrator', 'Operator']).to(['read']),
    ],
  }),
});

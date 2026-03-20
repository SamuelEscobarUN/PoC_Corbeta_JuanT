/**
 * Upload-related types for the data reconciliation platform.
 *
 * Defines the result of an upload operation, the record stored in
 * DynamoDB, and the filters/pagination used for querying upload history.
 */

import type { CascadeStage } from './csv';

/** Status values for an upload record. */
export type UploadStatus =
  | 'uploaded'
  | 'processing'
  | 'transformed'
  | 'compared'
  | 'error';

/** Result returned after a successful file upload. */
export interface UploadResult {
  uploadId: string;
  s3Key: string;
  stage: CascadeStage;
  status: 'success' | 'failed';
  catalogEntryId: string;
  timestamp: string;
}

/** A persisted upload record as stored in DynamoDB. */
export interface UploadRecord {
  uploadId: string;
  sessionId?: string;
  stage: CascadeStage;
  fileName: string;
  fileSize: number;
  status: UploadStatus;
  s3Key: string;
  uploadedBy: string;
  uploadedAt: string;
  errorMessage?: string;
}

/** Filters for querying upload history. */
export interface UploadFilters {
  stage?: CascadeStage;
  status?: UploadStatus;
  dateFrom?: string;
  dateTo?: string;
}

/** Generic paginated result wrapper. */
export interface PaginatedResult<T> {
  items: T[];
  nextToken?: string | null;
}

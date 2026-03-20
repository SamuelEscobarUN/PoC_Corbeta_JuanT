/**
 * UploadService — handles CSV file uploads to S3, metadata persistence
 * in DynamoDB, Glue Data Catalog registration, and automatic processing
 * trigger.
 *
 * Uses Amplify Storage (uploadData) for S3 and Amplify Data (generateClient)
 * for DynamoDB operations via the Upload model.
 */

import { uploadData, remove, downloadData } from 'aws-amplify/storage';
import { generateClient } from 'aws-amplify/data';

import type { Schema } from '../../amplify/data/resource';
import type { CascadeStage, ValidationResult } from '../types/csv';
import type {
  UploadResult,
  UploadRecord,
  UploadFilters,
  PaginatedResult,
} from '../types/upload';
import { StoragePaths } from '../amplify-config';
import { validateFileFormat } from './csv-validator';

/** Amplify Data client typed to our schema. */
const client = generateClient<Schema>();

export class UploadService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: UploadService;

  private constructor() {}

  static getInstance(): UploadService {
    if (!UploadService.instance) {
      UploadService.instance = new UploadService();
    }
    return UploadService.instance;
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Validate the CSV file format for the given cascade stage.
   * Delegates to the csv-validator module.
   */
  validateFile(content: string, stage: CascadeStage, delimiter?: string): ValidationResult {
    return validateFileFormat(content, stage, delimiter);
  }

  /**
   * Upload a CSV file to S3, register metadata in DynamoDB, register in
   * Glue Data Catalog, and transition the status to `processing`.
   *
   * @param file       - The File object selected by the user.
   * @param stage      - The cascade stage this file belongs to.
   * @param content    - The raw text content of the CSV (pre-read by caller).
   * @param uploadedBy - The userId of the uploader.
   * @param sessionId  - Optional session ID to associate this upload with a work session.
   * @returns An {@link UploadResult} with the upload details.
   */
  async uploadFile(
    file: File,
    stage: CascadeStage,
    content: string,
    uploadedBy: string,
    sessionId?: string,
  ): Promise<UploadResult> {
    // 1. Validate format before uploading
    const validation = this.validateFile(content, stage);
    if (!validation.isValid) {
      return {
        uploadId: '',
        s3Key: '',
        stage,
        status: 'failed',
        catalogEntryId: '',
        timestamp: new Date().toISOString(),
      };
    }

    const uploadId = crypto.randomUUID();
    const now = new Date();
    const s3Key = StoragePaths.rawUpload(stage, now, uploadId);
    const timestamp = now.toISOString();

    try {
      // 2. Upload to S3 via Amplify Storage
      await uploadData({
        path: s3Key,
        data: file,
        options: {
          contentType: 'text/csv',
          bucket: 'reconciliationStorage',
        },
      }).result;

      // 3. Register metadata in DynamoDB with status 'uploaded'
      await client.models.Upload.create({
        uploadId,
        stage,
        fileName: file.name,
        fileSize: file.size,
        status: 'uploaded',
        s3Key,
        uploadedBy,
        uploadedAt: timestamp,
        ...(sessionId && { sessionId }),
      });

      // 4. Register in Glue Data Catalog (catalogEntryId = uploadId for now)
      const catalogEntryId = await this.registerInCatalog(
        uploadId,
        stage,
        s3Key,
      );

      // 5. Upload complete — status stays as 'uploaded'
      // Transformation is done client-side in the preview tab.

      return {
        uploadId,
        s3Key,
        stage,
        status: 'success',
        catalogEntryId,
        timestamp,
      };
    } catch (error) {
      // Record the error in DynamoDB if the upload record was created
      if (uploadId) {
        try {
          await client.models.Upload.update({
            uploadId,
            status: 'error',
            errorMessage:
              error instanceof Error ? error.message : 'Unknown error',
          });
        } catch {
          // Best-effort error recording
        }
      }

      return {
        uploadId,
        s3Key,
        stage,
        status: 'failed',
        catalogEntryId: '',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Query upload history with optional filters and pagination.
   *
   * Uses GSIs (stage-date-index, status-date-index) when a stage or
   * status filter is provided; otherwise lists all uploads.
   */
  async getUploadHistory(
    filters?: UploadFilters,
    nextToken?: string | null,
    limit: number = 20,
  ): Promise<PaginatedResult<UploadRecord>> {
    try {
      let response;

      if (filters?.stage) {
        // Use stage-date-index GSI
        response = await client.models.Upload.listUploadByStageAndUploadedAt(
          { stage: filters.stage },
          {
            sortDirection: 'DESC',
            limit,
            nextToken: nextToken ?? undefined,
          },
        );
      } else if (filters?.status) {
        // Use status-date-index GSI
        response = await client.models.Upload.listUploadByStatusAndUploadedAt(
          { status: filters.status },
          {
            sortDirection: 'DESC',
            limit,
            nextToken: nextToken ?? undefined,
          },
        );
      } else {
        // List all uploads
        response = await client.models.Upload.list({
          limit,
          nextToken: nextToken ?? undefined,
        });
      }

      const items: UploadRecord[] = (response.data ?? []).map(
        (item) => ({
          uploadId: item.uploadId,
          sessionId: item.sessionId ?? undefined,
          stage: item.stage as CascadeStage,
          fileName: item.fileName,
          fileSize: item.fileSize ?? 0,
          status: item.status as UploadRecord['status'],
          s3Key: item.s3Key,
          uploadedBy: item.uploadedBy,
          uploadedAt: item.uploadedAt,
          errorMessage: item.errorMessage ?? undefined,
        }),
      );

      // Apply client-side date filtering if dateFrom/dateTo provided
      const filtered = this.applyDateFilters(items, filters);

      return {
        items: filtered,
        nextToken: response.nextToken ?? null,
      };
    } catch {
      return { items: [], nextToken: null };
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Register the uploaded file in the Glue Data Catalog.
   * In a real implementation this would call the Glue API.
   * For now, returns the uploadId as the catalog entry identifier.
   */
  private async registerInCatalog(
    uploadId: string,
    _stage: string,
    _s3Key: string,
  ): Promise<string> {
    // Placeholder: Glue Data Catalog registration would happen here
    // via AWS SDK or a Lambda function call.
    return `catalog-${uploadId}`;
  }

  /**
   * Apply client-side date range filtering on upload records.
   */
  private applyDateFilters(
    items: UploadRecord[],
    filters?: UploadFilters,
  ): UploadRecord[] {
    if (!filters?.dateFrom && !filters?.dateTo) {
      return items;
    }

    return items.filter((item) => {
      const uploadDate = new Date(item.uploadedAt);
      if (filters.dateFrom && uploadDate < new Date(filters.dateFrom)) {
        return false;
      }
      if (filters.dateTo && uploadDate > new Date(filters.dateTo)) {
        return false;
      }
      return true;
    });
  }

  /**
   * Delete an upload: removes the file from S3 and the record from DynamoDB.
   */
  async deleteUpload(uploadId: string, s3Key: string): Promise<void> {
    await remove({
      path: s3Key,
      options: { bucket: 'reconciliationStorage' },
    });
    await client.models.Upload.delete({ uploadId });
  }

  /**
   * Download a file from S3 and return its text content.
   */
  async downloadFile(s3Key: string): Promise<string> {
    const result = await downloadData({
      path: s3Key,
      options: { bucket: 'reconciliationStorage' },
    }).result;
    const blob = result.body as unknown as Blob;
    return await blob.text();
  }
}

/** Default singleton instance for convenience imports. */
export const uploadService = UploadService.getInstance();

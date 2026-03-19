/**
 * Unit tests for UploadService.
 *
 * All Amplify Storage and Data calls are mocked so the tests run
 * without real AWS services. We verify:
 *  - uploadFile validates the CSV before uploading
 *  - uploadFile uploads to S3 with the correct key structure
 *  - uploadFile creates a DynamoDB record with status 'uploaded'
 *  - uploadFile transitions status to 'processing'
 *  - uploadFile returns a failed result when validation fails
 *  - uploadFile handles S3 upload errors gracefully
 *  - getUploadHistory returns paginated results
 *  - getUploadHistory filters by stage, status, and date range
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mock Amplify modules before importing UploadService               */
/* ------------------------------------------------------------------ */
const { mockUploadData, mockUploadResult } = vi.hoisted(() => {
  const mockUploadResult = vi.fn();
  const mockUploadData = vi.fn(() => ({ result: mockUploadResult() }));
  return { mockUploadData, mockUploadResult };
});

const {
  mockUploadCreate,
  mockUploadUpdate,
  mockUploadList,
  mockUploadListByStage,
  mockUploadListByStatus,
} = vi.hoisted(() => ({
  mockUploadCreate: vi.fn(),
  mockUploadUpdate: vi.fn(),
  mockUploadList: vi.fn(),
  mockUploadListByStage: vi.fn(),
  mockUploadListByStatus: vi.fn(),
}));

vi.mock('aws-amplify/storage', () => ({
  uploadData: mockUploadData,
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Upload: {
        create: mockUploadCreate,
        update: mockUploadUpdate,
        list: mockUploadList,
        listUploadByStageAndUploadedAt: mockUploadListByStage,
        listUploadByStatusAndUploadedAt: mockUploadListByStatus,
      },
    },
  }),
}));

/* Mock crypto.randomUUID for deterministic tests */
const MOCK_UUID = 'test-uuid-1234-5678-abcd';
vi.stubGlobal('crypto', {
  randomUUID: () => MOCK_UUID,
});

import { UploadService } from './upload';
import type { CascadeStage } from '../types/csv';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createMockFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/csv' });
}

function validCsvContent(stage: CascadeStage): string {
  const headers: Record<CascadeStage, string> = {
    geopos_local: 'invoice,total,barcode,description',
    geopos_central: 'invoice,total,barcode,description',
    integracion:
      'TICKET_KEY,INVOICE,TOTAL,SKU,CONCESION,CLI_DOC,TIPO_VENTA,INTEGRATION_TICKET_DATE',
    ps_ck_intfc_vtapos:
      'ACCOUNTING_DT,CK_TIPO_VENTA,INV_ITEM_ID,INVOICE,QTY_REQUESTED,TOTAL',
  };
  return `${headers[stage]}\nval1,val2,val3,val4`;
}

function setupSuccessMocks() {
  mockUploadResult.mockResolvedValue({ path: 'uploads/test/raw.csv' });
  mockUploadCreate.mockResolvedValue({ data: { uploadId: MOCK_UUID } });
  mockUploadUpdate.mockResolvedValue({ data: { uploadId: MOCK_UUID } });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('UploadService', () => {
  let service: UploadService;

  beforeEach(() => {
    vi.clearAllMocks();
    setupSuccessMocks();
    // Create a fresh instance for each test
    service = Object.create(UploadService.prototype) as UploadService;
  });

  /* ---- validateFile ---------------------------------------------- */

  describe('validateFile', () => {
    it('returns valid for a correct CSV', () => {
      const result = service.validateFile(
        validCsvContent('geopos_local'),
        'geopos_local',
      );
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns invalid for an empty file', () => {
      const result = service.validateFile('', 'geopos_local');
      expect(result.isValid).toBe(false);
      expect(result.errors[0].type).toBe('empty_file');
    });

    it('returns invalid for missing columns', () => {
      const result = service.validateFile(
        'invoice,total\nval1,val2',
        'geopos_local',
      );
      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e) => e.type === 'missing_column'),
      ).toBe(true);
    });
  });

  /* ---- uploadFile ------------------------------------------------ */

  describe('uploadFile', () => {
    const stage: CascadeStage = 'geopos_local';
    const content = validCsvContent(stage);
    const uploadedBy = 'user-123';

    it('returns failed result when validation fails', async () => {
      const file = createMockFile('bad.csv', '');
      const result = await service.uploadFile(file, stage, '', uploadedBy);

      expect(result.status).toBe('failed');
      expect(result.uploadId).toBe('');
      expect(mockUploadData).not.toHaveBeenCalled();
    });

    it('uploads to S3 with correct key structure', async () => {
      const file = createMockFile('data.csv', content);
      const result = await service.uploadFile(
        file,
        stage,
        content,
        uploadedBy,
      );

      expect(result.status).toBe('success');
      expect(result.s3Key).toContain('uploads/geopos_local/');
      expect(result.s3Key).toContain(`/${MOCK_UUID}/raw.csv`);
      expect(mockUploadData).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringContaining('uploads/geopos_local/'),
          data: file,
          options: { contentType: 'text/csv' },
        }),
      );
    });

    it('creates DynamoDB record with status uploaded', async () => {
      const file = createMockFile('data.csv', content);
      await service.uploadFile(file, stage, content, uploadedBy);

      expect(mockUploadCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          uploadId: MOCK_UUID,
          stage,
          fileName: 'data.csv',
          status: 'uploaded',
          uploadedBy,
        }),
      );
    });

    it('transitions status to processing after upload', async () => {
      const file = createMockFile('data.csv', content);
      await service.uploadFile(file, stage, content, uploadedBy);

      expect(mockUploadUpdate).toHaveBeenCalledWith({
        uploadId: MOCK_UUID,
        status: 'processing',
      });
    });

    it('returns catalogEntryId in the result', async () => {
      const file = createMockFile('data.csv', content);
      const result = await service.uploadFile(
        file,
        stage,
        content,
        uploadedBy,
      );

      expect(result.catalogEntryId).toBe(`catalog-${MOCK_UUID}`);
    });

    it('returns uploadId and timestamp on success', async () => {
      const file = createMockFile('data.csv', content);
      const result = await service.uploadFile(
        file,
        stage,
        content,
        uploadedBy,
      );

      expect(result.uploadId).toBe(MOCK_UUID);
      expect(result.timestamp).toBeTruthy();
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });

    it('handles S3 upload errors gracefully', async () => {
      mockUploadResult.mockRejectedValue(new Error('S3 upload failed'));
      const file = createMockFile('data.csv', content);
      const result = await service.uploadFile(
        file,
        stage,
        content,
        uploadedBy,
      );

      expect(result.status).toBe('failed');
    });

    it('records error in DynamoDB when upload fails', async () => {
      mockUploadResult.mockRejectedValue(new Error('Network error'));
      const file = createMockFile('data.csv', content);
      await service.uploadFile(file, stage, content, uploadedBy);

      expect(mockUploadUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          uploadId: MOCK_UUID,
          status: 'error',
          errorMessage: 'Network error',
        }),
      );
    });
  });

  /* ---- getUploadHistory ------------------------------------------ */

  describe('getUploadHistory', () => {
    const mockRecords = [
      {
        uploadId: 'upload-1',
        stage: 'geopos_local',
        fileName: 'file1.csv',
        fileSize: 1024,
        status: 'uploaded',
        s3Key: 'uploads/geopos_local/2024/01/15/upload-1/raw.csv',
        uploadedBy: 'user-1',
        uploadedAt: '2024-01-15T10:00:00.000Z',
        errorMessage: null,
      },
      {
        uploadId: 'upload-2',
        stage: 'integracion',
        fileName: 'file2.csv',
        fileSize: 2048,
        status: 'processing',
        s3Key: 'uploads/integracion/2024/01/16/upload-2/raw.csv',
        uploadedBy: 'user-2',
        uploadedAt: '2024-01-16T12:00:00.000Z',
        errorMessage: null,
      },
    ];

    it('lists all uploads when no filters provided', async () => {
      mockUploadList.mockResolvedValue({
        data: mockRecords,
        nextToken: null,
      });

      const result = await service.getUploadHistory();

      expect(mockUploadList).toHaveBeenCalled();
      expect(result.items).toHaveLength(2);
      expect(result.items[0].uploadId).toBe('upload-1');
    });

    it('filters by stage using GSI', async () => {
      mockUploadListByStage.mockResolvedValue({
        data: [mockRecords[0]],
        nextToken: null,
      });

      const result = await service.getUploadHistory({
        stage: 'geopos_local',
      });

      expect(mockUploadListByStage).toHaveBeenCalledWith(
        { stage: 'geopos_local' },
        expect.objectContaining({ sortDirection: 'DESC' }),
      );
      expect(result.items).toHaveLength(1);
    });

    it('filters by status using GSI', async () => {
      mockUploadListByStatus.mockResolvedValue({
        data: [mockRecords[1]],
        nextToken: null,
      });

      const result = await service.getUploadHistory({
        status: 'processing',
      });

      expect(mockUploadListByStatus).toHaveBeenCalledWith(
        { status: 'processing' },
        expect.objectContaining({ sortDirection: 'DESC' }),
      );
      expect(result.items).toHaveLength(1);
    });

    it('applies date range filtering', async () => {
      mockUploadList.mockResolvedValue({
        data: mockRecords,
        nextToken: null,
      });

      const result = await service.getUploadHistory({
        dateFrom: '2024-01-16T00:00:00.000Z',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].uploadId).toBe('upload-2');
    });

    it('returns nextToken for pagination', async () => {
      mockUploadList.mockResolvedValue({
        data: [mockRecords[0]],
        nextToken: 'next-page-token',
      });

      const result = await service.getUploadHistory(undefined, null, 1);

      expect(result.nextToken).toBe('next-page-token');
    });

    it('returns empty result on error', async () => {
      mockUploadList.mockRejectedValue(new Error('DynamoDB error'));

      const result = await service.getUploadHistory();

      expect(result.items).toHaveLength(0);
      expect(result.nextToken).toBeNull();
    });
  });
});

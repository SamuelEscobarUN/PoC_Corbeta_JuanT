/**
 * Preservation Property Tests — Flujo manual sin sesión inalterado
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * These tests encode the BASELINE behavior of the current (unfixed) code.
 * They MUST PASS on the unfixed code, confirming the behavior to preserve
 * after the bugfix is applied.
 *
 * Property 2: For any interaction that does NOT involve session selection
 * (uploading without session, manual file selection in dropdowns, creating
 * session on compare), the system SHALL produce exactly the same behavior
 * as the original code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

/* ------------------------------------------------------------------ */
/*  Mock Amplify modules                                              */
/* ------------------------------------------------------------------ */
const { mockUploadResult, mockUploadData } = vi.hoisted(() => {
  const mockUploadResult = vi.fn();
  const mockUploadData = vi.fn(() => ({ result: mockUploadResult() }));
  return { mockUploadResult, mockUploadData };
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
  remove: vi.fn(),
  downloadData: vi.fn(),
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

const MOCK_UUID = 'test-uuid-preservation';
vi.stubGlobal('crypto', { randomUUID: () => MOCK_UUID });

import { UploadService } from './upload';
import type { CascadeStage } from '../types/csv';
import type { UploadRecord } from '../types/upload';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const ALL_STAGES: CascadeStage[] = [
  'geopos_local',
  'geopos_central',
  'integracion',
  'ps_ck_intfc_vtapos',
];

function validCsvContent(stage: CascadeStage): string {
  const headers: Record<CascadeStage, string> = {
    geopos_local: 'invoice,total,barcode,description',
    geopos_central: 'invoice,total,barcode,description',
    integracion:
      'TICKET_KEY,INVOICE,TOTAL,SKU,CONCESION,CLI_DOC,TIPO_VENTA,INTEGRATION_TICKET_DATE',
    ps_ck_intfc_vtapos:
      'ACCOUNTING_DT,CK_TIPO_VENTA,INV_ITEM_ID,INVOICE,QTY_REQUESTED,TOTAL',
  };
  return `${headers[stage]}\nval1,val2,val3,val4,val5,val6,val7,val8`;
}

function createMockFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/csv' });
}

/** Arbitrary for CascadeStage */
const arbCascadeStage = fc.constantFrom<CascadeStage>(
  'geopos_local',
  'geopos_central',
  'integracion',
  'ps_ck_intfc_vtapos',
);

/** Arbitrary for a non-empty user ID */
const arbUserId = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);

/* ------------------------------------------------------------------ */
/*  Preservation Property Tests                                       */
/* ------------------------------------------------------------------ */

describe('Preservation — Flujo manual sin sesión inalterado', () => {
  let service: UploadService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadResult.mockResolvedValue({ path: 'uploads/test/raw.csv' });
    mockUploadCreate.mockResolvedValue({ data: { uploadId: MOCK_UUID } });
    mockUploadUpdate.mockResolvedValue({ data: { uploadId: MOCK_UUID } });
    service = Object.create(UploadService.prototype) as UploadService;
  });

  /* ---------------------------------------------------------------- */
  /*  Req 3.1: Upload sin sesión funciona correctamente               */
  /* ---------------------------------------------------------------- */

  /**
   * Property 2.1: uploadFile without sessionId produces UploadResult with status 'success'
   * and the DynamoDB record does NOT contain a sessionId field.
   *
   * **Validates: Requirements 3.1**
   *
   * For any valid CascadeStage and userId, calling uploadFile(file, stage, content, userId)
   * with 4 parameters returns a successful UploadResult and the create call does not
   * include sessionId.
   */
  it('uploadFile without sessionId returns success and record has no sessionId', async () => {
    await fc.assert(
      fc.asyncProperty(arbCascadeStage, arbUserId, async (stage, userId) => {
        vi.clearAllMocks();
        mockUploadResult.mockResolvedValue({ path: 'uploads/test/raw.csv' });
        mockUploadCreate.mockResolvedValue({ data: { uploadId: MOCK_UUID } });
        mockUploadUpdate.mockResolvedValue({ data: { uploadId: MOCK_UUID } });

        const content = validCsvContent(stage);
        const file = createMockFile(`${stage}.csv`, content);

        // Call with exactly 4 parameters (no sessionId)
        const result = await service.uploadFile(file, stage, content, userId);

        // Must return success
        expect(result.status).toBe('success');
        expect(result.uploadId).toBe(MOCK_UUID);
        expect(result.stage).toBe(stage);

        // The DynamoDB create call must NOT include sessionId
        expect(mockUploadCreate).toHaveBeenCalledTimes(1);
        const createArg = mockUploadCreate.mock.calls[0][0];
        expect(createArg).not.toHaveProperty('sessionId');
        expect(createArg.uploadedBy).toBe(userId);
        expect(createArg.stage).toBe(stage);
      }),
      { numRuns: 20 },
    );
  });

  /**
   * Unit test: uploadFile with 4 params returns all expected UploadResult fields.
   *
   * **Validates: Requirements 3.1**
   */
  it('uploadFile returns UploadResult with all expected fields', async () => {
    const stage: CascadeStage = 'geopos_local';
    const content = validCsvContent(stage);
    const file = createMockFile('test.csv', content);

    const result = await service.uploadFile(file, stage, content, 'user-abc');

    expect(result).toHaveProperty('uploadId');
    expect(result).toHaveProperty('s3Key');
    expect(result).toHaveProperty('stage');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('catalogEntryId');
    expect(result).toHaveProperty('timestamp');
    expect(result.status).toBe('success');
    expect(result.uploadId).toBe(MOCK_UUID);
    expect(result.s3Key).toContain('uploads/geopos_local/');
  });

  /* ---------------------------------------------------------------- */
  /*  Req 3.4: getUploadHistory retorna campos correctos              */
  /* ---------------------------------------------------------------- */

  /**
   * Property 2.2: getUploadHistory returns records with all existing fields
   * (uploadId, stage, fileName, fileSize, status, s3Key, uploadedBy, uploadedAt).
   *
   * **Validates: Requirements 3.4**
   *
   * For any set of upload records in DynamoDB, getUploadHistory maps them
   * to UploadRecord objects with all expected fields present and correctly typed.
   */
  it('getUploadHistory returns records with all expected fields', async () => {
    const mockRecords = ALL_STAGES.map((stage, idx) => ({
      uploadId: `upload-${idx}`,
      stage,
      fileName: `${stage}-file.csv`,
      fileSize: (idx + 1) * 1024,
      status: 'uploaded',
      s3Key: `uploads/${stage}/2024/01/15/upload-${idx}/raw.csv`,
      uploadedBy: `user-${idx}`,
      uploadedAt: `2024-01-${15 + idx}T10:00:00.000Z`,
      errorMessage: null,
    }));

    mockUploadList.mockResolvedValue({
      data: mockRecords,
      nextToken: null,
    });

    const result = await service.getUploadHistory();

    expect(result.items).toHaveLength(4);

    for (const record of result.items) {
      // All baseline fields must be present
      expect(record).toHaveProperty('uploadId');
      expect(record).toHaveProperty('stage');
      expect(record).toHaveProperty('fileName');
      expect(record).toHaveProperty('fileSize');
      expect(record).toHaveProperty('status');
      expect(record).toHaveProperty('s3Key');
      expect(record).toHaveProperty('uploadedBy');
      expect(record).toHaveProperty('uploadedAt');

      // Fields must have correct types
      expect(typeof record.uploadId).toBe('string');
      expect(typeof record.stage).toBe('string');
      expect(typeof record.fileName).toBe('string');
      expect(typeof record.fileSize).toBe('number');
      expect(typeof record.status).toBe('string');
      expect(typeof record.s3Key).toBe('string');
      expect(typeof record.uploadedBy).toBe('string');
      expect(typeof record.uploadedAt).toBe('string');
    }
  });

  /**
   * Property 2.3: getUploadHistory preserves field values from DynamoDB exactly.
   *
   * **Validates: Requirements 3.4**
   *
   * For any upload record stored in DynamoDB, getUploadHistory maps the values
   * without modification (identity mapping for all baseline fields).
   */
  it('getUploadHistory preserves field values from DynamoDB', async () => {
    await fc.assert(
      fc.asyncProperty(arbCascadeStage, arbUserId, async (stage, userId) => {
        vi.clearAllMocks();

        const mockRecord = {
          uploadId: `upload-${stage}`,
          stage,
          fileName: `${stage}-data.csv`,
          fileSize: 2048,
          status: 'uploaded',
          s3Key: `uploads/${stage}/2024/02/01/upload-${stage}/raw.csv`,
          uploadedBy: userId,
          uploadedAt: '2024-02-01T08:30:00.000Z',
          errorMessage: null,
        };

        mockUploadList.mockResolvedValue({
          data: [mockRecord],
          nextToken: null,
        });

        const result = await service.getUploadHistory();
        expect(result.items).toHaveLength(1);

        const record = result.items[0];
        expect(record.uploadId).toBe(mockRecord.uploadId);
        expect(record.stage).toBe(mockRecord.stage);
        expect(record.fileName).toBe(mockRecord.fileName);
        expect(record.fileSize).toBe(mockRecord.fileSize);
        expect(record.status).toBe(mockRecord.status);
        expect(record.s3Key).toBe(mockRecord.s3Key);
        expect(record.uploadedBy).toBe(mockRecord.uploadedBy);
        expect(record.uploadedAt).toBe(mockRecord.uploadedAt);
      }),
      { numRuns: 20 },
    );
  });

  /**
   * Unit test: getUploadHistory with stage filter uses GSI correctly.
   *
   * **Validates: Requirements 3.4**
   */
  it('getUploadHistory with stage filter works correctly', async () => {
    const mockRecord = {
      uploadId: 'upload-filtered',
      stage: 'integracion',
      fileName: 'integracion.csv',
      fileSize: 4096,
      status: 'uploaded',
      s3Key: 'uploads/integracion/2024/01/20/upload-filtered/raw.csv',
      uploadedBy: 'user-filter',
      uploadedAt: '2024-01-20T14:00:00.000Z',
      errorMessage: null,
    };

    mockUploadListByStage.mockResolvedValue({
      data: [mockRecord],
      nextToken: null,
    });

    const result = await service.getUploadHistory({ stage: 'integracion' });

    expect(mockUploadListByStage).toHaveBeenCalledWith(
      { stage: 'integracion' },
      expect.objectContaining({ sortDirection: 'DESC' }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].uploadId).toBe('upload-filtered');
    expect(result.items[0].stage).toBe('integracion');
  });

  /* ---------------------------------------------------------------- */
  /*  Req 3.1: uploadFile signature is exactly 4 parameters           */
  /* ---------------------------------------------------------------- */

  /**
   * Unit test: uploadFile accepts exactly 4 required parameters.
   *
   * **Validates: Requirements 3.1**
   *
   * The current uploadFile signature is (file, stage, content, uploadedBy).
   * This test confirms the method works with exactly 4 args.
   */
  it('uploadFile works with exactly 4 parameters', async () => {
    for (const stage of ALL_STAGES) {
      vi.clearAllMocks();
      mockUploadResult.mockResolvedValue({ path: 'uploads/test/raw.csv' });
      mockUploadCreate.mockResolvedValue({ data: { uploadId: MOCK_UUID } });
      mockUploadUpdate.mockResolvedValue({ data: { uploadId: MOCK_UUID } });

      const content = validCsvContent(stage);
      const file = createMockFile(`${stage}.csv`, content);

      const result = await service.uploadFile(file, stage, content, 'user-test');

      expect(result.status).toBe('success');
      expect(result.uploadId).toBe(MOCK_UUID);
    }
  });

  /* ---------------------------------------------------------------- */
  /*  Req 3.2/3.3: UploadRecord has all expected baseline fields      */
  /* ---------------------------------------------------------------- */

  /**
   * Unit test: UploadRecord from getUploadHistory has all fields needed
   * for manual dropdown selection in DiscrepanciesPage.
   *
   * **Validates: Requirements 3.2, 3.3**
   *
   * The dropdowns need uploadId, stage, fileName, and fileSize to display
   * options. The comparison flow needs s3Key, uploadedBy, and uploadedAt.
   */
  it('UploadRecord has all fields needed for manual dropdown selection', async () => {
    const mockRecords = [
      {
        uploadId: 'upload-dropdown-1',
        stage: 'geopos_local',
        fileName: 'geopos_local_jan.csv',
        fileSize: 1500,
        status: 'uploaded',
        s3Key: 'uploads/geopos_local/2024/01/10/upload-dropdown-1/raw.csv',
        uploadedBy: 'operator-1',
        uploadedAt: '2024-01-10T09:00:00.000Z',
        errorMessage: null,
      },
      {
        uploadId: 'upload-dropdown-2',
        stage: 'ps_ck_intfc_vtapos',
        fileName: 'ps_ck_feb.csv',
        fileSize: 3200,
        status: 'transformed',
        s3Key: 'uploads/ps_ck_intfc_vtapos/2024/02/05/upload-dropdown-2/raw.csv',
        uploadedBy: 'operator-2',
        uploadedAt: '2024-02-05T11:30:00.000Z',
        errorMessage: null,
      },
    ];

    mockUploadList.mockResolvedValue({
      data: mockRecords,
      nextToken: null,
    });

    const result = await service.getUploadHistory();

    for (const record of result.items) {
      // Fields needed for dropdown display
      expect(record.uploadId).toBeTruthy();
      expect(record.stage).toBeTruthy();
      expect(record.fileName).toBeTruthy();
      expect(typeof record.fileSize).toBe('number');

      // Fields needed for comparison flow
      expect(record.s3Key).toBeTruthy();
      expect(record.uploadedBy).toBeTruthy();
      expect(record.uploadedAt).toBeTruthy();

      // Stage must be a valid CascadeStage
      expect(ALL_STAGES).toContain(record.stage);
    }
  });

  /**
   * Unit test: errorMessage field is mapped correctly (undefined when null).
   *
   * **Validates: Requirements 3.4**
   */
  it('errorMessage is mapped as undefined when null in DynamoDB', async () => {
    mockUploadList.mockResolvedValue({
      data: [
        {
          uploadId: 'upload-err',
          stage: 'geopos_central',
          fileName: 'central.csv',
          fileSize: 512,
          status: 'error',
          s3Key: 'uploads/geopos_central/2024/01/01/upload-err/raw.csv',
          uploadedBy: 'user-err',
          uploadedAt: '2024-01-01T00:00:00.000Z',
          errorMessage: null,
        },
      ],
      nextToken: null,
    });

    const result = await service.getUploadHistory();
    expect(result.items[0].errorMessage).toBeUndefined();
  });
});

/**
 * Exploratory Bug Condition Property Test — Asociación de uploads a sesión y auto-selección
 *
 * **Validates: Requirements 1.1, 1.5, 2.1, 2.5**
 *
 * This test encodes the EXPECTED (correct) behavior:
 * - UploadService.uploadFile should accept an optional sessionId parameter
 * - When uploading with sessionId, the Upload record in DynamoDB should contain that sessionId
 * - SessionService should have a getSessionUploads(sessionId) method
 * - Querying uploads by session should return only uploads associated to that session
 *
 * CRITICAL: This test MUST FAIL on unfixed code — failure confirms the bug exists.
 * DO NOT fix the test or the code when it fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  mockUploadListBySessionAndStage,
  mockSessionGet,
} = vi.hoisted(() => ({
  mockUploadCreate: vi.fn(),
  mockUploadUpdate: vi.fn(),
  mockUploadList: vi.fn(),
  mockUploadListByStage: vi.fn(),
  mockUploadListByStatus: vi.fn(),
  mockUploadListBySessionAndStage: vi.fn(),
  mockSessionGet: vi.fn(),
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
        listUploadBySessionIdAndStage: mockUploadListBySessionAndStage,
      },
      Session: {
        get: mockSessionGet,
        create: vi.fn(),
        list: vi.fn().mockResolvedValue({ data: [], nextToken: null }),
        listSessionByStatusAndCreatedAt: vi.fn().mockResolvedValue({ data: [], nextToken: null }),
        update: vi.fn(),
      },
      Discrepancy: { list: vi.fn().mockResolvedValue({ data: [] }) },
      Finding: { list: vi.fn().mockResolvedValue({ data: [] }) },
      Correction: { list: vi.fn().mockResolvedValue({ data: [] }) },
    },
  }),
}));

const MOCK_UUID = 'test-uuid-bug-condition';
vi.stubGlobal('crypto', { randomUUID: () => MOCK_UUID });

import { UploadService } from './upload';
import { SessionService } from './session';
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

/* ------------------------------------------------------------------ */
/*  Bug Condition Property Test                                       */
/* ------------------------------------------------------------------ */

describe('Bug Condition — Asociación de uploads a sesión y auto-selección', () => {
  let uploadService: UploadService;
  let sessionService: SessionService;
  const TEST_SESSION_ID = 'session-abc-123';
  const TEST_USER = 'user-test';

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadResult.mockResolvedValue({ path: 'uploads/test/raw.csv' });
    mockUploadCreate.mockResolvedValue({ data: { uploadId: MOCK_UUID } });
    mockUploadUpdate.mockResolvedValue({ data: { uploadId: MOCK_UUID } });

    uploadService = Object.create(UploadService.prototype) as UploadService;
    sessionService = new SessionService();
  });

  /**
   * Property 1.1: uploadFile accepts an optional sessionId parameter
   *
   * **Validates: Requirements 2.1** — The system SHALL allow optionally associating
   * an upload to an existing work session by storing the sessionId in the Upload record.
   *
   * Expected: uploadFile(file, stage, content, uploadedBy, sessionId) should accept 5 args.
   * Bug condition: uploadFile only accepts 4 args (no sessionId parameter).
   */
  it('uploadFile should accept an optional sessionId parameter', async () => {
    const stage: CascadeStage = 'geopos_local';
    const content = validCsvContent(stage);
    const file = createMockFile('test.csv', content);

    // The method should accept sessionId as the 5th parameter without error
    const result = await uploadService.uploadFile(
      file,
      stage,
      content,
      TEST_USER,
      TEST_SESSION_ID,
    );

    expect(result.status).toBe('success');
  });

  /**
   * Property 1.2: When uploading with sessionId, the DynamoDB record contains that sessionId
   *
   * **Validates: Requirements 2.1, 2.5** — The system SHALL store the sessionId in the
   * Upload record in DynamoDB, enabling querying uploads by session.
   *
   * Expected: client.models.Upload.create() is called with sessionId in the record.
   * Bug condition: Upload.create() is called WITHOUT sessionId field.
   */
  it('Upload.create should include sessionId when provided', async () => {
    const stage: CascadeStage = 'integracion';
    const content = validCsvContent(stage);
    const file = createMockFile('integracion.csv', content);

    await uploadService.uploadFile(
      file,
      stage,
      content,
      TEST_USER,
      TEST_SESSION_ID,
    );

    // The DynamoDB create call should include sessionId
    expect(mockUploadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: TEST_SESSION_ID,
      }),
    );
  });

  /**
   * Property 1.3: SessionService has a getSessionUploads method
   *
   * **Validates: Requirements 2.2, 2.3** — The system SHALL provide a method to
   * retrieve uploads filtered by session, enabling auto-population of file dropdowns.
   *
   * Expected: sessionService.getSessionUploads is a function.
   * Bug condition: getSessionUploads does not exist on SessionService.
   */
  it('SessionService should have a getSessionUploads method', () => {
    expect(typeof sessionService.getSessionUploads).toBe('function');
  });

  /**
   * Property 1.4: getSessionUploads returns uploads filtered by session (one per CascadeStage)
   *
   * **Validates: Requirements 2.2, 2.3, 2.5** — When querying uploads by session,
   * only uploads associated to that session are returned, one per CascadeStage.
   *
   * Expected: getSessionUploads(sessionId) returns UploadRecord[] with only matching uploads.
   * Bug condition: Method does not exist, so cannot return filtered results.
   */
  it('getSessionUploads should return uploads filtered by sessionId', async () => {
    // Mock the GSI query to return uploads for this session
    const mockSessionUploads = ALL_STAGES.map((stage, idx) => ({
      uploadId: `upload-${idx}`,
      sessionId: TEST_SESSION_ID,
      stage,
      fileName: `${stage}.csv`,
      fileSize: 1024,
      status: 'uploaded',
      s3Key: `uploads/${stage}/2024/01/15/upload-${idx}/raw.csv`,
      uploadedBy: TEST_USER,
      uploadedAt: '2024-01-15T10:00:00.000Z',
      errorMessage: null,
    }));

    mockUploadListBySessionAndStage.mockResolvedValue({
      data: mockSessionUploads,
      nextToken: null,
    });

    const uploads: UploadRecord[] = await sessionService.getSessionUploads(TEST_SESSION_ID);

    // Should return exactly 4 uploads (one per stage)
    expect(uploads).toHaveLength(4);

    // Each upload should belong to the requested session
    for (const upload of uploads) {
      expect(upload.sessionId).toBe(TEST_SESSION_ID);
    }

    // Each CascadeStage should be represented exactly once
    const stages = uploads.map((u) => u.stage);
    for (const stage of ALL_STAGES) {
      expect(stages).toContain(stage);
    }
  });

  /**
   * Property 1.5: UploadRecord type includes sessionId field
   *
   * **Validates: Requirements 2.5** — The UploadRecord type should include
   * an optional sessionId field so the frontend can read the association.
   *
   * Expected: An UploadRecord with sessionId is type-valid.
   * Bug condition: UploadRecord does not have sessionId field.
   */
  it('UploadRecord should support sessionId field', async () => {
    // Mock getUploadHistory to return a record with sessionId
    mockUploadList.mockResolvedValue({
      data: [
        {
          uploadId: 'upload-with-session',
          sessionId: TEST_SESSION_ID,
          stage: 'geopos_local',
          fileName: 'test.csv',
          fileSize: 1024,
          status: 'uploaded',
          s3Key: 'uploads/geopos_local/2024/01/15/upload-1/raw.csv',
          uploadedBy: TEST_USER,
          uploadedAt: '2024-01-15T10:00:00.000Z',
          errorMessage: null,
        },
      ],
      nextToken: null,
    });

    const result = await uploadService.getUploadHistory();
    const record = result.items[0];

    // The record should have sessionId mapped from DynamoDB
    expect(record.sessionId).toBe(TEST_SESSION_ID);
  });
});

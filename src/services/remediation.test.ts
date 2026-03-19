/**
 * Tests unitarios para RemediationService.
 *
 * Se mockean las llamadas a Amplify Data (DynamoDB) y crypto.randomUUID
 * para que los tests corran sin servicios AWS reales.
 *
 * Verificamos:
 *  - proposeCorrection crea corrección con estado pending_approval
 *  - proposeCorrection lanza error cuando DynamoDB falla
 *  - approveCorrection cambia estado a approved
 *  - approveCorrection lanza error si la corrección no existe
 *  - approveCorrection lanza error si la corrección no está pendiente
 *  - rejectCorrection cambia estado a rejected con motivo
 *  - rejectCorrection lanza error si el motivo está vacío
 *  - rejectCorrection lanza error si la corrección no existe
 *  - rejectCorrection notifica al operador vía SNS
 *  - getCorrections retorna correcciones paginadas
 *  - getCorrections filtra por estado usando GSI
 *  - getCorrections retorna vacío cuando DynamoDB falla
 *  - getCorrection retorna corrección por ID
 *  - getCorrection retorna null cuando no existe
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks de Amplify antes de importar el servicio                    */
/* ------------------------------------------------------------------ */
const {
  mockCorrectionCreate,
  mockCorrectionUpdate,
  mockCorrectionGet,
  mockCorrectionList,
  mockCorrectionListByStatus,
} = vi.hoisted(() => ({
  mockCorrectionCreate: vi.fn(),
  mockCorrectionUpdate: vi.fn(),
  mockCorrectionGet: vi.fn(),
  mockCorrectionList: vi.fn(),
  mockCorrectionListByStatus: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Correction: {
        create: mockCorrectionCreate,
        update: mockCorrectionUpdate,
        get: mockCorrectionGet,
        list: mockCorrectionList,
        listCorrectionByStatusAndProposedAt: mockCorrectionListByStatus,
      },
    },
  }),
}));

/* Mock de crypto.randomUUID para tests determinísticos */
let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
});

import { RemediationService } from './remediation';
import type { ProposeCorrectionInput } from '../types/remediation';

/* ------------------------------------------------------------------ */
/*  Helpers para construir datos de prueba                            */
/* ------------------------------------------------------------------ */

/** Input de corrección de prueba con valores por defecto. */
function makeProposalInput(overrides?: Partial<ProposeCorrectionInput>): ProposeCorrectionInput {
  return {
    discrepancyId: 'disc-001',
    findingId: 'finding-001',
    invoice: 'INV-001',
    originStage: 'geopos_local',
    correctedValues: { total: 1000 },
    proposedBy: 'operator@test.com',
    ...overrides,
  };
}

/** Registro DynamoDB simulado de una corrección pendiente. */
function makeDynamoCorrection(overrides?: Record<string, unknown>) {
  return {
    correctionId: 'corr-001',
    discrepancyId: 'disc-001',
    findingId: 'finding-001',
    invoice: 'INV-001',
    item: undefined,
    originStage: 'geopos_local',
    correctedValues: JSON.stringify({ total: 1000 }),
    status: 'pending_approval',
    proposedBy: 'operator@test.com',
    proposedAt: '2024-01-15T10:00:00.000Z',
    reviewedBy: undefined,
    reviewedAt: undefined,
    rejectionReason: undefined,
    xmlS3Key: undefined,
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('RemediationService', () => {
  let service: RemediationService;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    mockCorrectionCreate.mockResolvedValue({ data: {} });
    mockCorrectionUpdate.mockResolvedValue({ data: {} });
    mockCorrectionGet.mockResolvedValue({ data: null });
    mockCorrectionList.mockResolvedValue({ data: [] });
    mockCorrectionListByStatus.mockResolvedValue({ data: [] });
    service = new RemediationService();
  });

  /* ---- proposeCorrection ----------------------------------------- */

  describe('proposeCorrection', () => {
    it('crea corrección con estado pending_approval', async () => {
      const input = makeProposalInput();

      const result = await service.proposeCorrection(input);

      expect(result.correctionId).toBe('test-uuid-1');
      expect(result.status).toBe('pending_approval');
      expect(result.discrepancyId).toBe('disc-001');
      expect(result.findingId).toBe('finding-001');
      expect(result.invoice).toBe('INV-001');
      expect(result.originStage).toBe('geopos_local');
      expect(result.correctedValues).toEqual({ total: 1000 });
      expect(result.proposedBy).toBe('operator@test.com');
      expect(result.createdAt).toBeTruthy();
      expect(result.updatedAt).toBeTruthy();
    });

    it('persiste en DynamoDB con campos correctos', async () => {
      const input = makeProposalInput({ item: 'ITEM-A' });

      await service.proposeCorrection(input);

      expect(mockCorrectionCreate).toHaveBeenCalledTimes(1);
      const createArg = mockCorrectionCreate.mock.calls[0][0];
      expect(createArg.correctionId).toBe('test-uuid-1');
      expect(createArg.status).toBe('pending_approval');
      expect(createArg.correctedValues).toBe(JSON.stringify({ total: 1000 }));
      expect(createArg.item).toBe('ITEM-A');
    });

    it('lanza error cuando DynamoDB falla', async () => {
      mockCorrectionCreate.mockRejectedValue(new Error('DynamoDB error'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.proposeCorrection(makeProposalInput())).rejects.toThrow(
        'DynamoDB error',
      );
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  /* ---- approveCorrection ----------------------------------------- */

  describe('approveCorrection', () => {
    it('cambia estado a approved', async () => {
      mockCorrectionGet.mockResolvedValue({ data: makeDynamoCorrection() });

      const result = await service.approveCorrection('corr-001', 'admin@test.com');

      expect(result.status).toBe('approved');
      expect(result.approvedBy).toBe('admin@test.com');
      expect(result.reviewedAt).toBeTruthy();
    });

    it('actualiza DynamoDB con estado approved', async () => {
      mockCorrectionGet.mockResolvedValue({ data: makeDynamoCorrection() });

      await service.approveCorrection('corr-001', 'admin@test.com');

      expect(mockCorrectionUpdate).toHaveBeenCalledTimes(1);
      const updateArg = mockCorrectionUpdate.mock.calls[0][0];
      expect(updateArg.correctionId).toBe('corr-001');
      expect(updateArg.status).toBe('approved');
      expect(updateArg.reviewedBy).toBe('admin@test.com');
    });

    it('lanza error si la corrección no existe', async () => {
      mockCorrectionGet.mockResolvedValue({ data: null });

      await expect(
        service.approveCorrection('corr-999', 'admin@test.com'),
      ).rejects.toThrow('no encontrada');
    });

    it('lanza error si la corrección no está pendiente', async () => {
      mockCorrectionGet.mockResolvedValue({
        data: makeDynamoCorrection({ status: 'rejected' }),
      });

      await expect(
        service.approveCorrection('corr-001', 'admin@test.com'),
      ).rejects.toThrow('No se puede aprobar');
    });

    it('lanza error cuando DynamoDB update falla', async () => {
      mockCorrectionGet.mockResolvedValue({ data: makeDynamoCorrection() });
      mockCorrectionUpdate.mockRejectedValue(new Error('DynamoDB update error'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        service.approveCorrection('corr-001', 'admin@test.com'),
      ).rejects.toThrow('DynamoDB update error');
      errorSpy.mockRestore();
    });
  });

  /* ---- rejectCorrection ------------------------------------------ */

  describe('rejectCorrection', () => {
    it('cambia estado a rejected con motivo', async () => {
      mockCorrectionGet.mockResolvedValue({ data: makeDynamoCorrection() });
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const result = await service.rejectCorrection(
        'corr-001',
        'admin@test.com',
        'Datos incorrectos',
      );

      expect(result.status).toBe('rejected');
      expect(result.rejectedBy).toBe('admin@test.com');
      expect(result.rejectionReason).toBe('Datos incorrectos');
      expect(result.reviewedAt).toBeTruthy();
      infoSpy.mockRestore();
    });

    it('actualiza DynamoDB con estado rejected y motivo', async () => {
      mockCorrectionGet.mockResolvedValue({ data: makeDynamoCorrection() });
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      await service.rejectCorrection('corr-001', 'admin@test.com', 'Motivo de rechazo');

      expect(mockCorrectionUpdate).toHaveBeenCalledTimes(1);
      const updateArg = mockCorrectionUpdate.mock.calls[0][0];
      expect(updateArg.correctionId).toBe('corr-001');
      expect(updateArg.status).toBe('rejected');
      expect(updateArg.rejectionReason).toBe('Motivo de rechazo');
      expect(updateArg.reviewedBy).toBe('admin@test.com');
      infoSpy.mockRestore();
    });

    it('notifica al operador vía SNS/SES', async () => {
      mockCorrectionGet.mockResolvedValue({ data: makeDynamoCorrection() });
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      await service.rejectCorrection('corr-001', 'admin@test.com', 'Datos incorrectos');

      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Notificación de rechazo'),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('operator@test.com'),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Datos incorrectos'),
      );
      infoSpy.mockRestore();
    });

    it('lanza error si el motivo está vacío', async () => {
      await expect(
        service.rejectCorrection('corr-001', 'admin@test.com', ''),
      ).rejects.toThrow('motivo de rechazo es obligatorio');
    });

    it('lanza error si el motivo es solo espacios', async () => {
      await expect(
        service.rejectCorrection('corr-001', 'admin@test.com', '   '),
      ).rejects.toThrow('motivo de rechazo es obligatorio');
    });

    it('lanza error si la corrección no existe', async () => {
      mockCorrectionGet.mockResolvedValue({ data: null });

      await expect(
        service.rejectCorrection('corr-999', 'admin@test.com', 'Motivo'),
      ).rejects.toThrow('no encontrada');
    });

    it('lanza error si la corrección no está pendiente', async () => {
      mockCorrectionGet.mockResolvedValue({
        data: makeDynamoCorrection({ status: 'approved' }),
      });

      await expect(
        service.rejectCorrection('corr-001', 'admin@test.com', 'Motivo'),
      ).rejects.toThrow('No se puede rechazar');
    });
  });

  /* ---- getCorrections -------------------------------------------- */

  describe('getCorrections', () => {
    it('retorna correcciones paginadas sin filtro', async () => {
      mockCorrectionList.mockResolvedValue({
        data: [makeDynamoCorrection(), makeDynamoCorrection({ correctionId: 'corr-002' })],
      });

      const result = await service.getCorrections();

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(mockCorrectionList).toHaveBeenCalledWith({ limit: 20 });
    });

    it('filtra por estado usando GSI status-index', async () => {
      mockCorrectionListByStatus.mockResolvedValue({
        data: [makeDynamoCorrection()],
      });

      const result = await service.getCorrections({ status: 'pending_approval' });

      expect(result.items).toHaveLength(1);
      expect(mockCorrectionListByStatus).toHaveBeenCalledWith(
        { status: 'pending_approval' },
        { limit: 20, sortDirection: 'DESC' },
      );
    });

    it('respeta pageSize personalizado', async () => {
      mockCorrectionList.mockResolvedValue({ data: [] });

      await service.getCorrections({ pageSize: 5 });

      expect(mockCorrectionList).toHaveBeenCalledWith({ limit: 5 });
    });

    it('retorna vacío cuando DynamoDB falla', async () => {
      mockCorrectionList.mockRejectedValue(new Error('DynamoDB error'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.getCorrections();

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('parsea correctedValues JSON correctamente', async () => {
      mockCorrectionList.mockResolvedValue({
        data: [makeDynamoCorrection({ correctedValues: JSON.stringify({ total: 500, sku: 'ABC' }) })],
      });

      const result = await service.getCorrections();

      expect(result.items[0].correctedValues).toEqual({ total: 500, sku: 'ABC' });
    });
  });

  /* ---- getCorrection --------------------------------------------- */

  describe('getCorrection', () => {
    it('retorna corrección por ID', async () => {
      mockCorrectionGet.mockResolvedValue({ data: makeDynamoCorrection() });

      const result = await service.getCorrection('corr-001');

      expect(result).not.toBeNull();
      expect(result!.correctionId).toBe('corr-001');
      expect(result!.status).toBe('pending_approval');
      expect(result!.correctedValues).toEqual({ total: 1000 });
    });

    it('retorna null cuando no existe', async () => {
      mockCorrectionGet.mockResolvedValue({ data: null });

      const result = await service.getCorrection('corr-999');

      expect(result).toBeNull();
    });

    it('retorna null cuando DynamoDB falla', async () => {
      mockCorrectionGet.mockRejectedValue(new Error('DynamoDB error'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.getCorrection('corr-001');

      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});

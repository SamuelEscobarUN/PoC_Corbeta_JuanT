/**
 * Tests unitarios para TransformationService.
 *
 * Se mockean las llamadas a Amplify Storage (S3) y Data (DynamoDB)
 * para ejecutar sin servicios reales de AWS. Se verifica:
 *  - Despacho correcto al transformador según la etapa
 *  - Almacenamiento del resultado normalizado en S3
 *  - Actualización del estado a 'transformed' en DynamoDB
 *  - Manejo de todas las etapas de la cascada
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks de Amplify (se definen antes de importar el servicio)       */
/* ------------------------------------------------------------------ */
const { mockUploadData, mockUploadResult } = vi.hoisted(() => {
  const mockUploadResult = vi.fn();
  const mockUploadData = vi.fn(() => ({ result: mockUploadResult() }));
  return { mockUploadData, mockUploadResult };
});

const { mockUploadUpdate } = vi.hoisted(() => ({
  mockUploadUpdate: vi.fn(),
}));

vi.mock('aws-amplify/storage', () => ({
  uploadData: mockUploadData,
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Upload: {
        update: mockUploadUpdate,
      },
    },
  }),
}));

import { TransformationService } from './index';
import type { CascadeStage } from '../../types/csv';
import type {
  GeoposRawRecord,
  IntegracionRawRecord,
  PsCkRawRecord,
} from './types';

/* ------------------------------------------------------------------ */
/*  Datos de prueba                                                    */
/* ------------------------------------------------------------------ */

const UPLOAD_ID = 'test-upload-001';

const geoposRecords: GeoposRawRecord[] = [
  { invoice: 'INV-001', total: 100, barcode: 'BC-1', description: 'Item A' },
  { invoice: 'INV-001', total: 100, barcode: 'BC-2', description: 'Item B' },
  { invoice: 'INV-002', total: 250, barcode: 'BC-3', description: 'Item C' },
];

const integracionRecords: IntegracionRawRecord[] = [
  {
    TICKET_KEY: 'TK-1',
    INVOICE: 'INV-100',
    TOTAL: 50,
    SKU: 'SKU-A',
    CONCESION: 'C1',
    CLI_DOC: 'DOC1',
    TIPO_VENTA: 'TV1',
    INTEGRATION_TICKET_DATE: '2024-01-15',
  },
  {
    TICKET_KEY: 'TK-2',
    INVOICE: 'INV-100',
    TOTAL: 75,
    SKU: 'SKU-B',
    CONCESION: 'C1',
    CLI_DOC: 'DOC1',
    TIPO_VENTA: 'TV1',
    INTEGRATION_TICKET_DATE: '2024-01-15',
  },
];

const psCkRecords: PsCkRawRecord[] = [
  {
    ACCOUNTING_DT: '2024-01-15',
    CK_TIPO_VENTA: 'TV1',
    INV_ITEM_ID: 'ITEM-X',
    INVOICE: 'INV-200',
    QTY_REQUESTED: 2,
    TOTAL: 30,
  },
  {
    ACCOUNTING_DT: '2024-01-15',
    CK_TIPO_VENTA: 'TV1',
    INV_ITEM_ID: 'ITEM-Y',
    INVOICE: 'INV-200',
    QTY_REQUESTED: 1,
    TOTAL: 45,
  },
];

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('TransformationService', () => {
  let service: TransformationService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadResult.mockResolvedValue({ path: 'normalized/test.json' });
    mockUploadUpdate.mockResolvedValue({ data: { uploadId: UPLOAD_ID } });
    // Crear instancia fresca para cada test
    service = Object.create(
      TransformationService.prototype,
    ) as TransformationService;
  });

  /* ---- Despacho por etapa ---------------------------------------- */

  describe('despacho por etapa', () => {
    it('transforma geopos_local correctamente', async () => {
      const result = await service.transformUpload(
        UPLOAD_ID,
        'geopos_local',
        geoposRecords,
      );

      expect(result.stage).toBe('geopos_local');
      expect(result.uploadId).toBe(UPLOAD_ID);
      expect(result.invoices).toHaveLength(2);
      // Geopos: total = valor de cualquier fila, NO suma
      const inv1 = result.invoices.find((i) => i.invoice === 'INV-001');
      expect(inv1?.totalFactura).toBe(100);
      expect(inv1?.items).toHaveLength(2);
    });

    it('transforma geopos_central correctamente', async () => {
      const result = await service.transformUpload(
        UPLOAD_ID,
        'geopos_central',
        geoposRecords,
      );

      expect(result.stage).toBe('geopos_central');
      expect(result.uploadId).toBe(UPLOAD_ID);
      expect(result.invoices).toHaveLength(2);
    });

    it('transforma integracion correctamente', async () => {
      const result = await service.transformUpload(
        UPLOAD_ID,
        'integracion',
        integracionRecords,
      );

      expect(result.stage).toBe('integracion');
      expect(result.uploadId).toBe(UPLOAD_ID);
      expect(result.invoices).toHaveLength(1);
      // Integración: total = SUM de los totales individuales
      expect(result.invoices[0].totalFactura).toBe(125); // 50 + 75
      expect(result.invoices[0].items).toHaveLength(2);
    });

    it('transforma ps_ck_intfc_vtapos correctamente', async () => {
      const result = await service.transformUpload(
        UPLOAD_ID,
        'ps_ck_intfc_vtapos',
        psCkRecords,
      );

      expect(result.stage).toBe('ps_ck_intfc_vtapos');
      expect(result.uploadId).toBe(UPLOAD_ID);
      expect(result.invoices).toHaveLength(1);
      // PS_CK: total = SUM de los totales individuales
      expect(result.invoices[0].totalFactura).toBe(75); // 30 + 45
      expect(result.invoices[0].items).toHaveLength(2);
    });
  });

  /* ---- Almacenamiento en S3 -------------------------------------- */

  describe('almacenamiento en S3', () => {
    it('sube el resultado normalizado a la ruta correcta en S3', async () => {
      await service.transformUpload(UPLOAD_ID, 'geopos_local', geoposRecords);

      expect(mockUploadData).toHaveBeenCalledWith(
        expect.objectContaining({
          path: `normalized/geopos_local/${UPLOAD_ID}/normalized.json`,
          options: { contentType: 'application/json' },
        }),
      );
    });

    it('serializa los datos transformados como JSON en S3', async () => {
      await service.transformUpload(UPLOAD_ID, 'integracion', integracionRecords);

      const call = mockUploadData.mock.calls[0] as unknown[];
      const arg = call[0] as { data: string };
      const parsed = JSON.parse(arg.data);
      expect(parsed.stage).toBe('integracion');
      expect(parsed.uploadId).toBe(UPLOAD_ID);
      expect(parsed.invoices).toBeDefined();
      expect(parsed.processedAt).toBeDefined();
    });

    it('usa la ruta correcta para cada etapa', async () => {
      const stages: CascadeStage[] = [
        'geopos_local',
        'geopos_central',
        'integracion',
        'ps_ck_intfc_vtapos',
      ];

      for (const stage of stages) {
        vi.clearAllMocks();
        mockUploadResult.mockResolvedValue({ path: 'test.json' });
        mockUploadUpdate.mockResolvedValue({ data: {} });

        const rawData =
          stage === 'integracion'
            ? integracionRecords
            : stage === 'ps_ck_intfc_vtapos'
              ? psCkRecords
              : geoposRecords;

        await service.transformUpload(UPLOAD_ID, stage, rawData);

        expect(mockUploadData).toHaveBeenCalledWith(
          expect.objectContaining({
            path: `normalized/${stage}/${UPLOAD_ID}/normalized.json`,
          }),
        );
      }
    });
  });

  /* ---- Actualización de estado en DynamoDB ----------------------- */

  describe('actualización de estado en DynamoDB', () => {
    it('actualiza el estado del upload a transformed', async () => {
      await service.transformUpload(UPLOAD_ID, 'geopos_local', geoposRecords);

      expect(mockUploadUpdate).toHaveBeenCalledWith({
        uploadId: UPLOAD_ID,
        status: 'transformed',
      });
    });

    it('actualiza DynamoDB después de subir a S3', async () => {
      const callOrder: string[] = [];
      mockUploadResult.mockImplementation(() => {
        callOrder.push('s3');
        return Promise.resolve({ path: 'test.json' });
      });
      mockUploadUpdate.mockImplementation(() => {
        callOrder.push('dynamo');
        return Promise.resolve({ data: {} });
      });

      await service.transformUpload(UPLOAD_ID, 'integracion', integracionRecords);

      expect(callOrder).toEqual(['s3', 'dynamo']);
    });
  });

  /* ---- Valor de retorno ------------------------------------------ */

  describe('valor de retorno', () => {
    it('retorna los datos transformados con processedAt', async () => {
      const result = await service.transformUpload(
        UPLOAD_ID,
        'ps_ck_intfc_vtapos',
        psCkRecords,
      );

      expect(result.stage).toBe('ps_ck_intfc_vtapos');
      expect(result.uploadId).toBe(UPLOAD_ID);
      expect(result.processedAt).toBeTruthy();
      expect(new Date(result.processedAt).getTime()).not.toBeNaN();
    });
  });
});

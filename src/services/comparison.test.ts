/**
 * Tests unitarios para ComparisonService.
 *
 * Se mockean las llamadas a Amplify Data (DynamoDB) y crypto.randomUUID
 * para que los tests corran sin servicios AWS reales.
 *
 * Verificamos:
 *  - Detección de missing_invoice (factura en source ausente en target)
 *  - Detección de total_difference (totalFactura diferente)
 *  - Detección de item_count_difference (itemCount diferente)
 *  - Detección de missing_item (ítem en source ausente en target)
 *  - Sin discrepancias cuando los datos son idénticos
 *  - Persistencia de discrepancias en DynamoDB
 *  - Consulta por factura usando GSI invoice-index
 *  - Resumen de conteos por tipo
 *  - Severidad basada en porcentaje de desviación
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks de Amplify antes de importar el servicio                    */
/* ------------------------------------------------------------------ */
const { mockDiscrepancyCreate, mockDiscrepancyList } = vi.hoisted(() => ({
  mockDiscrepancyCreate: vi.fn(),
  mockDiscrepancyList: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Discrepancy: {
        create: mockDiscrepancyCreate,
        listDiscrepancyByInvoiceAndDetectedAt: mockDiscrepancyList,
      },
    },
  }),
}));

/* Mock de crypto.randomUUID para tests determinísticos */
let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
});

import { ComparisonService } from './comparison';
import type { TransformedData, TransformedInvoice } from './transform/types';
import type { CascadeStage } from '../types/csv';

/* ------------------------------------------------------------------ */
/*  Helpers para construir datos de prueba                            */
/* ------------------------------------------------------------------ */

/** Crear una factura transformada con valores por defecto. */
function makeInvoice(overrides?: Partial<TransformedInvoice>): TransformedInvoice {
  return {
    invoice: 'INV-001',
    totalFactura: 1000,
    items: [
      { itemId: 'ITEM-A', description: 'Producto A', value: 500 },
      { itemId: 'ITEM-B', description: 'Producto B', value: 500 },
    ],
    itemCount: 2,
    ...overrides,
  };
}

/** Crear datos transformados para una etapa. */
function makeTransformedData(
  stage: CascadeStage,
  invoices: TransformedInvoice[],
): TransformedData {
  return {
    stage,
    uploadId: `upload-${stage}`,
    invoices,
    processedAt: '2024-01-15T10:00:00.000Z',
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('ComparisonService', () => {
  let service: ComparisonService;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    mockDiscrepancyCreate.mockResolvedValue({ data: {} });
    mockDiscrepancyList.mockResolvedValue({ data: [] });
    service = ComparisonService.createForTesting();
  });

  /* ---- Detección de discrepancias -------------------------------- */

  describe('compareStages', () => {
    it('no detecta discrepancias cuando los datos son idénticos', () => {
      const invoices = [makeInvoice()];
      const source = makeTransformedData('geopos_local', invoices);
      const target = makeTransformedData('geopos_central', invoices);

      const result = service.compareStages(source, target);

      expect(result.discrepancies).toHaveLength(0);
      expect(result.summary.missingInvoices).toBe(0);
      expect(result.summary.totalDifferences).toBe(0);
      expect(result.summary.itemCountDifferences).toBe(0);
      expect(result.summary.missingItems).toBe(0);
      expect(result.totalInvoicesCompared).toBe(1);
    });

    it('detecta missing_invoice cuando factura está en source pero no en target', () => {
      const source = makeTransformedData('geopos_local', [
        makeInvoice({ invoice: 'INV-001' }),
        makeInvoice({ invoice: 'INV-002' }),
      ]);
      const target = makeTransformedData('geopos_central', [
        makeInvoice({ invoice: 'INV-001' }),
      ]);

      const result = service.compareStages(source, target);

      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0].type).toBe('missing_invoice');
      expect(result.discrepancies[0].invoice).toBe('INV-002');
      expect(result.discrepancies[0].sourceStage).toBe('geopos_local');
      expect(result.discrepancies[0].targetStage).toBe('geopos_central');
      expect(result.discrepancies[0].severity).toBe('high');
      expect(result.summary.missingInvoices).toBe(1);
      expect(result.totalInvoicesCompared).toBe(2);
    });

    it('detecta total_difference cuando totalFactura difiere', () => {
      const source = makeTransformedData('geopos_central', [
        makeInvoice({ invoice: 'INV-001', totalFactura: 1000 }),
      ]);
      const target = makeTransformedData('integracion', [
        makeInvoice({ invoice: 'INV-001', totalFactura: 950 }),
      ]);

      const result = service.compareStages(source, target);

      const totalDiffs = result.discrepancies.filter(
        (d) => d.type === 'total_difference',
      );
      expect(totalDiffs).toHaveLength(1);
      expect(totalDiffs[0].details.expectedValue).toBe('1000');
      expect(totalDiffs[0].details.actualValue).toBe('950');
      expect(result.summary.totalDifferences).toBe(1);
    });

    it('detecta item_count_difference cuando itemCount difiere', () => {
      const source = makeTransformedData('integracion', [
        makeInvoice({
          invoice: 'INV-001',
          totalFactura: 1000,
          itemCount: 3,
          items: [
            { itemId: 'A', value: 300 },
            { itemId: 'B', value: 300 },
            { itemId: 'C', value: 400 },
          ],
        }),
      ]);
      const target = makeTransformedData('ps_ck_intfc_vtapos', [
        makeInvoice({
          invoice: 'INV-001',
          totalFactura: 1000,
          itemCount: 2,
          items: [
            { itemId: 'A', value: 300 },
            { itemId: 'B', value: 700 },
          ],
        }),
      ]);

      const result = service.compareStages(source, target);

      const countDiffs = result.discrepancies.filter(
        (d) => d.type === 'item_count_difference',
      );
      expect(countDiffs).toHaveLength(1);
      expect(countDiffs[0].details.expectedValue).toBe('3');
      expect(countDiffs[0].details.actualValue).toBe('2');
      expect(result.summary.itemCountDifferences).toBe(1);
    });

    it('detecta missing_item cuando ítem está en source pero no en target', () => {
      const source = makeTransformedData('geopos_local', [
        makeInvoice({
          invoice: 'INV-001',
          items: [
            { itemId: 'ITEM-A', value: 500 },
            { itemId: 'ITEM-B', value: 300 },
            { itemId: 'ITEM-C', value: 200 },
          ],
          itemCount: 3,
        }),
      ]);
      const target = makeTransformedData('geopos_central', [
        makeInvoice({
          invoice: 'INV-001',
          items: [
            { itemId: 'ITEM-A', value: 500 },
            { itemId: 'ITEM-B', value: 300 },
          ],
          itemCount: 2,
        }),
      ]);

      const result = service.compareStages(source, target);

      const missingItems = result.discrepancies.filter(
        (d) => d.type === 'missing_item',
      );
      expect(missingItems).toHaveLength(1);
      expect(missingItems[0].details.itemId).toBe('ITEM-C');
      expect(missingItems[0].severity).toBe('high');
      expect(result.summary.missingItems).toBe(1);
    });

    it('detecta múltiples tipos de discrepancia en una misma factura', () => {
      const source = makeTransformedData('geopos_central', [
        makeInvoice({
          invoice: 'INV-001',
          totalFactura: 1000,
          itemCount: 3,
          items: [
            { itemId: 'A', value: 300 },
            { itemId: 'B', value: 300 },
            { itemId: 'C', value: 400 },
          ],
        }),
      ]);
      const target = makeTransformedData('integracion', [
        makeInvoice({
          invoice: 'INV-001',
          totalFactura: 800,
          itemCount: 2,
          items: [
            { itemId: 'A', value: 300 },
            { itemId: 'B', value: 500 },
          ],
        }),
      ]);

      const result = service.compareStages(source, target);

      const types = result.discrepancies.map((d) => d.type);
      expect(types).toContain('total_difference');
      expect(types).toContain('item_count_difference');
      expect(types).toContain('missing_item');
    });

    it('detecta múltiples facturas faltantes', () => {
      const source = makeTransformedData('geopos_local', [
        makeInvoice({ invoice: 'INV-001' }),
        makeInvoice({ invoice: 'INV-002' }),
        makeInvoice({ invoice: 'INV-003' }),
      ]);
      const target = makeTransformedData('geopos_central', [
        makeInvoice({ invoice: 'INV-001' }),
      ]);

      const result = service.compareStages(source, target);

      expect(result.summary.missingInvoices).toBe(2);
      expect(result.totalInvoicesCompared).toBe(3);
    });

    it('retorna etapas correctas en el resultado', () => {
      const source = makeTransformedData('geopos_local', []);
      const target = makeTransformedData('geopos_central', []);

      const result = service.compareStages(source, target);

      expect(result.sourceStage).toBe('geopos_local');
      expect(result.targetStage).toBe('geopos_central');
    });

    it('maneja source vacío sin errores', () => {
      const source = makeTransformedData('geopos_local', []);
      const target = makeTransformedData('geopos_central', [
        makeInvoice({ invoice: 'INV-001' }),
      ]);

      const result = service.compareStages(source, target);

      expect(result.discrepancies).toHaveLength(0);
      expect(result.totalInvoicesCompared).toBe(1);
    });

    it('maneja target vacío detectando todas las facturas como faltantes', () => {
      const source = makeTransformedData('geopos_local', [
        makeInvoice({ invoice: 'INV-001' }),
        makeInvoice({ invoice: 'INV-002' }),
      ]);
      const target = makeTransformedData('geopos_central', []);

      const result = service.compareStages(source, target);

      expect(result.summary.missingInvoices).toBe(2);
      expect(result.totalInvoicesCompared).toBe(2);
    });
  });

  /* ---- Severidad de total_difference ----------------------------- */

  describe('severidad de total_difference', () => {
    it('asigna critical cuando la desviación es mayor a 20%', () => {
      const source = makeTransformedData('geopos_local', [
        makeInvoice({ invoice: 'INV-001', totalFactura: 1000 }),
      ]);
      const target = makeTransformedData('geopos_central', [
        makeInvoice({ invoice: 'INV-001', totalFactura: 700 }),
      ]);

      const result = service.compareStages(source, target);
      const diff = result.discrepancies.find((d) => d.type === 'total_difference');

      expect(diff?.severity).toBe('critical');
    });

    it('asigna low cuando la desviación es menor a 5%', () => {
      const source = makeTransformedData('geopos_local', [
        makeInvoice({ invoice: 'INV-001', totalFactura: 1000 }),
      ]);
      const target = makeTransformedData('geopos_central', [
        makeInvoice({ invoice: 'INV-001', totalFactura: 980 }),
      ]);

      const result = service.compareStages(source, target);
      const diff = result.discrepancies.find((d) => d.type === 'total_difference');

      expect(diff?.severity).toBe('low');
    });
  });

  /* ---- Persistencia en DynamoDB ---------------------------------- */

  describe('saveDiscrepancies', () => {
    it('guarda cada discrepancia en DynamoDB con sessionId', async () => {
      const source = makeTransformedData('geopos_local', [
        makeInvoice({ invoice: 'INV-001' }),
        makeInvoice({ invoice: 'INV-002' }),
      ]);
      const target = makeTransformedData('geopos_central', [
        makeInvoice({ invoice: 'INV-001' }),
      ]);

      const result = service.compareStages(source, target);
      await service.saveDiscrepancies(result.discrepancies, 'session-123');

      expect(mockDiscrepancyCreate).toHaveBeenCalledTimes(1);
      expect(mockDiscrepancyCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-123',
          invoice: 'INV-002',
          type: 'missing_invoice',
        }),
      );
    });

    it('genera sessionId automático si no se proporciona', async () => {
      const source = makeTransformedData('geopos_local', [
        makeInvoice({ invoice: 'INV-001' }),
      ]);
      const target = makeTransformedData('geopos_central', []);

      const result = service.compareStages(source, target);
      await service.saveDiscrepancies(result.discrepancies);

      expect(mockDiscrepancyCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: expect.stringContaining('test-uuid-'),
        }),
      );
    });

    it('maneja errores de DynamoDB sin interrumpir la ejecución', async () => {
      mockDiscrepancyCreate.mockRejectedValue(new Error('DynamoDB error'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const source = makeTransformedData('geopos_local', [
        makeInvoice({ invoice: 'INV-001' }),
      ]);
      const target = makeTransformedData('geopos_central', []);

      const result = service.compareStages(source, target);

      // No debe lanzar excepción
      await service.saveDiscrepancies(result.discrepancies);

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  /* ---- Consulta por factura (GSI) -------------------------------- */

  describe('getDiscrepanciesByInvoice', () => {
    it('retorna discrepancias mapeadas desde DynamoDB', async () => {
      mockDiscrepancyList.mockResolvedValue({
        data: [
          {
            discrepancyId: 'disc-1',
            sourceStage: 'geopos_local',
            targetStage: 'geopos_central',
            invoice: 'INV-001',
            type: 'missing_item',
            details: JSON.stringify({
              itemId: 'ITEM-X',
              message: 'Ítem faltante',
            }),
            detectedAt: '2024-01-15T10:00:00.000Z',
          },
        ],
      });

      const discrepancies = await service.getDiscrepanciesByInvoice('INV-001');

      expect(discrepancies).toHaveLength(1);
      expect(discrepancies[0].discrepancyId).toBe('disc-1');
      expect(discrepancies[0].type).toBe('missing_item');
      expect(discrepancies[0].details.itemId).toBe('ITEM-X');
      expect(discrepancies[0].severity).toBe('high');
    });

    it('retorna arreglo vacío cuando no hay discrepancias', async () => {
      mockDiscrepancyList.mockResolvedValue({ data: [] });

      const discrepancies = await service.getDiscrepanciesByInvoice('INV-999');

      expect(discrepancies).toHaveLength(0);
    });

    it('retorna arreglo vacío cuando DynamoDB falla', async () => {
      mockDiscrepancyList.mockRejectedValue(new Error('DynamoDB error'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const discrepancies = await service.getDiscrepanciesByInvoice('INV-001');

      expect(discrepancies).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});

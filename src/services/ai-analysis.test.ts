/**
 * Tests unitarios para AIAnalysisService.
 *
 * Se mockean las llamadas a Amplify Data (DynamoDB) y crypto.randomUUID
 * para que los tests corran sin servicios AWS reales.
 * Se usa una subclase para controlar la respuesta de Bedrock.
 *
 * Verificamos:
 *  - analyzeDiscrepancy genera Finding con explicación, causa y recomendación
 *  - Genera ItemFindings para discrepancias de tipo missing_item
 *  - Genera ItemFindings para discrepancias de tipo item_count_difference
 *  - No genera ItemFindings para otros tipos de discrepancia
 *  - detectAnomalies detecta patrón de múltiples tipos por factura
 *  - detectAnomalies detecta alta concentración de un tipo
 *  - detectAnomalies detecta discrepancias críticas por etapa
 *  - detectAnomalies retorna vacío para lista vacía
 *  - saveFinding persiste en DynamoDB
 *  - saveFinding lanza error cuando DynamoDB falla
 *  - getFindings retorna hallazgos mapeados desde DynamoDB
 *  - getFindings retorna vacío cuando no hay datos
 *  - getFindings retorna vacío cuando DynamoDB falla
 *  - Reintentos con backoff exponencial para errores transitorios
 *  - No reintenta para errores no transitorios
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks de Amplify antes de importar el servicio                    */
/* ------------------------------------------------------------------ */
const { mockFindingCreate, mockFindingList } = vi.hoisted(() => ({
  mockFindingCreate: vi.fn(),
  mockFindingList: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Finding: {
        create: mockFindingCreate,
        list: mockFindingList,
      },
    },
  }),
}));

/* Mock de crypto.randomUUID para tests determinísticos */
let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
});

import { AIAnalysisService } from './ai-analysis';
import type { BedrockAnalysisResponse } from './ai-analysis';
import type { Discrepancy } from '../types/comparison';

/* ------------------------------------------------------------------ */
/*  Subclase para controlar respuestas de Bedrock en tests            */
/* ------------------------------------------------------------------ */

class TestableAIAnalysisService extends AIAnalysisService {
  public bedrockFn: (prompt: string) => Promise<BedrockAnalysisResponse>;

  private constructor(
    bedrockFn?: (prompt: string) => Promise<BedrockAnalysisResponse>,
    retryConfig?: { maxRetries?: number; baseDelayMs?: number; backoffFactor?: number },
  ) {
    // Acceder al constructor privado vía createForTesting no funciona aquí,
    // así que usamos un truco: llamamos al constructor padre
    super();
    this.bedrockFn =
      bedrockFn ??
      (async () => ({
        explanation: 'Explicación de prueba',
        probableCause: 'Causa de prueba',
        recommendation: 'Recomendación de prueba',
      }));
    if (retryConfig) {
      // Sobreescribir config de reintentos
      (this as unknown as { retryConfig: object }).retryConfig = {
        maxRetries: retryConfig.maxRetries ?? 3,
        baseDelayMs: retryConfig.baseDelayMs ?? 1,
        backoffFactor: retryConfig.backoffFactor ?? 2,
      };
    }
  }

  static createTestable(
    bedrockFn?: (prompt: string) => Promise<BedrockAnalysisResponse>,
    retryConfig?: { maxRetries?: number; baseDelayMs?: number; backoffFactor?: number },
  ): TestableAIAnalysisService {
    return new TestableAIAnalysisService(bedrockFn, retryConfig);
  }

  protected override async invokeBedrock(
    prompt: string,
  ): Promise<BedrockAnalysisResponse> {
    return this.bedrockFn(prompt);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers para construir datos de prueba                            */
/* ------------------------------------------------------------------ */

/** Crear una discrepancia de prueba con valores por defecto. */
function makeDiscrepancy(overrides?: Partial<Discrepancy>): Discrepancy {
  return {
    discrepancyId: 'disc-001',
    sourceStage: 'geopos_local',
    targetStage: 'geopos_central',
    invoice: 'INV-001',
    type: 'total_difference',
    details: {
      expectedValue: '1000',
      actualValue: '950',
      message: 'Total difiere para factura INV-001',
    },
    severity: 'medium',
    detectedAt: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('AIAnalysisService', () => {
  let service: TestableAIAnalysisService;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    mockFindingCreate.mockResolvedValue({ data: {} });
    mockFindingList.mockResolvedValue({ data: [] });
    service = TestableAIAnalysisService.createTestable(undefined, {
      maxRetries: 3,
      baseDelayMs: 1, // 1ms para tests rápidos
      backoffFactor: 2,
    });
  });

  /* ---- analyzeDiscrepancy ---------------------------------------- */

  describe('analyzeDiscrepancy', () => {
    it('genera Finding con explicación, causa probable y recomendación', async () => {
      const discrepancy = makeDiscrepancy();

      const finding = await service.analyzeDiscrepancy(discrepancy);

      expect(finding.findingId).toBe('test-uuid-1');
      expect(finding.discrepancyId).toBe('disc-001');
      expect(finding.explanation).toBe('Explicación de prueba');
      expect(finding.probableCause).toBe('Causa de prueba');
      expect(finding.recommendation).toBe('Recomendación de prueba');
      expect(finding.severity).toBe('medium');
      expect(finding.createdAt).toBeTruthy();
    });

    it('genera ItemFindings para discrepancias de tipo missing_item', async () => {
      const discrepancy = makeDiscrepancy({
        type: 'missing_item',
        severity: 'high',
        details: {
          itemId: 'ITEM-X',
          expectedValue: 'ITEM-X',
          message: 'Ítem ITEM-X faltante',
        },
      });

      const finding = await service.analyzeDiscrepancy(discrepancy);

      expect(finding.itemFindings).toHaveLength(1);
      expect(finding.itemFindings[0].itemId).toBe('ITEM-X');
      expect(finding.itemFindings[0].explanation).toContain('ITEM-X');
      expect(finding.itemFindings[0].suggestedAction).toBeTruthy();
    });

    it('genera ItemFindings para discrepancias de tipo item_count_difference', async () => {
      const discrepancy = makeDiscrepancy({
        type: 'item_count_difference',
        details: {
          expectedValue: '5',
          actualValue: '3',
          message: 'Cantidad de ítems difiere',
        },
      });

      const finding = await service.analyzeDiscrepancy(discrepancy);

      expect(finding.itemFindings).toHaveLength(1);
      expect(finding.itemFindings[0].itemId).toBe('aggregate');
      expect(finding.itemFindings[0].explanation).toContain('5');
      expect(finding.itemFindings[0].explanation).toContain('3');
    });

    it('no genera ItemFindings para total_difference', async () => {
      const discrepancy = makeDiscrepancy({ type: 'total_difference' });

      const finding = await service.analyzeDiscrepancy(discrepancy);

      expect(finding.itemFindings).toHaveLength(0);
    });

    it('no genera ItemFindings para missing_invoice', async () => {
      const discrepancy = makeDiscrepancy({ type: 'missing_invoice' });

      const finding = await service.analyzeDiscrepancy(discrepancy);

      expect(finding.itemFindings).toHaveLength(0);
    });

    it('incluye contexto adicional en el análisis', async () => {
      let capturedPrompt = '';
      service.bedrockFn = async (prompt: string) => {
        capturedPrompt = prompt;
        return {
          explanation: 'Con contexto',
          probableCause: 'Causa',
          recommendation: 'Rec',
        };
      };

      const discrepancy = makeDiscrepancy();
      await service.analyzeDiscrepancy(discrepancy, {
        previousDiscrepancies: 3,
        sourceFileName: 'datos.csv',
        additionalInfo: 'Carga nocturna',
      });

      expect(capturedPrompt).toContain('3');
      expect(capturedPrompt).toContain('datos.csv');
      expect(capturedPrompt).toContain('Carga nocturna');
    });
  });

  /* ---- detectAnomalies ------------------------------------------- */

  describe('detectAnomalies', () => {
    it('retorna vacío para lista vacía de discrepancias', async () => {
      const alerts = await service.detectAnomalies([]);

      expect(alerts).toHaveLength(0);
    });

    it('detecta patrón de múltiples tipos de discrepancia por factura', async () => {
      const discrepancies: Discrepancy[] = [
        makeDiscrepancy({ type: 'missing_item', invoice: 'INV-001' }),
        makeDiscrepancy({ type: 'total_difference', invoice: 'INV-001' }),
        makeDiscrepancy({ type: 'item_count_difference', invoice: 'INV-001' }),
      ];

      const alerts = await service.detectAnomalies(discrepancies);

      const multiTypeAlert = alerts.find(
        (a) => a.pattern === 'multiple_discrepancy_types',
      );
      expect(multiTypeAlert).toBeDefined();
      expect(multiTypeAlert!.severity).toBe('critical');
      expect(multiTypeAlert!.affectedInvoices).toContain('INV-001');
    });

    it('detecta alta concentración de un tipo de discrepancia', async () => {
      // 4 de 6 discrepancias son missing_invoice (>50%)
      const discrepancies: Discrepancy[] = [
        makeDiscrepancy({ type: 'missing_invoice', invoice: 'INV-001' }),
        makeDiscrepancy({ type: 'missing_invoice', invoice: 'INV-002' }),
        makeDiscrepancy({ type: 'missing_invoice', invoice: 'INV-003' }),
        makeDiscrepancy({ type: 'missing_invoice', invoice: 'INV-004' }),
        makeDiscrepancy({ type: 'total_difference', invoice: 'INV-005' }),
        makeDiscrepancy({ type: 'total_difference', invoice: 'INV-006' }),
      ];

      const alerts = await service.detectAnomalies(discrepancies);

      const concentrationAlert = alerts.find(
        (a) => a.pattern === 'high_concentration',
      );
      expect(concentrationAlert).toBeDefined();
      expect(concentrationAlert!.severity).toBe('high');
      expect(concentrationAlert!.affectedInvoices.length).toBeGreaterThanOrEqual(3);
    });

    it('detecta discrepancias críticas repetidas en la misma etapa', async () => {
      const discrepancies: Discrepancy[] = [
        makeDiscrepancy({
          severity: 'critical',
          invoice: 'INV-001',
          sourceStage: 'geopos_local',
          targetStage: 'geopos_central',
        }),
        makeDiscrepancy({
          severity: 'critical',
          invoice: 'INV-002',
          sourceStage: 'geopos_local',
          targetStage: 'geopos_central',
        }),
      ];

      const alerts = await service.detectAnomalies(discrepancies);

      const stageAlert = alerts.find(
        (a) => a.pattern === 'critical_stage_pattern',
      );
      expect(stageAlert).toBeDefined();
      expect(stageAlert!.severity).toBe('critical');
      expect(stageAlert!.affectedInvoices).toHaveLength(2);
    });

    it('no genera alertas cuando no hay patrones anómalos', async () => {
      const discrepancies: Discrepancy[] = [
        makeDiscrepancy({ type: 'total_difference', invoice: 'INV-001', severity: 'low' }),
        makeDiscrepancy({ type: 'missing_item', invoice: 'INV-002', severity: 'medium' }),
      ];

      const alerts = await service.detectAnomalies(discrepancies);

      // No debería haber alertas: solo 2 discrepancias, tipos distintos, no críticas
      expect(alerts).toHaveLength(0);
    });
  });

  /* ---- saveFinding ----------------------------------------------- */

  describe('saveFinding', () => {
    it('persiste hallazgo en DynamoDB con campos correctos', async () => {
      const finding = {
        findingId: 'finding-001',
        discrepancyId: 'disc-001',
        explanation: 'Explicación',
        probableCause: 'Causa',
        recommendation: 'Recomendación',
        severity: 'medium' as const,
        itemFindings: [
          { itemId: 'ITEM-A', explanation: 'Detalle', suggestedAction: 'Acción' },
        ],
        createdAt: '2024-01-15T10:00:00.000Z',
      };

      await service.saveFinding(finding);

      expect(mockFindingCreate).toHaveBeenCalledTimes(1);
      expect(mockFindingCreate).toHaveBeenCalledWith({
        discrepancyId: 'disc-001',
        findingId: 'finding-001',
        explanation: 'Explicación',
        probableCause: 'Causa',
        recommendation: 'Recomendación',
        severity: 'medium',
        itemDetails: JSON.stringify(finding.itemFindings),
        analyzedAt: '2024-01-15T10:00:00.000Z',
      });
    });

    it('lanza error cuando DynamoDB falla', async () => {
      mockFindingCreate.mockRejectedValue(new Error('DynamoDB error'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const finding = {
        findingId: 'finding-001',
        discrepancyId: 'disc-001',
        explanation: 'E',
        probableCause: 'C',
        recommendation: 'R',
        severity: 'low' as const,
        itemFindings: [],
        createdAt: '2024-01-15T10:00:00.000Z',
      };

      await expect(service.saveFinding(finding)).rejects.toThrow('DynamoDB error');
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  /* ---- getFindings ----------------------------------------------- */

  describe('getFindings', () => {
    it('retorna hallazgos mapeados desde DynamoDB', async () => {
      mockFindingList.mockResolvedValue({
        data: [
          {
            findingId: 'finding-001',
            discrepancyId: 'disc-001',
            explanation: 'Explicación DB',
            probableCause: 'Causa DB',
            recommendation: 'Recomendación DB',
            severity: 'high',
            itemDetails: JSON.stringify([
              { itemId: 'ITEM-A', explanation: 'Det', suggestedAction: 'Act' },
            ]),
            analyzedAt: '2024-01-15T10:00:00.000Z',
          },
        ],
      });

      const findings = await service.getFindings('disc-001');

      expect(findings).toHaveLength(1);
      expect(findings[0].findingId).toBe('finding-001');
      expect(findings[0].explanation).toBe('Explicación DB');
      expect(findings[0].itemFindings).toHaveLength(1);
      expect(findings[0].itemFindings[0].itemId).toBe('ITEM-A');
    });

    it('retorna vacío cuando no hay hallazgos', async () => {
      mockFindingList.mockResolvedValue({ data: [] });

      const findings = await service.getFindings('disc-999');

      expect(findings).toHaveLength(0);
    });

    it('retorna vacío cuando DynamoDB falla', async () => {
      mockFindingList.mockRejectedValue(new Error('DynamoDB error'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const findings = await service.getFindings('disc-001');

      expect(findings).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  /* ---- Reintentos con backoff exponencial ------------------------ */

  describe('reintentos con backoff exponencial', () => {
    it('reintenta en errores transitorios (timeout)', async () => {
      let callCount = 0;
      service.bedrockFn = async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Request timeout');
        }
        return {
          explanation: 'Éxito tras reintentos',
          probableCause: 'Causa',
          recommendation: 'Rec',
        };
      };

      const finding = await service.analyzeDiscrepancy(makeDiscrepancy());

      expect(callCount).toBe(3);
      expect(finding.explanation).toBe('Éxito tras reintentos');
    });

    it('lanza error tras agotar reintentos', async () => {
      service.bedrockFn = async () => {
        throw new Error('Request timeout');
      };

      await expect(
        service.analyzeDiscrepancy(makeDiscrepancy()),
      ).rejects.toThrow('timeout');
    });

    it('no reintenta para errores no transitorios', async () => {
      let callCount = 0;
      service.bedrockFn = async () => {
        callCount++;
        throw new Error('Invalid model ID');
      };

      await expect(
        service.analyzeDiscrepancy(makeDiscrepancy()),
      ).rejects.toThrow('Invalid model ID');

      expect(callCount).toBe(1);
    });

    it('reintenta en errores de throttling', async () => {
      let callCount = 0;
      service.bedrockFn = async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error('Too many requests - throttling');
        }
        return {
          explanation: 'OK',
          probableCause: 'OK',
          recommendation: 'OK',
        };
      };

      const finding = await service.analyzeDiscrepancy(makeDiscrepancy());

      expect(callCount).toBe(2);
      expect(finding.explanation).toBe('OK');
    });
  });
});

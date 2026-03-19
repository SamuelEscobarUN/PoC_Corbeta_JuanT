/**
 * Tests unitarios para ConversationalAgentService.
 *
 * Se mockean los servicios dependientes (ComparisonService, AIAnalysisService,
 * DashboardService) para aislar la lógica del agente conversacional.
 *
 * Verificamos:
 *  - Clasificación de intención por palabras clave
 *  - Búsqueda de facturas por número
 *  - Consulta de discrepancias entre etapas
 *  - Rastreo de ítems perdidos
 *  - Resumen de incidentes
 *  - Explicación de hallazgos
 *  - Consulta de reglas de calidad fallidas
 *  - Consultas generales
 *  - Historial de conversación
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks de Amplify antes de importar los servicios                  */
/* ------------------------------------------------------------------ */
vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Discrepancy: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        listDiscrepancyByInvoiceAndDetectedAt: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ data: {} }),
      },
      Finding: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ data: {} }),
      },
      QualityResult: {
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
      Correction: {
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
    },
  }),
}));

import { ConversationalAgentService } from './conversational-agent';
import { ComparisonService } from './comparison';
import { AIAnalysisService } from './ai-analysis';
import { DashboardService } from './dashboard';
import type { Discrepancy } from '../types/comparison';
import type { Finding } from '../types/ai-analysis';

/* ------------------------------------------------------------------ */
/*  Helpers para datos de prueba                                      */
/* ------------------------------------------------------------------ */

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

function makeFinding(overrides?: Partial<Finding>): Finding {
  return {
    findingId: 'finding-001',
    discrepancyId: 'disc-001',
    explanation: 'Se detectó una diferencia de total',
    probableCause: 'Error de sincronización',
    recommendation: 'Verificar datos en origen',
    severity: 'medium',
    itemFindings: [],
    createdAt: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('ConversationalAgentService', () => {
  let service: ConversationalAgentService;
  let mockComparisonService: ComparisonService;
  let mockAIAnalysisService: AIAnalysisService;
  let mockDashboardService: DashboardService;

  beforeEach(() => {
    // Crear instancias reales y mockear sus métodos
    mockComparisonService = ComparisonService.createForTesting();
    mockAIAnalysisService = AIAnalysisService.createForTesting();
    mockDashboardService = new DashboardService();

    service = ConversationalAgentService.createForTesting(
      mockComparisonService,
      mockAIAnalysisService,
      mockDashboardService,
    );
  });

  /* ---- classifyIntent -------------------------------------------- */

  describe('classifyIntent', () => {
    it('clasifica búsqueda de factura por número INV-XXX', () => {
      expect(service.classifyIntent('Buscar factura INV-001')).toBe('invoice_search');
    });

    it('clasifica búsqueda de factura por palabra clave "factura"', () => {
      expect(service.classifyIntent('¿Qué pasó con la factura 12345?')).toBe('invoice_search');
    });

    it('clasifica consulta de discrepancias', () => {
      expect(service.classifyIntent('Mostrar discrepancias entre etapas')).toBe('discrepancy_query');
    });

    it('clasifica consulta de diferencias', () => {
      expect(service.classifyIntent('¿Cuáles son las diferencias?')).toBe('discrepancy_query');
    });

    it('clasifica rastreo de ítem perdido', () => {
      expect(service.classifyIntent('¿Dónde se perdió el ítem?')).toBe('item_tracking');
    });

    it('clasifica resumen de incidentes', () => {
      expect(service.classifyIntent('Dame un resumen de incidentes del periodo')).toBe('incident_summary');
    });

    it('clasifica explicación de hallazgos', () => {
      expect(service.classifyIntent('Explícame el hallazgo de la discrepancia')).toBe('finding_explanation');
    });

    it('clasifica consulta de calidad', () => {
      expect(service.classifyIntent('¿Qué reglas de calidad fallaron?')).toBe('quality_query');
    });

    it('clasifica consulta general cuando no hay match', () => {
      expect(service.classifyIntent('Hola, ¿cómo estás?')).toBe('general');
    });
  });

  /* ---- processQuery: invoice_search ------------------------------ */

  describe('processQuery - invoice_search', () => {
    it('retorna discrepancias cuando se busca una factura existente', async () => {
      const discrepancies = [makeDiscrepancy()];
      vi.spyOn(mockComparisonService, 'getDiscrepanciesByInvoice').mockResolvedValue(discrepancies);

      const result = await service.processQuery('Buscar factura INV-001');

      expect(result.intent).toBe('invoice_search');
      expect(result.response).toContain('INV-001');
      expect(result.response).toContain('1');
      expect(result.data).toBeDefined();
    });

    it('indica cuando no hay discrepancias para la factura', async () => {
      vi.spyOn(mockComparisonService, 'getDiscrepanciesByInvoice').mockResolvedValue([]);

      const result = await service.processQuery('Buscar factura INV-999');

      expect(result.intent).toBe('invoice_search');
      expect(result.response).toContain('INV-999');
      expect(result.response).toContain('No se encontraron');
    });

    it('pide número de factura cuando no se proporciona', async () => {
      const result = await service.processQuery('Buscar factura');

      expect(result.intent).toBe('invoice_search');
      expect(result.response).toContain('número de factura');
    });
  });

  /* ---- processQuery: discrepancy_query --------------------------- */

  describe('processQuery - discrepancy_query', () => {
    it('retorna discrepancias por etapa cuando no hay factura específica', async () => {
      vi.spyOn(mockDashboardService, 'getDiscrepanciesByStage').mockResolvedValue([
        {
          stagePair: { source: 'geopos_local' as never, target: 'geopos_central' as never },
          discrepancies: [makeDiscrepancy()],
          count: 1,
        },
      ]);

      const result = await service.processQuery('Mostrar discrepancias entre etapas');

      expect(result.intent).toBe('discrepancy_query');
      expect(result.response).toContain('1');
    });

    it('retorna discrepancias para una factura específica', async () => {
      vi.spyOn(mockComparisonService, 'getDiscrepanciesByInvoice').mockResolvedValue([
        makeDiscrepancy(),
      ]);

      const result = await service.processQuery('Discrepancias de la factura INV-001');

      expect(result.intent).toBe('discrepancy_query');
      expect(result.response).toContain('INV-001');
    });
  });

  /* ---- processQuery: item_tracking ------------------------------- */

  describe('processQuery - item_tracking', () => {
    it('retorna ítems perdidos para una factura', async () => {
      vi.spyOn(mockComparisonService, 'getDiscrepanciesByInvoice').mockResolvedValue([
        makeDiscrepancy({
          type: 'missing_item',
          details: {
            itemId: 'ITEM-X',
            message: 'Ítem perdido',
          },
        }),
      ]);

      const result = await service.processQuery('¿Dónde se perdió el ítem de la factura INV-001?');

      expect(result.intent).toBe('item_tracking');
      expect(result.response).toContain('ITEM-X');
      expect(result.response).toContain('geopos_local');
    });

    it('indica cuando no hay ítems perdidos', async () => {
      vi.spyOn(mockComparisonService, 'getDiscrepanciesByInvoice').mockResolvedValue([
        makeDiscrepancy({ type: 'total_difference' }),
      ]);

      const result = await service.processQuery('¿Dónde se perdió el ítem de la factura INV-001?');

      expect(result.intent).toBe('item_tracking');
      expect(result.response).toContain('No se encontraron');
    });

    it('pide número de factura cuando no se proporciona', async () => {
      const result = await service.processQuery('¿Dónde se perdió el ítem?');

      expect(result.intent).toBe('item_tracking');
      expect(result.response).toContain('número de factura');
    });
  });

  /* ---- processQuery: incident_summary ---------------------------- */

  describe('processQuery - incident_summary', () => {
    it('retorna resumen de incidentes', async () => {
      vi.spyOn(mockDashboardService, 'getReconciliationSummary').mockResolvedValue({
        totalInvoices: 100,
        invoicesWithDiscrepancies: 5,
        discrepancyRate: 0.05,
        countByType: {
          missing_invoice: 2,
          total_difference: 1,
          item_count_difference: 1,
          missing_item: 1,
        },
      });

      const result = await service.processQuery('Dame un resumen de incidentes del periodo');

      expect(result.intent).toBe('incident_summary');
      expect(result.response).toContain('5');
      expect(result.response).toContain('missing_invoice: 2');
    });
  });

  /* ---- processQuery: finding_explanation ------------------------- */

  describe('processQuery - finding_explanation', () => {
    it('retorna hallazgos para una factura', async () => {
      vi.spyOn(mockComparisonService, 'getDiscrepanciesByInvoice').mockResolvedValue([
        makeDiscrepancy(),
      ]);
      vi.spyOn(mockAIAnalysisService, 'getFindings').mockResolvedValue([
        makeFinding(),
      ]);

      const result = await service.processQuery('Explícame el hallazgo de la factura INV-001');

      expect(result.intent).toBe('finding_explanation');
      expect(result.response).toContain('1 hallazgo');
      expect(result.response).toContain('diferencia de total');
    });

    it('indica cuando no hay hallazgos', async () => {
      vi.spyOn(mockComparisonService, 'getDiscrepanciesByInvoice').mockResolvedValue([
        makeDiscrepancy(),
      ]);
      vi.spyOn(mockAIAnalysisService, 'getFindings').mockResolvedValue([]);

      const result = await service.processQuery('Explícame el hallazgo de la factura INV-001');

      expect(result.intent).toBe('finding_explanation');
      expect(result.response).toContain('No se encontraron hallazgos');
    });

    it('pide contexto cuando no hay factura ni ID', async () => {
      const result = await service.processQuery('Explícame el análisis');

      expect(result.intent).toBe('finding_explanation');
      expect(result.response).toContain('número de factura');
    });
  });

  /* ---- processQuery: quality_query ------------------------------- */

  describe('processQuery - quality_query', () => {
    it('retorna reglas de calidad fallidas', async () => {
      vi.spyOn(mockDashboardService, 'getQualityResults').mockResolvedValue({
        totalRules: 10,
        passed: 7,
        failed: 3,
        byDataset: [
          {
            uploadId: 'upload-001',
            stage: 'geopos_local' as never,
            totalRules: 5,
            passed: 3,
            failed: 2,
          },
        ],
      });

      const result = await service.processQuery('¿Qué reglas de calidad fallaron?');

      expect(result.intent).toBe('quality_query');
      expect(result.response).toContain('3');
      expect(result.response).toContain('10');
      expect(result.response).toContain('upload-001');
    });

    it('indica cuando todas las reglas pasaron', async () => {
      vi.spyOn(mockDashboardService, 'getQualityResults').mockResolvedValue({
        totalRules: 5,
        passed: 5,
        failed: 0,
        byDataset: [],
      });

      const result = await service.processQuery('¿Qué reglas de calidad fallaron?');

      expect(result.intent).toBe('quality_query');
      expect(result.response).toContain('pasaron exitosamente');
    });
  });

  /* ---- processQuery: general ------------------------------------- */

  describe('processQuery - general', () => {
    it('retorna respuesta general con sugerencias', async () => {
      const result = await service.processQuery('Hola, ¿cómo estás?');

      expect(result.intent).toBe('general');
      expect(result.response).toContain('Puedo ayudarte');
    });
  });

  /* ---- getConversationHistory ------------------------------------ */

  describe('getConversationHistory', () => {
    it('retorna historial vacío inicialmente', () => {
      const history = service.getConversationHistory();
      expect(history).toHaveLength(0);
    });

    it('registra mensajes del usuario y asistente tras processQuery', async () => {
      vi.spyOn(mockComparisonService, 'getDiscrepanciesByInvoice').mockResolvedValue([]);

      await service.processQuery('Buscar factura INV-001');

      const history = service.getConversationHistory();
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Buscar factura INV-001');
      expect(history[1].role).toBe('assistant');
      expect(history[1].content).toContain('INV-001');
    });

    it('acumula mensajes de múltiples consultas', async () => {
      vi.spyOn(mockComparisonService, 'getDiscrepanciesByInvoice').mockResolvedValue([]);

      await service.processQuery('Buscar factura INV-001');
      await service.processQuery('Hola');

      const history = service.getConversationHistory();
      expect(history).toHaveLength(4);
    });

    it('retorna copia del historial (no referencia directa)', async () => {
      await service.processQuery('Hola');

      const history1 = service.getConversationHistory();
      const history2 = service.getConversationHistory();
      expect(history1).not.toBe(history2);
      expect(history1).toEqual(history2);
    });
  });

  /* ---- clearHistory ---------------------------------------------- */

  describe('clearHistory', () => {
    it('limpia el historial de conversación', async () => {
      await service.processQuery('Hola');
      expect(service.getConversationHistory()).toHaveLength(2);

      service.clearHistory();
      expect(service.getConversationHistory()).toHaveLength(0);
    });
  });

  /* ---- extractInvoiceNumber -------------------------------------- */

  describe('extractInvoiceNumber', () => {
    it('extrae INV-001 de la consulta', () => {
      expect(service.extractInvoiceNumber('Buscar factura INV-001')).toBe('INV-001');
    });

    it('extrae FAC-123 de la consulta', () => {
      expect(service.extractInvoiceNumber('Ver FAC-123')).toBe('FAC-123');
    });

    it('extrae número puro con contexto "factura"', () => {
      expect(service.extractInvoiceNumber('factura 12345')).toBe('12345');
    });

    it('retorna null cuando no hay número de factura', () => {
      expect(service.extractInvoiceNumber('Hola mundo')).toBeNull();
    });
  });
});

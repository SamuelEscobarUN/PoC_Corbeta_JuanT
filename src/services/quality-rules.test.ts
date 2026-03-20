/**
 * Tests unitarios para QualityRulesService (refactorizado).
 *
 * Se mockean las llamadas a Amplify Data (DynamoDB) y AppSync queries
 * para que los tests corran sin servicios AWS reales.
 *
 * Verificamos:
 *  - CRUD de reglas de calidad (crear, actualizar, eliminar, listar, obtener)
 *  - Ejecución de reglas vía AppSync query
 *  - Validación de expresiones DQDL
 *  - Consulta de resultados históricos con filtros
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks de Amplify antes de importar el servicio                    */
/* ------------------------------------------------------------------ */
const {
  mockQualityRuleCreate,
  mockQualityRuleUpdate,
  mockQualityRuleDelete,
  mockQualityRuleGet,
  mockQualityRuleList,
  mockQualityRuleListByStage,
  mockQualityResultList,
  mockExecuteQualityRules,
} = vi.hoisted(() => ({
  mockQualityRuleCreate: vi.fn(),
  mockQualityRuleUpdate: vi.fn(),
  mockQualityRuleDelete: vi.fn(),
  mockQualityRuleGet: vi.fn(),
  mockQualityRuleList: vi.fn(),
  mockQualityRuleListByStage: vi.fn(),
  mockQualityResultList: vi.fn(),
  mockExecuteQualityRules: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      QualityRule: {
        create: mockQualityRuleCreate,
        update: mockQualityRuleUpdate,
        delete: mockQualityRuleDelete,
        get: mockQualityRuleGet,
        list: mockQualityRuleList,
        listQualityRuleByStageAndCreatedAt: mockQualityRuleListByStage,
      },
      QualityResult: {
        list: mockQualityResultList,
      },
    },
    queries: {
      executeQualityRules: mockExecuteQualityRules,
    },
  }),
}));

/* Mock de crypto.randomUUID para tests determinísticos */
let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
});

import { QualityRulesService } from './quality-rules';
import type { CascadeStage } from '../types/csv';
import type { CreateQualityRuleInput } from '../types/quality';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createService(): QualityRulesService {
  return QualityRulesService.createForTesting();
}

/** Input base para crear una regla. */
function baseRuleInput(overrides?: Partial<CreateQualityRuleInput>): CreateQualityRuleInput {
  return {
    ruleName: 'Regla de prueba',
    stage: 'geopos_local' as CascadeStage,
    type: 'completeness',
    expression: '',
    targetColumn: 'invoice',
    ...overrides,
  };
}

/** Simula un registro DynamoDB de QualityRule. */
function makeDynamoRule(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    ruleId: 'test-uuid-1',
    ruleName: 'Regla de prueba',
    stage: 'geopos_local',
    type: 'completeness',
    expression: '',
    targetColumn: 'invoice',
    threshold: 1.0,
    enabled: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('QualityRulesService', () => {
  let service: QualityRulesService;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    mockQualityRuleCreate.mockResolvedValue({ data: {} });
    mockQualityRuleUpdate.mockResolvedValue({ data: {} });
    mockQualityRuleDelete.mockResolvedValue({ data: {} });
    mockQualityRuleGet.mockResolvedValue({ data: null });
    mockQualityRuleList.mockResolvedValue({ data: [] });
    mockQualityRuleListByStage.mockResolvedValue({ data: [] });
    mockQualityResultList.mockResolvedValue({ data: [] });
    service = createService();
  });

  /* ---- CRUD de reglas -------------------------------------------- */

  describe('CRUD de reglas', () => {
    it('crea una regla con valores por defecto', async () => {
      const rule = await service.createRule(baseRuleInput());

      expect(rule.ruleId).toBe('test-uuid-1');
      expect(rule.ruleName).toBe('Regla de prueba');
      expect(rule.stage).toBe('geopos_local');
      expect(rule.type).toBe('completeness');
      expect(rule.threshold).toBe(1.0);
      expect(rule.enabled).toBe(true);
      expect(rule.createdAt).toBeTruthy();
      expect(mockQualityRuleCreate).toHaveBeenCalledTimes(1);
    });

    it('crea una regla con threshold personalizado', async () => {
      const rule = await service.createRule(baseRuleInput({ threshold: 0.8 }));
      expect(rule.threshold).toBe(0.8);
    });

    it('actualiza una regla existente', async () => {
      mockQualityRuleGet.mockResolvedValue({
        data: makeDynamoRule(),
      });

      const updated = await service.updateRule('test-uuid-1', {
        ruleName: 'Regla actualizada',
        threshold: 0.9,
      });

      expect(updated).not.toBeNull();
      expect(updated!.ruleName).toBe('Regla actualizada');
      expect(updated!.threshold).toBe(0.9);
      expect(updated!.stage).toBe('geopos_local');
      expect(mockQualityRuleUpdate).toHaveBeenCalledTimes(1);
    });

    it('retorna null al actualizar una regla inexistente', async () => {
      mockQualityRuleGet.mockResolvedValue({ data: null });
      const result = await service.updateRule('no-existe', { ruleName: 'X' });
      expect(result).toBeNull();
    });

    it('elimina una regla existente', async () => {
      mockQualityRuleGet.mockResolvedValue({
        data: makeDynamoRule(),
      });

      const deleted = await service.deleteRule('test-uuid-1');
      expect(deleted).toBe(true);
      expect(mockQualityRuleDelete).toHaveBeenCalledWith({ ruleId: 'test-uuid-1' });
    });

    it('retorna false al eliminar una regla inexistente', async () => {
      mockQualityRuleGet.mockResolvedValue({ data: null });
      const result = await service.deleteRule('no-existe');
      expect(result).toBe(false);
    });

    it('lista reglas filtradas por etapa usando GSI', async () => {
      mockQualityRuleListByStage.mockResolvedValue({
        data: [
          makeDynamoRule({ ruleId: 'r1' }),
          makeDynamoRule({ ruleId: 'r2' }),
        ],
      });

      const rules = await service.listRules('geopos_local');
      expect(rules).toHaveLength(2);
      expect(mockQualityRuleListByStage).toHaveBeenCalledWith(
        { stage: 'geopos_local' },
        { sortDirection: 'ASC' },
      );
    });

    it('lista todas las reglas sin filtro de etapa', async () => {
      mockQualityRuleList.mockResolvedValue({
        data: [
          makeDynamoRule({ ruleId: 'r1', stage: 'geopos_local' }),
          makeDynamoRule({ ruleId: 'r2', stage: 'integracion' }),
        ],
      });

      const all = await service.listRules();
      expect(all).toHaveLength(2);
      expect(mockQualityRuleList).toHaveBeenCalled();
    });

    it('obtiene una regla por ID', async () => {
      mockQualityRuleGet.mockResolvedValue({
        data: makeDynamoRule(),
      });

      const found = await service.getRule('test-uuid-1');
      expect(found).not.toBeNull();
      expect(found!.ruleId).toBe('test-uuid-1');
    });

    it('retorna null para regla inexistente', async () => {
      mockQualityRuleGet.mockResolvedValue({ data: null });
      const result = await service.getRule('no-existe');
      expect(result).toBeNull();
    });
  });

  /* ---- Ejecución de reglas vía AppSync ----------------------------- */

  describe('executeRules', () => {
    const stage: CascadeStage = 'geopos_local';
    const uploadId = 'upload-123';

    it('invoca la query AppSync y retorna el resumen', async () => {
      const mockSummary = {
        uploadId,
        stage,
        totalRules: 2,
        passed: 1,
        failed: 1,
        results: [],
        alerts: [],
        executedAt: '2024-01-01T00:00:00.000Z',
      };

      mockExecuteQualityRules.mockResolvedValue({
        data: JSON.stringify(mockSummary),
        errors: null,
      });

      const summary = await service.executeRules(uploadId, stage);

      expect(summary.uploadId).toBe(uploadId);
      expect(summary.stage).toBe(stage);
      expect(summary.totalRules).toBe(2);
      expect(summary.passed).toBe(1);
      expect(summary.failed).toBe(1);
      expect(mockExecuteQualityRules).toHaveBeenCalledWith({
        uploadId,
        stage,
      });
    });

    it('lanza error cuando AppSync retorna errores', async () => {
      mockExecuteQualityRules.mockResolvedValue({
        data: null,
        errors: [{ message: 'Upload no encontrado' }],
      });

      await expect(service.executeRules(uploadId, stage)).rejects.toThrow(
        'Upload no encontrado',
      );
    });

    it('lanza error cuando no hay datos de respuesta', async () => {
      mockExecuteQualityRules.mockResolvedValue({
        data: null,
        errors: null,
      });

      await expect(service.executeRules(uploadId, stage)).rejects.toThrow(
        'No se recibió respuesta',
      );
    });
  });

  /* ---- Validación DQDL ------------------------------------------- */

  describe('validateExpression', () => {
    it('valida una expresión completeness válida', () => {
      const result = service.validateExpression(
        'Completeness "invoice" >= 1.0',
        'completeness',
      );
      expect(result.valid).toBe(true);
    });

    it('rechaza una expresión vacía', () => {
      const result = service.validateExpression('', 'custom');
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('rechaza una expresión DQDL inválida', () => {
      const result = service.validateExpression('INVALID STUFF', 'custom');
      expect(result.valid).toBe(false);
    });

    it('valida una expresión uniqueness válida', () => {
      const result = service.validateExpression(
        'Uniqueness "barcode" >= 0.95',
        'uniqueness',
      );
      expect(result.valid).toBe(true);
    });
  });

  /* ---- Generación de expresión base ------------------------------ */

  describe('generateBaseExpression', () => {
    it('genera expresión base para completeness', () => {
      const expr = service.generateBaseExpression('completeness', 'invoice');
      expect(expr).toContain('Completeness');
      expect(expr).toContain('invoice');
    });

    it('genera expresión base para range', () => {
      const expr = service.generateBaseExpression('range', 'total');
      expect(expr).toContain('ColumnValues');
      expect(expr).toContain('between');
    });
  });

  /* ---- Consulta de resultados históricos ------------------------- */

  describe('getExecutionResults', () => {
    it('retorna resultados agrupados por uploadId', async () => {
      mockQualityResultList.mockResolvedValue({
        data: [
          {
            uploadId: 'upload-1',
            ruleId: 'rule-1',
            ruleName: 'Regla 1',
            ruleExpression: 'Completeness "col" >= 1.0',
            result: 'passed',
            details: JSON.stringify({
              recordsEvaluated: 100,
              recordsPassed: 100,
              recordsFailed: 0,
              compliancePercent: 100,
              message: 'OK',
            }),
            executedAt: '2024-01-02T00:00:00.000Z',
          },
          {
            uploadId: 'upload-1',
            ruleId: 'rule-2',
            ruleName: 'Regla 2',
            ruleExpression: 'Uniqueness "col" >= 0.9',
            result: 'failed',
            details: JSON.stringify({
              recordsEvaluated: 100,
              recordsPassed: 80,
              recordsFailed: 20,
              compliancePercent: 80,
              message: 'Duplicados',
            }),
            executedAt: '2024-01-02T00:00:00.000Z',
          },
        ],
      });

      const results = await service.getExecutionResults();

      expect(results).toHaveLength(1);
      expect(results[0].uploadId).toBe('upload-1');
      expect(results[0].totalRules).toBe(2);
      expect(results[0].passed).toBe(1);
      expect(results[0].failed).toBe(1);
    });

    it('filtra resultados por rango de fechas', async () => {
      mockQualityResultList.mockResolvedValue({
        data: [
          {
            uploadId: 'upload-1',
            ruleId: 'rule-1',
            ruleName: 'R1',
            result: 'passed',
            details: '{}',
            executedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            uploadId: 'upload-2',
            ruleId: 'rule-2',
            ruleName: 'R2',
            result: 'passed',
            details: '{}',
            executedAt: '2024-06-01T00:00:00.000Z',
          },
        ],
      });

      const results = await service.getExecutionResults({
        dateFrom: '2024-03-01',
        dateTo: '2024-12-31',
      });

      expect(results).toHaveLength(1);
      expect(results[0].uploadId).toBe('upload-2');
    });

    it('ordena resultados por fecha descendente', async () => {
      mockQualityResultList.mockResolvedValue({
        data: [
          {
            uploadId: 'upload-old',
            ruleId: 'r1',
            ruleName: 'R1',
            result: 'passed',
            details: '{}',
            executedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            uploadId: 'upload-new',
            ruleId: 'r2',
            ruleName: 'R2',
            result: 'passed',
            details: '{}',
            executedAt: '2024-06-01T00:00:00.000Z',
          },
        ],
      });

      const results = await service.getExecutionResults();

      expect(results[0].uploadId).toBe('upload-new');
      expect(results[1].uploadId).toBe('upload-old');
    });

    it('retorna array vacío cuando hay error', async () => {
      mockQualityResultList.mockRejectedValue(new Error('DynamoDB error'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const results = await service.getExecutionResults();

      expect(results).toEqual([]);
      errorSpy.mockRestore();
    });
  });
});

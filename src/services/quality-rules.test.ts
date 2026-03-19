/**
 * Tests unitarios para QualityRulesService.
 *
 * Se mockean las llamadas a Amplify Data (DynamoDB) y crypto.randomUUID
 * para que los tests corran sin servicios AWS reales.
 *
 * Verificamos:
 *  - CRUD de reglas de calidad (crear, actualizar, eliminar, listar)
 *  - Ejecución de reglas contra datos y registro de resultados
 *  - Evaluación correcta por tipo de regla (completeness, uniqueness, range, format)
 *  - Generación de alertas cuando una regla falla
 *  - Resumen de ejecución con conteos passed/failed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks de Amplify antes de importar el servicio                    */
/* ------------------------------------------------------------------ */
const { mockQualityResultCreate } = vi.hoisted(() => ({
  mockQualityResultCreate: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      QualityResult: {
        create: mockQualityResultCreate,
      },
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

/**
 * Crear una instancia limpia del servicio para cada test.
 * Usamos el método estático createForTesting para evitar estado compartido.
 */
function createService(): QualityRulesService {
  return QualityRulesService.createForTesting();
}

/** Datos de ejemplo para pruebas. */
function sampleData(): Record<string, string>[] {
  return [
    { invoice: 'INV-001', total: '100.50', barcode: 'BC001', description: 'Item A' },
    { invoice: 'INV-002', total: '200.00', barcode: 'BC002', description: 'Item B' },
    { invoice: 'INV-003', total: '50.75', barcode: 'BC003', description: '' },
  ];
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

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('QualityRulesService', () => {
  let service: QualityRulesService;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    mockQualityResultCreate.mockResolvedValue({ data: {} });
    service = createService();
  });

  /* ---- CRUD de reglas -------------------------------------------- */

  describe('CRUD de reglas', () => {
    it('crea una regla con valores por defecto', () => {
      const rule = service.createRule(baseRuleInput());

      expect(rule.ruleId).toBe('test-uuid-1');
      expect(rule.ruleName).toBe('Regla de prueba');
      expect(rule.stage).toBe('geopos_local');
      expect(rule.type).toBe('completeness');
      expect(rule.threshold).toBe(1.0);
      expect(rule.enabled).toBe(true);
      expect(rule.createdAt).toBeTruthy();
    });

    it('crea una regla con threshold personalizado', () => {
      const rule = service.createRule(baseRuleInput({ threshold: 0.8 }));

      expect(rule.threshold).toBe(0.8);
    });

    it('actualiza una regla existente', () => {
      const rule = service.createRule(baseRuleInput());
      const updated = service.updateRule(rule.ruleId, {
        ruleName: 'Regla actualizada',
        threshold: 0.9,
      });

      expect(updated).not.toBeNull();
      expect(updated!.ruleName).toBe('Regla actualizada');
      expect(updated!.threshold).toBe(0.9);
      // Campos no actualizados se mantienen
      expect(updated!.stage).toBe('geopos_local');
    });

    it('retorna null al actualizar una regla inexistente', () => {
      const result = service.updateRule('no-existe', { ruleName: 'X' });
      expect(result).toBeNull();
    });

    it('elimina una regla existente', () => {
      const rule = service.createRule(baseRuleInput());
      expect(service.deleteRule(rule.ruleId)).toBe(true);
      expect(service.getRule(rule.ruleId)).toBeNull();
    });

    it('retorna false al eliminar una regla inexistente', () => {
      expect(service.deleteRule('no-existe')).toBe(false);
    });

    it('lista reglas filtradas por etapa', () => {
      service.createRule(baseRuleInput({ stage: 'geopos_local' }));
      service.createRule(baseRuleInput({ stage: 'integracion' }));
      service.createRule(baseRuleInput({ stage: 'geopos_local' }));

      const geoposRules = service.listRules('geopos_local');
      expect(geoposRules).toHaveLength(2);

      const intRules = service.listRules('integracion');
      expect(intRules).toHaveLength(1);
    });

    it('lista todas las reglas sin filtro de etapa', () => {
      service.createRule(baseRuleInput({ stage: 'geopos_local' }));
      service.createRule(baseRuleInput({ stage: 'integracion' }));

      const all = service.listRules();
      expect(all).toHaveLength(2);
    });

    it('obtiene una regla por ID', () => {
      const rule = service.createRule(baseRuleInput());
      const found = service.getRule(rule.ruleId);

      expect(found).not.toBeNull();
      expect(found!.ruleId).toBe(rule.ruleId);
    });

    it('retorna null para regla inexistente', () => {
      expect(service.getRule('no-existe')).toBeNull();
    });
  });

  /* ---- Evaluación de reglas -------------------------------------- */

  describe('evaluateRule', () => {
    it('completeness: detecta valores vacíos', () => {
      const rule = service.createRule(
        baseRuleInput({ type: 'completeness', targetColumn: 'description' }),
      );
      const details = service.evaluateRule(rule, sampleData());

      // El tercer registro tiene description vacío
      expect(details.recordsEvaluated).toBe(3);
      expect(details.recordsPassed).toBe(2);
      expect(details.recordsFailed).toBe(1);
      expect(details.compliancePercent).toBeCloseTo(66.67, 1);
    });

    it('completeness: pasa cuando todos los valores están presentes', () => {
      const rule = service.createRule(
        baseRuleInput({ type: 'completeness', targetColumn: 'invoice' }),
      );
      const details = service.evaluateRule(rule, sampleData());

      expect(details.recordsPassed).toBe(3);
      expect(details.recordsFailed).toBe(0);
      expect(details.compliancePercent).toBe(100);
    });

    it('uniqueness: detecta valores duplicados', () => {
      const rule = service.createRule(
        baseRuleInput({ type: 'uniqueness', targetColumn: 'total' }),
      );
      const data = [
        { total: '100' },
        { total: '200' },
        { total: '100' }, // duplicado
      ];
      const details = service.evaluateRule(rule, data);

      expect(details.recordsFailed).toBe(2); // ambos '100' son duplicados
      expect(details.recordsPassed).toBe(1);
    });

    it('uniqueness: pasa cuando todos los valores son únicos', () => {
      const rule = service.createRule(
        baseRuleInput({ type: 'uniqueness', targetColumn: 'invoice' }),
      );
      const details = service.evaluateRule(rule, sampleData());

      expect(details.recordsPassed).toBe(3);
      expect(details.recordsFailed).toBe(0);
    });

    it('range: detecta valores fuera de rango', () => {
      const rule = service.createRule(
        baseRuleInput({
          type: 'range',
          targetColumn: 'total',
          expression: '60,250',
        }),
      );
      const details = service.evaluateRule(rule, sampleData());

      // 100.50 y 200.00 están en rango, 50.75 está fuera
      expect(details.recordsPassed).toBe(2);
      expect(details.recordsFailed).toBe(1);
    });

    it('range: pasa cuando todos los valores están en rango', () => {
      const rule = service.createRule(
        baseRuleInput({
          type: 'range',
          targetColumn: 'total',
          expression: '0,500',
        }),
      );
      const details = service.evaluateRule(rule, sampleData());

      expect(details.recordsPassed).toBe(3);
      expect(details.recordsFailed).toBe(0);
    });

    it('format: detecta valores que no coinciden con regex', () => {
      const rule = service.createRule(
        baseRuleInput({
          type: 'format',
          targetColumn: 'invoice',
          expression: '^INV-00[12]$',
        }),
      );
      const details = service.evaluateRule(rule, sampleData());

      // INV-001 e INV-002 coinciden, INV-003 no
      expect(details.recordsPassed).toBe(2);
      expect(details.recordsFailed).toBe(1);
    });

    it('retorna 0% cumplimiento para datos vacíos', () => {
      const rule = service.createRule(baseRuleInput());
      const details = service.evaluateRule(rule, []);

      expect(details.recordsEvaluated).toBe(0);
      expect(details.compliancePercent).toBe(0);
    });

    it('completeness: falla si no se especifica columna objetivo', () => {
      const rule = service.createRule(
        baseRuleInput({ type: 'completeness', targetColumn: undefined }),
      );
      const details = service.evaluateRule(rule, sampleData());

      expect(details.recordsPassed).toBe(0);
      expect(details.message).toContain('No se especificó columna objetivo');
    });
  });

  /* ---- Ejecución de reglas y registro en DynamoDB ----------------- */

  describe('executeRules', () => {
    const stage: CascadeStage = 'geopos_local';
    const uploadId = 'upload-123';

    it('ejecuta reglas activas y retorna resumen', async () => {
      service.createRule(
        baseRuleInput({
          stage,
          type: 'completeness',
          targetColumn: 'invoice',
        }),
      );
      service.createRule(
        baseRuleInput({
          stage,
          type: 'completeness',
          targetColumn: 'description',
        }),
      );

      const summary = await service.executeRules(uploadId, stage, sampleData());

      expect(summary.uploadId).toBe(uploadId);
      expect(summary.stage).toBe(stage);
      expect(summary.totalRules).toBe(2);
      // invoice: todos completos → passed; description: 1 vacío → failed (threshold=1.0)
      expect(summary.passed).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.results).toHaveLength(2);
    });

    it('registra cada resultado en DynamoDB', async () => {
      service.createRule(
        baseRuleInput({ stage, type: 'completeness', targetColumn: 'invoice' }),
      );

      await service.executeRules(uploadId, stage, sampleData());

      expect(mockQualityResultCreate).toHaveBeenCalledTimes(1);
      expect(mockQualityResultCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          uploadId,
          result: 'passed',
        }),
      );
    });

    it('genera alerta cuando una regla falla', async () => {
      // Espiar console.warn para verificar que se genera la alerta
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      service.createRule(
        baseRuleInput({
          stage,
          type: 'completeness',
          targetColumn: 'description',
          // threshold 1.0 por defecto → 66.67% cumplimiento = falla
        }),
      );

      const summary = await service.executeRules(uploadId, stage, sampleData());

      expect(summary.failed).toBe(1);
      // Verificar que se llamó a publishAlert (via console.warn placeholder)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Alerta de calidad]'),
      );

      warnSpy.mockRestore();
    });

    it('no ejecuta reglas deshabilitadas', async () => {
      service.createRule(
        baseRuleInput({ stage, enabled: false, targetColumn: 'invoice' }),
      );

      const summary = await service.executeRules(uploadId, stage, sampleData());

      expect(summary.totalRules).toBe(0);
      expect(mockQualityResultCreate).not.toHaveBeenCalled();
    });

    it('no ejecuta reglas de otra etapa', async () => {
      service.createRule(
        baseRuleInput({ stage: 'integracion', targetColumn: 'invoice' }),
      );

      const summary = await service.executeRules(uploadId, stage, sampleData());

      expect(summary.totalRules).toBe(0);
    });

    it('maneja errores de DynamoDB sin interrumpir ejecución', async () => {
      mockQualityResultCreate.mockRejectedValue(new Error('DynamoDB error'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      service.createRule(
        baseRuleInput({ stage, type: 'completeness', targetColumn: 'invoice' }),
      );

      // No debe lanzar excepción
      const summary = await service.executeRules(uploadId, stage, sampleData());

      expect(summary.totalRules).toBe(1);
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('regla con threshold bajo pasa con cumplimiento parcial', async () => {
      service.createRule(
        baseRuleInput({
          stage,
          type: 'completeness',
          targetColumn: 'description',
          threshold: 0.5, // 50% → 66.67% cumplimiento pasa
        }),
      );

      const summary = await service.executeRules(uploadId, stage, sampleData());

      expect(summary.passed).toBe(1);
      expect(summary.failed).toBe(0);
    });
  });
});

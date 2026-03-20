/**
 * Property-based tests for QualityRulesService.
 *
 * Uses fast-check with Vitest to verify universal properties of the
 * CRUD operations, filtering, and result querying logic.
 *
 * Mocks Amplify Data (DynamoDB) with an in-memory store so that
 * round-trip properties can be verified end-to-end through the service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/* ------------------------------------------------------------------ */
/*  In-memory store & Amplify mocks                                   */
/* ------------------------------------------------------------------ */

/** In-memory store that simulates DynamoDB for QualityRule records. */
let ruleStore: Map<string, Record<string, unknown>>;

/** In-memory store that simulates DynamoDB for QualityResult records. */
let resultStore: Array<Record<string, unknown>>;

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

/* Deterministic UUID counter for tests. */
let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `prop-uuid-${++uuidCounter}`,
});

import { QualityRulesService } from '../quality-rules';
import type { CascadeStage } from '../../types/csv';
import type {
  CreateQualityRuleInput,
  QualityRuleType,
} from '../../types/quality';

/* ------------------------------------------------------------------ */
/*  Wire mocks to in-memory store                                     */
/* ------------------------------------------------------------------ */

function wireStoreMocks(): void {
  mockQualityRuleCreate.mockImplementation(async (record: Record<string, unknown>) => {
    ruleStore.set(record.ruleId as string, { ...record });
    return { data: { ...record } };
  });

  mockQualityRuleGet.mockImplementation(async ({ ruleId }: { ruleId: string }) => {
    const item = ruleStore.get(ruleId) ?? null;
    return { data: item ? { ...item } : null };
  });

  mockQualityRuleUpdate.mockImplementation(async (record: Record<string, unknown>) => {
    const id = record.ruleId as string;
    const existing = ruleStore.get(id);
    if (!existing) return { data: null };
    const updated = { ...existing, ...record };
    ruleStore.set(id, updated);
    return { data: { ...updated } };
  });

  mockQualityRuleDelete.mockImplementation(async ({ ruleId }: { ruleId: string }) => {
    ruleStore.delete(ruleId);
    return { data: {} };
  });

  mockQualityRuleList.mockImplementation(async () => {
    return { data: Array.from(ruleStore.values()).map((r) => ({ ...r })) };
  });

  mockQualityRuleListByStage.mockImplementation(
    async ({ stage }: { stage: string }, _opts?: unknown) => {
      const filtered = Array.from(ruleStore.values())
        .filter((r) => r.stage === stage)
        .sort((a, b) =>
          (a.createdAt as string).localeCompare(b.createdAt as string),
        );
      return { data: filtered.map((r) => ({ ...r })) };
    },
  );

  mockQualityResultList.mockImplementation(async () => {
    return { data: resultStore.map((r) => ({ ...r })) };
  });
}

/* ------------------------------------------------------------------ */
/*  Shared Arbitraries                                                */
/* ------------------------------------------------------------------ */

const ALL_STAGES: CascadeStage[] = [
  'geopos_local',
  'geopos_central',
  'integracion',
  'ps_ck_intfc_vtapos',
];

const arbStage = fc.constantFrom<CascadeStage>(...ALL_STAGES);

const arbRuleType = fc.constantFrom<QualityRuleType>(
  'completeness', 'uniqueness', 'range', 'format', 'custom',
);

const arbRuleName = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

const arbColumnName = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0 && !s.includes('"'));

const arbThreshold = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

const arbEnabled = fc.boolean();

/** Arbitrary for a valid CreateQualityRuleInput. */
const arbCreateInput: fc.Arbitrary<CreateQualityRuleInput> = fc
  .record({
    ruleName: arbRuleName,
    stage: arbStage,
    type: arbRuleType,
    targetColumn: arbColumnName,
    threshold: arbThreshold,
    enabled: arbEnabled,
  })
  .map((r) => ({
    ...r,
    expression: r.type === 'range' ? '0,100' : r.type === 'format' ? '.*' : '',
  }));

/** ISO timestamp arbitrary. */
const arbIsoTimestamp = fc
  .integer({ min: new Date('2020-01-01').getTime(), max: new Date('2030-01-01').getTime() })
  .map((ms) => new Date(ms).toISOString());

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
  ruleStore = new Map();
  resultStore = [];
  wireStoreMocks();
});

/* ================================================================== */
/*  Property 1: Round-trip de creación de regla                       */
/* ================================================================== */

describe('Property 1: Round-trip de creación de regla', () => {
  // Feature: glue-data-quality-integration, Property 1: Round-trip de creación de regla
  // **Validates: Requirements 1.1, 1.2**

  it('creating a rule and reading it back returns all matching fields', async () => {
    // Feature: glue-data-quality-integration, Property 1: Round-trip de creación de regla
    await fc.assert(
      fc.asyncProperty(arbCreateInput, async (input) => {
        ruleStore.clear();
        uuidCounter = 0;

        const service = QualityRulesService.createForTesting();
        const created = await service.createRule(input);

        // Read back by ruleId
        const fetched = await service.getRule(created.ruleId);

        expect(fetched).not.toBeNull();
        expect(fetched!.ruleId).toBe(created.ruleId);
        expect(fetched!.ruleName).toBe(input.ruleName);
        expect(fetched!.stage).toBe(input.stage);
        expect(fetched!.type).toBe(input.type);
        expect(fetched!.expression).toBe(input.expression);
        expect(fetched!.targetColumn).toBe(input.targetColumn);
        expect(fetched!.threshold).toBe(input.threshold ?? 1.0);
        expect(fetched!.enabled).toBe(input.enabled ?? true);
        expect(fetched!.createdAt).toBeTruthy();
      }),
      { numRuns: 100 },
    );
  });
});

/* ================================================================== */
/*  Property 2: Round-trip de actualización de regla                  */
/* ================================================================== */

describe('Property 2: Round-trip de actualización de regla', () => {
  // Feature: glue-data-quality-integration, Property 2: Round-trip de actualización de regla
  // **Validates: Requirement 1.3**

  /** Arbitrary for partial update inputs. */
  const arbUpdateInput = fc.record({
    ruleName: fc.option(arbRuleName, { nil: undefined }),
    expression: fc.option(
      fc.constantFrom('', 'Completeness "x" >= 0.5', 'RowCount > 0'),
      { nil: undefined },
    ),
    targetColumn: fc.option(arbColumnName, { nil: undefined }),
    threshold: fc.option(arbThreshold, { nil: undefined }),
    enabled: fc.option(arbEnabled, { nil: undefined }),
  });

  it('updated fields reflect new values, non-updated fields remain unchanged', async () => {
    // Feature: glue-data-quality-integration, Property 2: Round-trip de actualización de regla
    await fc.assert(
      fc.asyncProperty(arbCreateInput, arbUpdateInput, async (createInput, updateInput) => {
        ruleStore.clear();
        uuidCounter = 0;

        const service = QualityRulesService.createForTesting();
        const created = await service.createRule(createInput);

        const updated = await service.updateRule(created.ruleId, updateInput);
        expect(updated).not.toBeNull();

        const fetched = await service.getRule(created.ruleId);
        expect(fetched).not.toBeNull();

        // Updated fields should reflect new values
        if (updateInput.ruleName !== undefined) {
          expect(fetched!.ruleName).toBe(updateInput.ruleName);
        } else {
          expect(fetched!.ruleName).toBe(createInput.ruleName);
        }

        if (updateInput.expression !== undefined) {
          expect(fetched!.expression).toBe(updateInput.expression);
        } else {
          expect(fetched!.expression).toBe(createInput.expression);
        }

        if (updateInput.targetColumn !== undefined) {
          expect(fetched!.targetColumn).toBe(updateInput.targetColumn);
        } else {
          expect(fetched!.targetColumn).toBe(createInput.targetColumn);
        }

        if (updateInput.threshold !== undefined) {
          expect(fetched!.threshold).toBe(updateInput.threshold);
        } else {
          expect(fetched!.threshold).toBe(createInput.threshold ?? 1.0);
        }

        if (updateInput.enabled !== undefined) {
          expect(fetched!.enabled).toBe(updateInput.enabled);
        } else {
          expect(fetched!.enabled).toBe(createInput.enabled ?? true);
        }

        // Non-updatable fields must remain unchanged
        expect(fetched!.stage).toBe(createInput.stage);
        expect(fetched!.type).toBe(createInput.type);
        expect(fetched!.ruleId).toBe(created.ruleId);
      }),
      { numRuns: 100 },
    );
  });
});

/* ================================================================== */
/*  Property 3: Eliminación remueve la regla                          */
/* ================================================================== */

describe('Property 3: Eliminación remueve la regla', () => {
  // Feature: glue-data-quality-integration, Property 3: Eliminación remueve la regla
  // **Validates: Requirement 1.4**

  it('deleting a rule makes getRule return null', async () => {
    // Feature: glue-data-quality-integration, Property 3: Eliminación remueve la regla
    await fc.assert(
      fc.asyncProperty(arbCreateInput, async (input) => {
        ruleStore.clear();
        uuidCounter = 0;

        const service = QualityRulesService.createForTesting();
        const created = await service.createRule(input);

        // Verify it exists
        const before = await service.getRule(created.ruleId);
        expect(before).not.toBeNull();

        // Delete
        const deleted = await service.deleteRule(created.ruleId);
        expect(deleted).toBe(true);

        // Verify it's gone
        const after = await service.getRule(created.ruleId);
        expect(after).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});

/* ================================================================== */
/*  Property 8: Filtrado de reglas por etapa                          */
/* ================================================================== */

describe('Property 8: Filtrado de reglas por etapa', () => {
  // Feature: glue-data-quality-integration, Property 8: Filtrado de reglas por etapa
  // **Validates: Requirement 3.2**

  const arbRuleSet = fc.array(arbCreateInput, { minLength: 2, maxLength: 15 });

  it('listing rules filtered by stage returns only rules with that stage', async () => {
    // Feature: glue-data-quality-integration, Property 8: Filtrado de reglas por etapa
    await fc.assert(
      fc.asyncProperty(arbRuleSet, arbStage, async (inputs, filterStage) => {
        ruleStore.clear();
        uuidCounter = 0;

        const service = QualityRulesService.createForTesting();

        // Create all rules
        for (const input of inputs) {
          await service.createRule(input);
        }

        // Filter by stage
        const filtered = await service.listRules(filterStage);

        // All returned rules must have the filter stage
        for (const rule of filtered) {
          expect(rule.stage).toBe(filterStage);
        }

        // Count how many inputs had the filter stage
        const expectedCount = inputs.filter((i) => i.stage === filterStage).length;
        expect(filtered.length).toBe(expectedCount);
      }),
      { numRuns: 100 },
    );
  });
});

/* ================================================================== */
/*  Property 14: Resultados ordenados por fecha descendente           */
/* ================================================================== */

describe('Property 14: Resultados ordenados por fecha descendente', () => {
  // Feature: glue-data-quality-integration, Property 14: Resultados ordenados por fecha descendente
  // **Validates: Requirement 7.1**

  /**
   * Arbitrary for a set of QualityResult records with distinct uploadIds
   * and varying executedAt timestamps.
   */
  const arbResultSet = fc
    .array(
      fc.record({
        uploadId: fc.uuid(),
        ruleId: fc.uuid(),
        ruleName: arbRuleName,
        executedAt: arbIsoTimestamp,
      }),
      { minLength: 2, maxLength: 15 },
    )
    .filter((arr) => {
      const ids = new Set(arr.map((r) => r.uploadId));
      return ids.size === arr.length;
    });

  it('getExecutionResults returns summaries ordered by executedAt descending', async () => {
    // Feature: glue-data-quality-integration, Property 14: Resultados ordenados por fecha descendente
    await fc.assert(
      fc.asyncProperty(arbResultSet, async (results) => {
        resultStore = results.map((r) => ({
          uploadId: r.uploadId,
          ruleId: r.ruleId,
          ruleName: r.ruleName,
          ruleExpression: 'Completeness "col" >= 1.0',
          result: 'passed',
          details: JSON.stringify({
            recordsEvaluated: 100,
            recordsPassed: 100,
            recordsFailed: 0,
            compliancePercent: 100,
            message: 'OK',
          }),
          executedAt: r.executedAt,
        }));

        const service = QualityRulesService.createForTesting();
        const summaries = await service.getExecutionResults();

        // Verify descending order by executedAt
        for (let i = 1; i < summaries.length; i++) {
          expect(summaries[i - 1].executedAt >= summaries[i].executedAt).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

/* ================================================================== */
/*  Property 15: Filtrado de resultados por etapa y rango de fechas   */
/* ================================================================== */

describe('Property 15: Filtrado de resultados por etapa y rango de fechas', () => {
  // Feature: glue-data-quality-integration, Property 15: Filtrado de resultados por etapa y rango de fechas
  // **Validates: Requirements 7.2, 7.4**

  /**
   * Arbitrary for a set of QualityResult records with distinct uploadIds
   * and varying executedAt timestamps.
   */
  const arbFilterResultSet = fc
    .array(
      fc.record({
        uploadId: fc.uuid(),
        ruleId: fc.uuid(),
        ruleName: arbRuleName,
        executedAt: arbIsoTimestamp,
      }),
      { minLength: 3, maxLength: 15 },
    )
    .filter((arr) => {
      const ids = new Set(arr.map((r) => r.uploadId));
      return ids.size === arr.length;
    });

  /** Arbitrary for optional date range filters. */
  const arbDateFilter = fc.record({
    dateFrom: fc.option(arbIsoTimestamp, { nil: undefined }),
    dateTo: fc.option(arbIsoTimestamp, { nil: undefined }),
  });

  it('all returned results satisfy all applied date filters', async () => {
    // Feature: glue-data-quality-integration, Property 15: Filtrado de resultados por etapa y rango de fechas
    await fc.assert(
      fc.asyncProperty(arbFilterResultSet, arbDateFilter, async (results, dateFilter) => {
        resultStore = results.map((r) => ({
          uploadId: r.uploadId,
          ruleId: r.ruleId,
          ruleName: r.ruleName,
          ruleExpression: 'Completeness "col" >= 1.0',
          result: 'passed',
          details: JSON.stringify({
            recordsEvaluated: 100,
            recordsPassed: 100,
            recordsFailed: 0,
            compliancePercent: 100,
            message: 'OK',
          }),
          executedAt: r.executedAt,
        }));

        const service = QualityRulesService.createForTesting();
        const filters: { dateFrom?: string; dateTo?: string } = {};
        if (dateFilter.dateFrom !== undefined) filters.dateFrom = dateFilter.dateFrom;
        if (dateFilter.dateTo !== undefined) filters.dateTo = dateFilter.dateTo;

        const summaries = await service.getExecutionResults(
          Object.keys(filters).length > 0 ? filters : undefined,
        );

        // All returned summaries must satisfy all applied filters
        for (const summary of summaries) {
          if (filters.dateFrom) {
            expect(summary.executedAt >= filters.dateFrom).toBe(true);
          }
          if (filters.dateTo) {
            expect(summary.executedAt <= filters.dateTo).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('no result satisfying all filters is excluded', async () => {
    // Feature: glue-data-quality-integration, Property 15: Filtrado de resultados por etapa y rango de fechas
    await fc.assert(
      fc.asyncProperty(arbFilterResultSet, arbDateFilter, async (results, dateFilter) => {
        resultStore = results.map((r) => ({
          uploadId: r.uploadId,
          ruleId: r.ruleId,
          ruleName: r.ruleName,
          ruleExpression: 'Completeness "col" >= 1.0',
          result: 'passed',
          details: JSON.stringify({
            recordsEvaluated: 100,
            recordsPassed: 100,
            recordsFailed: 0,
            compliancePercent: 100,
            message: 'OK',
          }),
          executedAt: r.executedAt,
        }));

        const service = QualityRulesService.createForTesting();
        const filters: { dateFrom?: string; dateTo?: string } = {};
        if (dateFilter.dateFrom !== undefined) filters.dateFrom = dateFilter.dateFrom;
        if (dateFilter.dateTo !== undefined) filters.dateTo = dateFilter.dateTo;

        const summaries = await service.getExecutionResults(
          Object.keys(filters).length > 0 ? filters : undefined,
        );

        const returnedUploadIds = new Set(summaries.map((s) => s.uploadId));

        // Every result that should match the filters must be returned
        for (const r of results) {
          let shouldMatch = true;
          if (filters.dateFrom && r.executedAt < filters.dateFrom) shouldMatch = false;
          if (filters.dateTo && r.executedAt > filters.dateTo) shouldMatch = false;

          if (shouldMatch) {
            expect(returnedUploadIds.has(r.uploadId)).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

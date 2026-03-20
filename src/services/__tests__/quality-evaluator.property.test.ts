/**
 * Property-based tests for the quality-evaluator Lambda helper functions.
 *
 * Tests mapGlueResult, buildSummary, determineSeverity, and result detail
 * field invariants using fast-check with Vitest.
 *
 * The pure helper functions are imported from a thin re-export module that
 * isolates them from the AWS SDK dependencies in the Lambda handler.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  mapGlueResult,
  determineSeverity,
  buildSummary,
} from '../../../amplify/functions/quality-evaluator/quality-evaluator-helpers';
import type {
  GlueRuleResult,
  QualityResultRecord,
  AlertSeverity,
} from '../../../amplify/functions/quality-evaluator/quality-evaluator-helpers';

// ─── Shared Arbitraries ──────────────────────────────────────────

/** Non-empty trimmed string for IDs and names. */
const arbNonEmptyStr = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

/** ISO timestamp string. */
const arbIsoTimestamp = fc
  .integer({ min: new Date('2020-01-01').getTime(), max: new Date('2030-01-01').getTime() })
  .map((ms) => new Date(ms).toISOString());

/** Non-negative integer for record counts. */
const arbCount = fc.nat({ max: 100_000 });

/** Glue outcome string: "PASS" or "FAIL". */
const arbGlueOutcome = fc.constantFrom('PASS', 'FAIL');

// ─── Property 9: Mapeo de resultados Glue a QualityResultRecord ──

describe('Property 9: Mapeo de resultados Glue a QualityResultRecord', () => {
  // Feature: glue-data-quality-integration, Property 9: Mapeo de resultados Glue a QualityResultRecord
  // **Validates: Requirement 3.5**

  /**
   * Arbitrary for a Glue rule result with explicit passed/failed counts.
   * Generates evaluatedCount > 0 with passedCount + failedCount == evaluatedCount.
   */
  const arbGlueResultWithCounts = fc
    .record({
      outcome: arbGlueOutcome,
      passedCount: arbCount,
      failedCount: arbCount,
      message: arbNonEmptyStr,
    })
    .map(({ outcome, passedCount, failedCount, message }) => {
      const evaluatedCount = passedCount + failedCount;
      const glueResult: GlueRuleResult = {
        Name: 'test-rule',
        Result: outcome,
        EvaluatedMetrics: {
          'Dataset.*.RowCount': evaluatedCount,
          'Dataset.*.PassedCount': passedCount,
          'Dataset.*.FailedCount': failedCount,
        },
        EvaluationMessage: message,
      };
      return { glueResult, passedCount, failedCount, evaluatedCount };
    });

  it('result is "passed" when Glue outcome is PASS, "failed" when FAIL', () => {
    // Feature: glue-data-quality-integration, Property 9: Mapeo de resultados Glue a QualityResultRecord
    fc.assert(
      fc.property(
        arbGlueResultWithCounts,
        arbNonEmptyStr,
        arbNonEmptyStr,
        arbNonEmptyStr,
        arbNonEmptyStr,
        arbIsoTimestamp,
        ({ glueResult }, ruleId, ruleName, ruleExpr, uploadId, ts) => {
          const record = mapGlueResult(glueResult, ruleId, ruleName, ruleExpr, uploadId, ts);

          const expectedResult = glueResult.Result === 'PASS' ? 'passed' : 'failed';
          expect(record.result).toBe(expectedResult);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('recordsEvaluated equals evaluatedCount from metrics', () => {
    // Feature: glue-data-quality-integration, Property 9: Mapeo de resultados Glue a QualityResultRecord
    fc.assert(
      fc.property(
        arbGlueResultWithCounts,
        arbNonEmptyStr,
        arbNonEmptyStr,
        arbNonEmptyStr,
        arbNonEmptyStr,
        arbIsoTimestamp,
        ({ glueResult, evaluatedCount }, ruleId, ruleName, ruleExpr, uploadId, ts) => {
          const record = mapGlueResult(glueResult, ruleId, ruleName, ruleExpr, uploadId, ts);
          expect(record.details.recordsEvaluated).toBe(evaluatedCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('recordsPassed equals passedCount and recordsFailed equals failedCount', () => {
    // Feature: glue-data-quality-integration, Property 9: Mapeo de resultados Glue a QualityResultRecord
    fc.assert(
      fc.property(
        arbGlueResultWithCounts,
        arbNonEmptyStr,
        arbNonEmptyStr,
        arbNonEmptyStr,
        arbNonEmptyStr,
        arbIsoTimestamp,
        ({ glueResult, passedCount, failedCount }, ruleId, ruleName, ruleExpr, uploadId, ts) => {
          const record = mapGlueResult(glueResult, ruleId, ruleName, ruleExpr, uploadId, ts);
          expect(record.details.recordsPassed).toBe(passedCount);
          expect(record.details.recordsFailed).toBe(failedCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('compliancePercent equals (passedCount / evaluatedCount) * 100 when evaluatedCount > 0', () => {
    // Feature: glue-data-quality-integration, Property 9: Mapeo de resultados Glue a QualityResultRecord
    const arbNonZeroCounts = arbGlueResultWithCounts.filter(
      ({ evaluatedCount }) => evaluatedCount > 0,
    );

    fc.assert(
      fc.property(
        arbNonZeroCounts,
        arbNonEmptyStr,
        arbNonEmptyStr,
        arbNonEmptyStr,
        arbNonEmptyStr,
        arbIsoTimestamp,
        ({ glueResult, passedCount, evaluatedCount }, ruleId, ruleName, ruleExpr, uploadId, ts) => {
          const record = mapGlueResult(glueResult, ruleId, ruleName, ruleExpr, uploadId, ts);
          const expected = (passedCount / evaluatedCount) * 100;
          expect(record.details.compliancePercent).toBeCloseTo(expected, 10);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 10: Invariante de conteos en resumen de ejecución ──

describe('Property 10: Invariante de conteos en resumen de ejecución', () => {
  // Feature: glue-data-quality-integration, Property 10: Invariante de conteos en resumen de ejecución
  // **Validates: Requirement 3.7**

  /** Arbitrary for a minimal QualityResultRecord with a given result status. */
  const arbResultRecord = fc
    .record({
      ruleId: arbNonEmptyStr,
      ruleName: arbNonEmptyStr,
      result: fc.constantFrom('passed' as const, 'failed' as const),
      compliancePercent: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
      recordsEvaluated: arbCount,
      message: arbNonEmptyStr,
    })
    .map(({ ruleId, ruleName, result, compliancePercent, recordsEvaluated, message }) => {
      const recordsPassed = result === 'passed' ? recordsEvaluated : 0;
      const recordsFailed = result === 'failed' ? recordsEvaluated : 0;
      return {
        uploadId: 'upload-1',
        ruleId,
        ruleName,
        ruleExpression: 'Completeness "col" >= 0.9',
        result,
        details: {
          recordsEvaluated,
          recordsPassed,
          recordsFailed,
          compliancePercent,
          message,
        },
        executedAt: '2024-01-01T00:00:00Z',
      } as QualityResultRecord;
    });

  /** Arbitrary for an array of result records (0..20). */
  const arbResults = fc.array(arbResultRecord, { minLength: 0, maxLength: 20 });

  it('passed + failed equals totalRules', () => {
    // Feature: glue-data-quality-integration, Property 10: Invariante de conteos en resumen de ejecución
    fc.assert(
      fc.property(arbResults, arbIsoTimestamp, (results, ts) => {
        const summary = buildSummary('upload-1', 'geopos_local', results, ts);
        expect(summary.passed + summary.failed).toBe(summary.totalRules);
      }),
      { numRuns: 100 },
    );
  });

  it('totalRules equals results.length', () => {
    // Feature: glue-data-quality-integration, Property 10: Invariante de conteos en resumen de ejecución
    fc.assert(
      fc.property(arbResults, arbIsoTimestamp, (results, ts) => {
        const summary = buildSummary('upload-1', 'geopos_local', results, ts);
        expect(summary.totalRules).toBe(results.length);
      }),
      { numRuns: 100 },
    );
  });

  it('passed count matches number of individual results with result "passed"', () => {
    // Feature: glue-data-quality-integration, Property 10: Invariante de conteos en resumen de ejecución
    fc.assert(
      fc.property(arbResults, arbIsoTimestamp, (results, ts) => {
        const summary = buildSummary('upload-1', 'geopos_local', results, ts);
        const expectedPassed = results.filter((r) => r.result === 'passed').length;
        expect(summary.passed).toBe(expectedPassed);
      }),
      { numRuns: 100 },
    );
  });

  it('failed count matches number of individual results with result "failed"', () => {
    // Feature: glue-data-quality-integration, Property 10: Invariante de conteos en resumen de ejecución
    fc.assert(
      fc.property(arbResults, arbIsoTimestamp, (results, ts) => {
        const summary = buildSummary('upload-1', 'geopos_local', results, ts);
        const expectedFailed = results.filter((r) => r.result === 'failed').length;
        expect(summary.failed).toBe(expectedFailed);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11: Determinación de severidad de alertas ──────────

describe('Property 11: Determinación de severidad de alertas', () => {
  // Feature: glue-data-quality-integration, Property 11: Determinación de severidad de alertas
  // **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

  /** Arbitrary for compliance percentage in [0, 100]. */
  const arbCompliancePercent = fc.double({
    min: 0,
    max: 100,
    noNaN: true,
    noDefaultInfinity: true,
  });

  it('returns "critical" when compliance < 25%', () => {
    // Feature: glue-data-quality-integration, Property 11: Determinación de severidad de alertas
    const arbLow = fc.double({ min: 0, max: 24.999999, noNaN: true, noDefaultInfinity: true });
    fc.assert(
      fc.property(arbLow, (pct) => {
        expect(determineSeverity(pct)).toBe('critical');
      }),
      { numRuns: 100 },
    );
  });

  it('returns "high" when compliance >= 25% and < 50%', () => {
    // Feature: glue-data-quality-integration, Property 11: Determinación de severidad de alertas
    const arbMid = fc.double({ min: 25, max: 49.999999, noNaN: true, noDefaultInfinity: true });
    fc.assert(
      fc.property(arbMid, (pct) => {
        expect(determineSeverity(pct)).toBe('high');
      }),
      { numRuns: 100 },
    );
  });

  it('returns "medium" when compliance >= 50% and < 75%', () => {
    // Feature: glue-data-quality-integration, Property 11: Determinación de severidad de alertas
    const arbMedHigh = fc.double({ min: 50, max: 74.999999, noNaN: true, noDefaultInfinity: true });
    fc.assert(
      fc.property(arbMedHigh, (pct) => {
        expect(determineSeverity(pct)).toBe('medium');
      }),
      { numRuns: 100 },
    );
  });

  it('returns "low" when compliance >= 75%', () => {
    // Feature: glue-data-quality-integration, Property 11: Determinación de severidad de alertas
    const arbHigh = fc.double({ min: 75, max: 100, noNaN: true, noDefaultInfinity: true });
    fc.assert(
      fc.property(arbHigh, (pct) => {
        expect(determineSeverity(pct)).toBe('low');
      }),
      { numRuns: 100 },
    );
  });

  it('severity covers the full [0, 100] range without gaps', () => {
    // Feature: glue-data-quality-integration, Property 11: Determinación de severidad de alertas
    fc.assert(
      fc.property(arbCompliancePercent, (pct) => {
        const severity = determineSeverity(pct);
        const validSeverities: AlertSeverity[] = ['critical', 'high', 'medium', 'low'];
        expect(validSeverities).toContain(severity);
      }),
      { numRuns: 100 },
    );
  });

  it('for any failed rule, exactly one alert is generated in the summary', () => {
    // Feature: glue-data-quality-integration, Property 11: Determinación de severidad de alertas

    /** Arbitrary for a failed QualityResultRecord. */
    const arbFailedRecord = fc
      .record({
        ruleId: arbNonEmptyStr,
        ruleName: arbNonEmptyStr,
        compliancePercent: arbCompliancePercent,
        recordsEvaluated: arbCount,
        message: arbNonEmptyStr,
      })
      .map(({ ruleId, ruleName, compliancePercent, recordsEvaluated, message }) => ({
        uploadId: 'upload-1',
        ruleId,
        ruleName,
        ruleExpression: 'Completeness "col" >= 0.9',
        result: 'failed' as const,
        details: {
          recordsEvaluated,
          recordsPassed: 0,
          recordsFailed: recordsEvaluated,
          compliancePercent,
          message,
        },
        executedAt: '2024-01-01T00:00:00Z',
      }));

    /** Mix of passed and failed records. */
    const arbMixedResults = fc.array(
      fc.oneof(
        arbFailedRecord,
        arbFailedRecord.map((r) => ({
          ...r,
          result: 'passed' as const,
          details: { ...r.details, compliancePercent: 100 },
        })),
      ),
      { minLength: 1, maxLength: 15 },
    );

    fc.assert(
      fc.property(arbMixedResults, arbIsoTimestamp, (results, ts) => {
        const summary = buildSummary('upload-1', 'geopos_local', results, ts);
        const failedCount = results.filter((r) => r.result === 'failed').length;
        expect(summary.alerts.length).toBe(failedCount);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 16: Detalles de resultado contienen campos requeridos ──

describe('Property 16: Detalles de resultado contienen campos requeridos', () => {
  // Feature: glue-data-quality-integration, Property 16: Detalles de resultado contienen campos requeridos
  // **Validates: Requirement 7.3**

  /**
   * Arbitrary for a Glue result with explicit metrics, producing a full
   * QualityResultRecord via mapGlueResult.
   */
  const arbMappedRecord = fc
    .record({
      outcome: arbGlueOutcome,
      passedCount: arbCount,
      failedCount: arbCount,
      message: arbNonEmptyStr,
      ruleId: arbNonEmptyStr,
      ruleName: arbNonEmptyStr,
      ruleExpr: arbNonEmptyStr,
      uploadId: arbNonEmptyStr,
      ts: arbIsoTimestamp,
    })
    .map(({ outcome, passedCount, failedCount, message, ruleId, ruleName, ruleExpr, uploadId, ts }) => {
      const evaluatedCount = passedCount + failedCount;
      const glueResult: GlueRuleResult = {
        Name: ruleName,
        Result: outcome,
        EvaluatedMetrics: {
          'Dataset.*.RowCount': evaluatedCount,
          'Dataset.*.PassedCount': passedCount,
          'Dataset.*.FailedCount': failedCount,
        },
        EvaluationMessage: message,
      };
      return { record: mapGlueResult(glueResult, ruleId, ruleName, ruleExpr, uploadId, ts), ruleName };
    });

  it('ruleName is non-empty', () => {
    // Feature: glue-data-quality-integration, Property 16: Detalles de resultado contienen campos requeridos
    fc.assert(
      fc.property(arbMappedRecord, ({ record }) => {
        expect(record.ruleName.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('result is "passed" or "failed"', () => {
    // Feature: glue-data-quality-integration, Property 16: Detalles de resultado contienen campos requeridos
    fc.assert(
      fc.property(arbMappedRecord, ({ record }) => {
        expect(['passed', 'failed']).toContain(record.result);
      }),
      { numRuns: 100 },
    );
  });

  it('recordsEvaluated is >= 0', () => {
    // Feature: glue-data-quality-integration, Property 16: Detalles de resultado contienen campos requeridos
    fc.assert(
      fc.property(arbMappedRecord, ({ record }) => {
        expect(record.details.recordsEvaluated).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });

  it('compliancePercent is between 0 and 100 (inclusive)', () => {
    // Feature: glue-data-quality-integration, Property 16: Detalles de resultado contienen campos requeridos
    fc.assert(
      fc.property(arbMappedRecord, ({ record }) => {
        expect(record.details.compliancePercent).toBeGreaterThanOrEqual(0);
        expect(record.details.compliancePercent).toBeLessThanOrEqual(100);
      }),
      { numRuns: 100 },
    );
  });

  it('message is non-empty', () => {
    // Feature: glue-data-quality-integration, Property 16: Detalles de resultado contienen campos requeridos
    fc.assert(
      fc.property(arbMappedRecord, ({ record }) => {
        expect(record.details.message.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

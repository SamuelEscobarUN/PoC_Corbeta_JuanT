/**
 * Property-based tests for dqdl-translator module.
 *
 * Uses fast-check with Vitest to verify universal properties
 * of the DQDL translation logic.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { translateSingleRule } from '../dqdl-translator';
import type { QualityRule } from '../../types/quality';

// ─── Helpers ─────────────────────────────────────────────────────

/** Builds a valid QualityRule with the given overrides. */
function makeRule(overrides: Partial<QualityRule>): QualityRule {
  return {
    ruleId: 'prop-r1',
    ruleName: 'Prop Rule',
    stage: 'geopos_local',
    type: 'completeness',
    expression: '',
    targetColumn: 'col',
    threshold: 0.95,
    enabled: true,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Arbitrary for non-empty column names that don't contain double quotes
 * (quotes would break DQDL quoting).
 */
const arbColumnName = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0 && !s.includes('"') && !s.includes('\n') && !s.includes('\r'));

/** Arbitrary for valid thresholds between 0 and 1 (inclusive). */
const arbThreshold = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

/** Arbitrary for valid range min/max pairs where min <= max. */
const arbRange = fc
  .tuple(
    fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  )
  .map(([a, b]) => (a <= b ? { min: a, max: b } : { min: b, max: a }));

/**
 * Arbitrary for simple regex patterns that are valid JS RegExp.
 * We use a constrained set to avoid generating invalid regex.
 */
const arbRegexPattern = fc.constantFrom(
  '.*',
  '^\\d+$',
  '^[A-Z]+$',
  '[a-z0-9]+',
  '^INV-\\d{4}$',
  '\\w+@\\w+\\.\\w+',
  '^\\d{2}/\\d{2}/\\d{4}$',
  '[0-9]{3}-[0-9]{4}',
);

/**
 * Arbitrary for non-empty custom DQDL expressions.
 * Uses realistic DQDL-like expressions.
 */
const arbCustomExpression = fc.constantFrom(
  'RowCount > 0',
  'RowCount between 1 and 1000000',
  'IsComplete "id"',
  'IsPrimaryKey "ruleId"',
  'IsUnique "barcode"',
  'Completeness "x" >= 0.5',
);

// ─── Property 4: Traducción de tipo de regla a formato DQDL ─────

describe('Property 4: Traducción de tipo de regla a formato DQDL', () => {
  // Feature: glue-data-quality-integration, Property 4: Traducción de tipo de regla a formato DQDL
  // **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

  it('completeness rules produce Completeness "<col>" >= <threshold>', () => {
    // Feature: glue-data-quality-integration, Property 4: Traducción de tipo de regla a formato DQDL
    fc.assert(
      fc.property(arbColumnName, arbThreshold, (column, threshold) => {
        const rule = makeRule({
          type: 'completeness',
          targetColumn: column,
          threshold,
        });
        const result = translateSingleRule(rule);

        // Must match: Completeness "column" >= threshold
        expect(result).toBe(`Completeness "${column}" >= ${threshold}`);
      }),
      { numRuns: 100 },
    );
  });

  it('uniqueness rules produce Uniqueness "<col>" >= <threshold>', () => {
    // Feature: glue-data-quality-integration, Property 4: Traducción de tipo de regla a formato DQDL
    fc.assert(
      fc.property(arbColumnName, arbThreshold, (column, threshold) => {
        const rule = makeRule({
          type: 'uniqueness',
          targetColumn: column,
          threshold,
        });
        const result = translateSingleRule(rule);

        // Must match: Uniqueness "column" >= threshold
        expect(result).toBe(`Uniqueness "${column}" >= ${threshold}`);
      }),
      { numRuns: 100 },
    );
  });

  it('range rules produce ColumnValues "<col>" between <min> and <max>', () => {
    // Feature: glue-data-quality-integration, Property 4: Traducción de tipo de regla a formato DQDL
    fc.assert(
      fc.property(arbColumnName, arbRange, (column, { min, max }) => {
        const rule = makeRule({
          type: 'range',
          targetColumn: column,
          expression: `${min},${max}`,
        });
        const result = translateSingleRule(rule);

        // Must match: ColumnValues "column" between min and max
        expect(result).toBe(`ColumnValues "${column}" between ${min} and ${max}`);
      }),
      { numRuns: 100 },
    );
  });

  it('format rules produce ColumnValues "<col>" matches "<regex>"', () => {
    // Feature: glue-data-quality-integration, Property 4: Traducción de tipo de regla a formato DQDL
    fc.assert(
      fc.property(arbColumnName, arbRegexPattern, (column, regex) => {
        const rule = makeRule({
          type: 'format',
          targetColumn: column,
          expression: regex,
        });
        const result = translateSingleRule(rule);

        // Must match: ColumnValues "column" matches "regex"
        expect(result).toBe(`ColumnValues "${column}" matches "${regex}"`);
      }),
      { numRuns: 100 },
    );
  });

  it('custom rules output the input expression unchanged', () => {
    // Feature: glue-data-quality-integration, Property 4: Traducción de tipo de regla a formato DQDL
    fc.assert(
      fc.property(arbCustomExpression, (expression) => {
        const rule = makeRule({
          type: 'custom',
          expression,
        });
        const result = translateSingleRule(rule);

        // Custom expression must be passed through identically
        expect(result).toBe(expression);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Imports for Property 5 ──────────────────────────────────────

import { translateRulesToDqdl } from '../dqdl-translator';

// ─── Property 5: Estructura de Ruleset DQDL ─────────────────────

describe('Property 5: Estructura de Ruleset DQDL', () => {
  // Feature: glue-data-quality-integration, Property 5: Estructura de Ruleset DQDL
  // **Validates: Requirements 2.6**

  /**
   * Arbitrary that generates a valid QualityRule guaranteed to translate
   * successfully (no error path). We pick from the four "structured" types
   * plus custom with a known-good expression.
   */
  const arbValidRule = fc
    .record({
      ruleId: fc.uuid(),
      ruleName: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
      column: arbColumnName,
      threshold: arbThreshold,
      range: arbRange,
      regex: arbRegexPattern,
      customExpr: arbCustomExpression,
      ruleType: fc.constantFrom(
        'completeness' as const,
        'uniqueness' as const,
        'range' as const,
        'format' as const,
        'custom' as const,
      ),
    })
    .map(({ ruleId, ruleName, column, threshold, range, regex, customExpr, ruleType }) => {
      const base = {
        ruleId,
        ruleName,
        stage: 'geopos_local' as const,
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
      };

      switch (ruleType) {
        case 'completeness':
          return { ...base, type: ruleType, targetColumn: column, threshold, expression: '' };
        case 'uniqueness':
          return { ...base, type: ruleType, targetColumn: column, threshold, expression: '' };
        case 'range':
          return {
            ...base,
            type: ruleType,
            targetColumn: column,
            threshold: 1.0,
            expression: `${range.min},${range.max}`,
          };
        case 'format':
          return {
            ...base,
            type: ruleType,
            targetColumn: column,
            threshold: 1.0,
            expression: regex,
          };
        case 'custom':
          return { ...base, type: ruleType, threshold: 1.0, expression: customExpr };
      }
    }) as fc.Arbitrary<import('../../types/quality').QualityRule>;

  /** Arbitrary for a non-empty array of valid rules (1..10). */
  const arbNonEmptyRules = fc.array(arbValidRule, { minLength: 1, maxLength: 10 });

  it('ruleset starts with "Rules = [" and ends with "]"', () => {
    // Feature: glue-data-quality-integration, Property 5: Estructura de Ruleset DQDL
    fc.assert(
      fc.property(arbNonEmptyRules, (rules) => {
        const { ruleset } = translateRulesToDqdl(rules);
        const trimmed = ruleset.trim();

        expect(trimmed.startsWith('Rules = [')).toBe(true);
        expect(trimmed.endsWith(']')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('ruleset contains exactly one DQDL expression per rule, separated by commas', () => {
    // Feature: glue-data-quality-integration, Property 5: Estructura de Ruleset DQDL
    fc.assert(
      fc.property(arbNonEmptyRules, (rules) => {
        const { ruleset, errors } = translateRulesToDqdl(rules);

        // Number of successfully translated rules
        const successCount = rules.length - errors.length;

        // Extract the body between "Rules = [" and the closing "]"
        const bodyMatch = ruleset.match(/^Rules\s*=\s*\[\s*([\s\S]*?)\s*\]$/);
        expect(bodyMatch).not.toBeNull();

        const body = bodyMatch![1];

        if (successCount === 0) {
          // Empty body for zero successful translations
          expect(body.trim()).toBe('');
        } else {
          // Split by comma-newline (the separator used by translateRulesToDqdl)
          // Each expression is on its own line, indented with 2 spaces, separated by ",\n"
          const expressions = body.split(',\n').map((e) => e.trim()).filter((e) => e.length > 0);
          expect(expressions.length).toBe(successCount);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('each expression in the ruleset corresponds to a translated rule', () => {
    // Feature: glue-data-quality-integration, Property 5: Estructura de Ruleset DQDL
    fc.assert(
      fc.property(arbNonEmptyRules, (rules) => {
        const { ruleset, errors } = translateRulesToDqdl(rules);

        // Collect the set of ruleIds that errored
        const errorIds = new Set(errors.map((e) => e.ruleId));

        // Get individual expected expressions by translating each successful rule
        const expectedExpressions: string[] = [];
        for (const rule of rules) {
          if (!errorIds.has(rule.ruleId)) {
            // The rule translated successfully — get its expression via translateSingleRule
            const expr = translateSingleRule(rule);
            expectedExpressions.push(expr);
          }
        }

        // Extract expressions from the ruleset body
        const bodyMatch = ruleset.match(/^Rules\s*=\s*\[\s*([\s\S]*?)\s*\]$/);
        expect(bodyMatch).not.toBeNull();

        const body = bodyMatch![1];
        const actualExpressions = body
          .split(',\n')
          .map((e) => e.trim())
          .filter((e) => e.length > 0);

        // Each expression in the ruleset must match the individually translated expression
        expect(actualExpressions).toEqual(expectedExpressions);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6: Error en expresión DQDL inválida ───────────────

describe('Property 6: Error en expresión DQDL inválida', () => {
  // Feature: glue-data-quality-integration, Property 6: Error en expresión DQDL inválida
  // **Validates: Requirements 2.7**

  /** Arbitrary for rule types that require a targetColumn. */
  const arbColumnRequiredType = fc.constantFrom(
    'completeness' as const,
    'uniqueness' as const,
    'range' as const,
    'format' as const,
  );

  /** Arbitrary for a valid ruleId. */
  const arbRuleId = fc.uuid();

  /** Arbitrary for a non-empty rule name. */
  const arbRuleName = fc
    .string({ minLength: 1, maxLength: 30 })
    .filter((s) => s.trim().length > 0);

  it('rules requiring targetColumn produce an error when targetColumn is missing', () => {
    // Feature: glue-data-quality-integration, Property 6: Error en expresión DQDL inválida
    fc.assert(
      fc.property(arbRuleId, arbRuleName, arbColumnRequiredType, (ruleId, ruleName, ruleType) => {
        const rule = makeRule({
          ruleId,
          ruleName,
          type: ruleType,
          targetColumn: undefined,
          expression: ruleType === 'range' ? '0,100' : ruleType === 'format' ? '.*' : '',
        });

        const { errors } = translateRulesToDqdl([rule]);

        // Must produce exactly one error for this rule
        expect(errors.length).toBe(1);
        expect(errors[0].ruleId).toBe(ruleId);
        expect(errors[0].message.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('range rules with invalid expression format produce an error', () => {
    // Feature: glue-data-quality-integration, Property 6: Error en expresión DQDL inválida

    /** Arbitrary for strings that are NOT valid "min,max" format. */
    const arbInvalidRangeExpr = fc.oneof(
      // No comma at all
      fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes(',')),
      // Too many commas (more than one)
      fc.tuple(
        fc.string({ minLength: 1, maxLength: 5 }),
        fc.string({ minLength: 1, maxLength: 5 }),
        fc.string({ minLength: 1, maxLength: 5 }),
      ).map(([a, b, c]) => `${a},${b},${c}`),
      // Non-numeric values around a single comma
      fc.tuple(
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => isNaN(Number(s.trim()))),
        fc.string({ minLength: 1, maxLength: 10 }),
      ).map(([a, b]) => `${a},${b}`),
    );

    fc.assert(
      fc.property(arbRuleId, arbRuleName, arbColumnName, arbInvalidRangeExpr, (ruleId, ruleName, column, expr) => {
        const rule = makeRule({
          ruleId,
          ruleName,
          type: 'range',
          targetColumn: column,
          expression: expr,
        });

        const { errors } = translateRulesToDqdl([rule]);

        // Must produce exactly one error for this rule
        expect(errors.length).toBe(1);
        expect(errors[0].ruleId).toBe(ruleId);
        expect(errors[0].message.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('custom rules with empty expression produce an error', () => {
    // Feature: glue-data-quality-integration, Property 6: Error en expresión DQDL inválida

    /** Arbitrary for empty or whitespace-only strings. */
    const arbEmptyExpression = fc.constantFrom('', '   ', '\t', '\n', '  \t\n  ');

    fc.assert(
      fc.property(arbRuleId, arbRuleName, arbEmptyExpression, (ruleId, ruleName, expr) => {
        const rule = makeRule({
          ruleId,
          ruleName,
          type: 'custom',
          expression: expr,
        });

        const { errors } = translateRulesToDqdl([rule]);

        // Must produce exactly one error for this rule
        expect(errors.length).toBe(1);
        expect(errors[0].ruleId).toBe(ruleId);
        expect(errors[0].message.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Imports for Property 7 ──────────────────────────────────────

import { parseDqdlRuleset } from '../dqdl-translator';

// ─── Property 7: Round-trip de traducción DQDL ──────────────────

describe('Property 7: Round-trip de traducción DQDL', () => {
  // Feature: glue-data-quality-integration, Property 7: Round-trip de traducción DQDL
  // **Validates: Requirements 2.8**

  /**
   * Arbitrary for non-negative range values that survive the
   * Number → String → regex([\d.]+) → String round-trip.
   */
  const arbNonNegativeNum = fc
    .double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true })
    .filter((n) => {
      const s = String(n);
      return /^[\d.]+$/.test(s);
    });

  /** Arbitrary for non-negative range pairs where min <= max. */
  const arbNonNegRange = fc
    .tuple(arbNonNegativeNum, arbNonNegativeNum)
    .map(([a, b]) => (a <= b ? { min: a, max: b } : { min: b, max: a }));

  /**
   * Arbitrary for thresholds that round-trip cleanly through
   * `${threshold}` → parseFloat().
   */
  const arbRoundTripThreshold = fc
    .double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })
    .filter((n) => {
      const s = String(n);
      return /^[\d.]+$/.test(s) && parseFloat(s) === n;
    });

  /**
   * Custom expressions that do NOT match any structured DQDL pattern
   * (completeness, uniqueness, range, format). This ensures the parser
   * won't re-classify them as a structured type during round-trip.
   */
  const arbSafeCustomExpression = fc.constantFrom(
    'RowCount > 0',
    'RowCount between 1 and 1000000',
    'IsComplete "id"',
    'IsPrimaryKey "ruleId"',
    'IsUnique "barcode"',
  );

  /**
   * Arbitrary that generates a valid QualityRule guaranteed to
   * round-trip through translate → parse correctly.
   */
  const arbRoundTripRule = fc
    .record({
      ruleId: fc.uuid(),
      ruleName: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
      column: arbColumnName,
      threshold: arbRoundTripThreshold,
      range: arbNonNegRange,
      regex: arbRegexPattern,
      customExpr: arbSafeCustomExpression,
      ruleType: fc.constantFrom(
        'completeness' as const,
        'uniqueness' as const,
        'range' as const,
        'format' as const,
        'custom' as const,
      ),
    })
    .map(({ ruleId, ruleName, column, threshold, range, regex, customExpr, ruleType }) => {
      const base = {
        ruleId,
        ruleName,
        stage: 'geopos_local' as const,
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
      };

      switch (ruleType) {
        case 'completeness':
          return { ...base, type: ruleType, targetColumn: column, threshold, expression: '' };
        case 'uniqueness':
          return { ...base, type: ruleType, targetColumn: column, threshold, expression: '' };
        case 'range':
          return {
            ...base,
            type: ruleType,
            targetColumn: column,
            threshold: 1.0,
            expression: `${range.min},${range.max}`,
          };
        case 'format':
          return {
            ...base,
            type: ruleType,
            targetColumn: column,
            threshold: 1.0,
            expression: regex,
          };
        case 'custom':
          return { ...base, type: ruleType, threshold: 1.0, expression: customExpr };
      }
    }) as fc.Arbitrary<import('../../types/quality').QualityRule>;

  /** Arbitrary for a non-empty array of valid round-trip rules (1..10). */
  const arbRoundTripRules = fc.array(arbRoundTripRule, { minLength: 1, maxLength: 10 });

  it('translating rules to DQDL and parsing back preserves type, targetColumn, threshold, and expression for each rule', () => {
    // Feature: glue-data-quality-integration, Property 7: Round-trip de traducción DQDL
    fc.assert(
      fc.property(arbRoundTripRules, (rules) => {
        // Translate to DQDL
        const { ruleset, errors } = translateRulesToDqdl(rules);

        // All rules should translate without errors
        expect(errors).toHaveLength(0);

        // Parse back
        const parsed = parseDqdlRuleset(ruleset);

        // Must have the same number of rules
        expect(parsed).toHaveLength(rules.length);

        // Each parsed rule must match the original on key fields
        for (let i = 0; i < rules.length; i++) {
          const original = rules[i];
          const roundTripped = parsed[i];

          // Type must match
          expect(roundTripped.type).toBe(original.type);

          // targetColumn must match (for types that have it)
          if (original.type !== 'custom') {
            expect(roundTripped.targetColumn).toBe(original.targetColumn);
          }

          // threshold must match for completeness/uniqueness
          if (original.type === 'completeness' || original.type === 'uniqueness') {
            expect(roundTripped.threshold).toBe(original.threshold);
          }

          // expression must match for range/format/custom
          if (original.type === 'range' || original.type === 'format' || original.type === 'custom') {
            expect(roundTripped.expression).toBe(original.expression);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});


// ─── Imports for Property 12 ─────────────────────────────────────

import { validateDqdlExpression, generateBaseExpression } from '../dqdl-translator';

// ─── Property 12: Validación DQDL rechaza expresiones inválidas ──

describe('Property 12: Validación DQDL rechaza expresiones inválidas', () => {
  // Feature: glue-data-quality-integration, Property 12: Validación DQDL rechaza expresiones inválidas
  // **Validates: Requirements 6.1**

  it('empty strings and whitespace-only strings are rejected', () => {
    // Feature: glue-data-quality-integration, Property 12: Validación DQDL rechaza expresiones inválidas
    const arbWhitespace = fc.constantFrom('', ' ', '  ', '\t', '\n', '\r', '  \t\n  ', '   \r\n   ');

    fc.assert(
      fc.property(arbWhitespace, (ws) => {
        const result = validateDqdlExpression(ws);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('random strings that do not match any DQDL pattern are rejected', () => {
    // Feature: glue-data-quality-integration, Property 12: Validación DQDL rechaza expresiones inválidas

    /**
     * Arbitrary for random strings that are unlikely to match valid DQDL.
     * We filter out strings that could accidentally match a valid pattern.
     */
    const arbInvalidString = fc
      .string({ minLength: 1, maxLength: 80 })
      .filter((s) => {
        const t = s.trim();
        if (t.length === 0) return false; // covered by whitespace test
        // Exclude anything that starts with a known DQDL keyword
        const keywords = /^(Completeness|Uniqueness|ColumnValues|RowCount|IsComplete|IsPrimaryKey|IsUnique)\s/i;
        return !keywords.test(t);
      });

    fc.assert(
      fc.property(arbInvalidString, (expr) => {
        const result = validateDqdlExpression(expr);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('strings starting with valid keywords but with wrong syntax are rejected', () => {
    // Feature: glue-data-quality-integration, Property 12: Validación DQDL rechaza expresiones inválidas

    /**
     * Generates expressions that start with a valid DQDL keyword but have
     * incorrect syntax (missing arguments, wrong format, etc.).
     */
    const arbMalformedExpression = fc.oneof(
      // Keyword alone with no arguments
      fc.constantFrom(
        'Completeness',
        'Uniqueness',
        'ColumnValues',
      ),
      // Completeness without proper >= threshold
      fc.tuple(arbColumnName).map(([col]) => `Completeness "${col}"`),
      // Completeness with wrong operator
      fc.tuple(arbColumnName, arbThreshold).map(([col, t]) => `Completeness "${col}" <= ${t}`),
      // Uniqueness without threshold
      fc.tuple(arbColumnName).map(([col]) => `Uniqueness "${col}"`),
      // ColumnValues without between/matches clause
      fc.tuple(arbColumnName).map(([col]) => `ColumnValues "${col}"`),
      // ColumnValues with "between" but missing "and"
      fc.tuple(arbColumnName, fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }))
        .map(([col, n]) => `ColumnValues "${col}" between ${n}`),
      // ColumnValues with "matches" but no quoted regex
      fc.tuple(arbColumnName).map(([col]) => `ColumnValues "${col}" matches`),
    );

    fc.assert(
      fc.property(arbMalformedExpression, (expr) => {
        const result = validateDqdlExpression(expr);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});


// ─── Property 13: Generación de expresión DQDL base por tipo ─────

describe('Property 13: Generación de expresión DQDL base por tipo', () => {
  // Feature: glue-data-quality-integration, Property 13: Generación de expresión DQDL base por tipo
  // **Validates: Requirements 6.4**

  /** Arbitrary for the four structured rule types that generate base expressions. */
  const arbStructuredType = fc.constantFrom(
    'completeness' as const,
    'uniqueness' as const,
    'range' as const,
    'format' as const,
  );

  /**
   * Arbitrary for non-empty column names that don't contain double quotes
   * (quotes would break DQDL quoting).
   */
  const arbColName = fc
    .string({ minLength: 1, maxLength: 50 })
    .filter((s) => s.trim().length > 0 && !s.includes('"') && !s.includes('\n') && !s.includes('\r'));

  it('generates a non-empty, syntactically valid DQDL expression for any structured type and non-empty column', () => {
    // Feature: glue-data-quality-integration, Property 13: Generación de expresión DQDL base por tipo
    fc.assert(
      fc.property(arbStructuredType, arbColName, (ruleType, column) => {
        const expr = generateBaseExpression(ruleType, column);

        // Must produce a non-empty string
        expect(expr.length).toBeGreaterThan(0);
        expect(expr.trim().length).toBeGreaterThan(0);

        // Must be syntactically valid according to the DQDL validator
        const validation = validateDqdlExpression(expr);
        expect(validation.valid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

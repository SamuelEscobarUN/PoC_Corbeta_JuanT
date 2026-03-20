/**
 * Unit tests for dqdl-translator module.
 *
 * Tests translation of quality rules to DQDL syntax,
 * validation, parsing, and error handling.
 */

import { describe, it, expect } from 'vitest';
import {
  translateSingleRule,
  translateRulesToDqdl,
  validateDqdlExpression,
  parseDqdlRuleset,
  generateBaseExpression,
} from './dqdl-translator';
import type { QualityRule } from '../types/quality';

// ─── Helpers ─────────────────────────────────────────────────────

function makeRule(overrides: Partial<QualityRule>): QualityRule {
  return {
    ruleId: 'r1',
    ruleName: 'Test Rule',
    stage: 'geopos_local',
    type: 'completeness',
    expression: '',
    targetColumn: 'invoice',
    threshold: 0.95,
    enabled: true,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ─── translateSingleRule ─────────────────────────────────────────

describe('translateSingleRule', () => {
  it('translates completeness rule', () => {
    const rule = makeRule({ type: 'completeness', targetColumn: 'invoice', threshold: 0.95 });
    expect(translateSingleRule(rule)).toBe('Completeness "invoice" >= 0.95');
  });

  it('translates uniqueness rule', () => {
    const rule = makeRule({ type: 'uniqueness', targetColumn: 'barcode', threshold: 1.0 });
    expect(translateSingleRule(rule)).toBe('Uniqueness "barcode" >= 1');
  });

  it('translates range rule', () => {
    const rule = makeRule({
      type: 'range',
      targetColumn: 'total',
      expression: '0,1000',
    });
    expect(translateSingleRule(rule)).toBe('ColumnValues "total" between 0 and 1000');
  });

  it('translates format rule', () => {
    const rule = makeRule({
      type: 'format',
      targetColumn: 'invoice',
      expression: '^INV-\\d+$',
    });
    expect(translateSingleRule(rule)).toBe('ColumnValues "invoice" matches "^INV-\\d+$"');
  });

  it('passes custom expression through', () => {
    const rule = makeRule({
      type: 'custom',
      expression: 'RowCount > 0',
    });
    expect(translateSingleRule(rule)).toBe('RowCount > 0');
  });

  // ─── Error cases ───

  it('throws when completeness rule has no targetColumn', () => {
    const rule = makeRule({ type: 'completeness', targetColumn: undefined });
    expect(() => translateSingleRule(rule)).toThrow('targetColumn es requerida');
  });

  it('throws when uniqueness rule has no targetColumn', () => {
    const rule = makeRule({ type: 'uniqueness', targetColumn: '' });
    expect(() => translateSingleRule(rule)).toThrow('targetColumn es requerida');
  });

  it('throws when range expression is not min,max', () => {
    const rule = makeRule({ type: 'range', targetColumn: 'total', expression: 'bad' });
    expect(() => translateSingleRule(rule)).toThrow('formato de rango inválido');
  });

  it('throws when range has non-numeric values', () => {
    const rule = makeRule({ type: 'range', targetColumn: 'total', expression: 'a,b' });
    expect(() => translateSingleRule(rule)).toThrow('valores de rango no numéricos');
  });

  it('throws when range min > max', () => {
    const rule = makeRule({ type: 'range', targetColumn: 'total', expression: '100,0' });
    expect(() => translateSingleRule(rule)).toThrow('min (100) no puede ser mayor que max (0)');
  });

  it('throws when format rule has invalid regex', () => {
    const rule = makeRule({ type: 'format', targetColumn: 'col', expression: '[invalid' });
    expect(() => translateSingleRule(rule)).toThrow('regex inválida');
  });

  it('throws when custom rule has empty expression', () => {
    const rule = makeRule({ type: 'custom', expression: '' });
    expect(() => translateSingleRule(rule)).toThrow('no puede estar vacía');
  });

  it('throws when custom rule has whitespace-only expression', () => {
    const rule = makeRule({ type: 'custom', expression: '   ' });
    expect(() => translateSingleRule(rule)).toThrow('no puede estar vacía');
  });
});

// ─── translateRulesToDqdl ────────────────────────────────────────

describe('translateRulesToDqdl', () => {
  it('generates Rules = [] for empty array', () => {
    const result = translateRulesToDqdl([]);
    expect(result.ruleset).toBe('Rules = []');
    expect(result.errors).toHaveLength(0);
  });

  it('generates ruleset with single rule', () => {
    const rules = [makeRule({ type: 'completeness', targetColumn: 'col', threshold: 0.9 })];
    const result = translateRulesToDqdl(rules);
    expect(result.ruleset).toContain('Rules = [');
    expect(result.ruleset).toContain('Completeness "col" >= 0.9');
    expect(result.errors).toHaveLength(0);
  });

  it('generates ruleset with multiple rules', () => {
    const rules = [
      makeRule({ ruleId: 'r1', type: 'completeness', targetColumn: 'a', threshold: 0.9 }),
      makeRule({ ruleId: 'r2', type: 'uniqueness', targetColumn: 'b', threshold: 1.0 }),
    ];
    const result = translateRulesToDqdl(rules);
    expect(result.ruleset).toContain('Completeness "a" >= 0.9');
    expect(result.ruleset).toContain('Uniqueness "b" >= 1');
    expect(result.errors).toHaveLength(0);
  });

  it('collects errors for invalid rules and excludes them from ruleset', () => {
    const rules = [
      makeRule({ ruleId: 'r1', type: 'completeness', targetColumn: 'a', threshold: 0.9 }),
      makeRule({ ruleId: 'r2', ruleName: 'Bad Rule', type: 'completeness', targetColumn: undefined }),
    ];
    const result = translateRulesToDqdl(rules);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].ruleId).toBe('r2');
    expect(result.errors[0].message).toContain('targetColumn es requerida');
    expect(result.ruleset).toContain('Completeness "a"');
    expect(result.ruleset).not.toContain('r2');
  });
});

// ─── validateDqdlExpression ──────────────────────────────────────

describe('validateDqdlExpression', () => {
  it('accepts valid Completeness expression', () => {
    expect(validateDqdlExpression('Completeness "col" >= 0.95')).toEqual({ valid: true });
  });

  it('accepts valid Uniqueness expression', () => {
    expect(validateDqdlExpression('Uniqueness "col" >= 1.0')).toEqual({ valid: true });
  });

  it('accepts valid ColumnValues between expression', () => {
    expect(validateDqdlExpression('ColumnValues "total" between 0 and 1000')).toEqual({
      valid: true,
    });
  });

  it('accepts valid ColumnValues matches expression', () => {
    expect(validateDqdlExpression('ColumnValues "col" matches "^\\d+$"')).toEqual({
      valid: true,
    });
  });

  it('rejects empty string', () => {
    const result = validateDqdlExpression('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects random text', () => {
    const result = validateDqdlExpression('this is not dqdl');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects incomplete expression', () => {
    const result = validateDqdlExpression('Completeness');
    expect(result.valid).toBe(false);
  });
});

// ─── parseDqdlRuleset ────────────────────────────────────────────

describe('parseDqdlRuleset', () => {
  it('parses empty ruleset', () => {
    expect(parseDqdlRuleset('Rules = []')).toHaveLength(0);
  });

  it('parses completeness rule', () => {
    const dqdl = 'Rules = [\n  Completeness "invoice" >= 0.95\n]';
    const rules = parseDqdlRuleset(dqdl);
    expect(rules).toHaveLength(1);
    expect(rules[0].type).toBe('completeness');
    expect(rules[0].targetColumn).toBe('invoice');
    expect(rules[0].threshold).toBe(0.95);
  });

  it('parses uniqueness rule', () => {
    const dqdl = 'Rules = [\n  Uniqueness "barcode" >= 1.0\n]';
    const rules = parseDqdlRuleset(dqdl);
    expect(rules).toHaveLength(1);
    expect(rules[0].type).toBe('uniqueness');
    expect(rules[0].targetColumn).toBe('barcode');
  });

  it('parses range rule', () => {
    const dqdl = 'Rules = [\n  ColumnValues "total" between 0 and 1000\n]';
    const rules = parseDqdlRuleset(dqdl);
    expect(rules).toHaveLength(1);
    expect(rules[0].type).toBe('range');
    expect(rules[0].targetColumn).toBe('total');
    expect(rules[0].expression).toBe('0,1000');
  });

  it('parses format rule', () => {
    const dqdl = 'Rules = [\n  ColumnValues "col" matches "^\\d+$"\n]';
    const rules = parseDqdlRuleset(dqdl);
    expect(rules).toHaveLength(1);
    expect(rules[0].type).toBe('format');
    expect(rules[0].targetColumn).toBe('col');
    expect(rules[0].expression).toBe('^\\d+$');
  });

  it('parses custom expression', () => {
    const dqdl = 'Rules = [\n  RowCount > 0\n]';
    const rules = parseDqdlRuleset(dqdl);
    expect(rules).toHaveLength(1);
    expect(rules[0].type).toBe('custom');
    expect(rules[0].expression).toBe('RowCount > 0');
  });

  it('parses multiple rules', () => {
    const dqdl = `Rules = [
  Completeness "a" >= 0.9,
  Uniqueness "b" >= 1.0,
  ColumnValues "c" between 0 and 100
]`;
    const rules = parseDqdlRuleset(dqdl);
    expect(rules).toHaveLength(3);
    expect(rules[0].type).toBe('completeness');
    expect(rules[1].type).toBe('uniqueness');
    expect(rules[2].type).toBe('range');
  });

  it('returns empty array for invalid input', () => {
    expect(parseDqdlRuleset('not a ruleset')).toHaveLength(0);
  });
});

// ─── generateBaseExpression ──────────────────────────────────────

describe('generateBaseExpression', () => {
  it('generates completeness base expression', () => {
    const expr = generateBaseExpression('completeness', 'invoice');
    expect(expr).toBe('Completeness "invoice" >= 1.0');
    expect(validateDqdlExpression(expr).valid).toBe(true);
  });

  it('generates uniqueness base expression', () => {
    const expr = generateBaseExpression('uniqueness', 'barcode');
    expect(expr).toBe('Uniqueness "barcode" >= 1.0');
    expect(validateDqdlExpression(expr).valid).toBe(true);
  });

  it('generates range base expression', () => {
    const expr = generateBaseExpression('range', 'total');
    expect(expr).toBe('ColumnValues "total" between 0 and 100');
    expect(validateDqdlExpression(expr).valid).toBe(true);
  });

  it('generates format base expression', () => {
    const expr = generateBaseExpression('format', 'col');
    expect(expr).toBe('ColumnValues "col" matches ".*"');
    expect(validateDqdlExpression(expr).valid).toBe(true);
  });

  it('returns empty string for custom type', () => {
    expect(generateBaseExpression('custom', 'col')).toBe('');
  });
});

// ─── Round-trip: translate → parse ───────────────────────────────

describe('round-trip', () => {
  it('completeness rule survives round-trip', () => {
    const original = makeRule({ type: 'completeness', targetColumn: 'invoice', threshold: 0.95 });
    const { ruleset } = translateRulesToDqdl([original]);
    const parsed = parseDqdlRuleset(ruleset);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('completeness');
    expect(parsed[0].targetColumn).toBe('invoice');
    expect(parsed[0].threshold).toBe(0.95);
  });

  it('mixed rules survive round-trip', () => {
    const rules = [
      makeRule({ ruleId: 'r1', type: 'completeness', targetColumn: 'a', threshold: 0.9 }),
      makeRule({ ruleId: 'r2', type: 'uniqueness', targetColumn: 'b', threshold: 1.0 }),
      makeRule({ ruleId: 'r3', type: 'range', targetColumn: 'c', expression: '10,200' }),
      makeRule({ ruleId: 'r4', type: 'format', targetColumn: 'd', expression: '^[A-Z]+$' }),
    ];
    const { ruleset, errors } = translateRulesToDqdl(rules);
    expect(errors).toHaveLength(0);

    const parsed = parseDqdlRuleset(ruleset);
    expect(parsed).toHaveLength(4);
    expect(parsed[0].type).toBe('completeness');
    expect(parsed[1].type).toBe('uniqueness');
    expect(parsed[2].type).toBe('range');
    expect(parsed[2].expression).toBe('10,200');
    expect(parsed[3].type).toBe('format');
    expect(parsed[3].expression).toBe('^[A-Z]+$');
  });
});

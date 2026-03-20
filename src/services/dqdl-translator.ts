/**
 * Traductor DQDL — Módulo puro (sin dependencias AWS).
 *
 * Convierte reglas de calidad de la plataforma a sintaxis DQDL
 * (Data Quality Definition Language) de AWS Glue Data Quality.
 *
 * @module dqdl-translator
 */

import type {
  QualityRule,
  QualityRuleType,
  DqdlTranslationResult,
  DqdlError,
} from '../types/quality';

/**
 * Traduce un conjunto de reglas a un Ruleset DQDL completo.
 *
 * Genera el bloque `Rules = [ expr1, expr2, ... ]`.
 * Las reglas que fallan la traducción se reportan en `errors`
 * y se excluyen del ruleset.
 */
export function translateRulesToDqdl(rules: QualityRule[]): DqdlTranslationResult {
  const errors: DqdlError[] = [];
  const expressions: string[] = [];

  for (const rule of rules) {
    try {
      const expr = translateSingleRule(rule);
      expressions.push(expr);
    } catch (err) {
      errors.push({
        ruleId: rule.ruleId,
        ruleName: rule.ruleName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const ruleset =
    expressions.length > 0
      ? `Rules = [\n${expressions.map((e) => `  ${e}`).join(',\n')}\n]`
      : 'Rules = []';

  return { ruleset, errors };
}

/**
 * Traduce una regla individual a su expresión DQDL.
 *
 * @throws Error si la regla tiene datos inválidos (sin columna, rango mal formado, etc.)
 */
export function translateSingleRule(rule: QualityRule): string {
  const { type, targetColumn, threshold, expression } = rule;

  switch (type) {
    case 'completeness': {
      assertTargetColumn(rule);
      return `Completeness "${targetColumn}" >= ${threshold}`;
    }
    case 'uniqueness': {
      assertTargetColumn(rule);
      return `Uniqueness "${targetColumn}" >= ${threshold}`;
    }
    case 'range': {
      assertTargetColumn(rule);
      const { min, max } = parseRange(expression, rule);
      return `ColumnValues "${targetColumn}" between ${min} and ${max}`;
    }
    case 'format': {
      assertTargetColumn(rule);
      assertValidRegex(expression, rule);
      return `ColumnValues "${targetColumn}" matches "${expression}"`;
    }
    case 'custom': {
      if (!expression || expression.trim() === '') {
        throw new Error(
          `Regla "${rule.ruleName}" (${rule.ruleId}): la expresión custom no puede estar vacía`,
        );
      }
      return expression;
    }
    default:
      throw new Error(
        `Regla "${rule.ruleName}" (${rule.ruleId}): tipo de regla no soportado "${type}"`,
      );
  }
}

/**
 * Valida si una expresión DQDL es sintácticamente válida.
 *
 * Soporta las funciones DQDL principales:
 * Completeness, Uniqueness, ColumnValues (between / matches), y expresiones custom.
 */
export function validateDqdlExpression(expression: string): {
  valid: boolean;
  error?: string;
} {
  if (!expression || expression.trim() === '') {
    return { valid: false, error: 'La expresión no puede estar vacía' };
  }

  const trimmed = expression.trim();

  // Completeness "col" >= threshold
  if (/^Completeness\s+"[^"]+"\s*>=\s*[\d.]+$/i.test(trimmed)) {
    return { valid: true };
  }

  // Uniqueness "col" >= threshold
  if (/^Uniqueness\s+"[^"]+"\s*>=\s*[\d.]+$/i.test(trimmed)) {
    return { valid: true };
  }

  // ColumnValues "col" between min and max
  if (/^ColumnValues\s+"[^"]+"\s+between\s+[\d.]+\s+and\s+[\d.]+$/i.test(trimmed)) {
    return { valid: true };
  }

  // ColumnValues "col" matches "regex"
  if (/^ColumnValues\s+"[^"]+"\s+matches\s+"[^"]*"$/i.test(trimmed)) {
    return { valid: true };
  }

  // RowCount, IsComplete, IsPrimaryKey, IsUnique — simple keyword checks
  if (/^(RowCount|IsComplete|IsPrimaryKey|IsUnique)\s/i.test(trimmed)) {
    return { valid: true };
  }

  return {
    valid: false,
    error: `Expresión DQDL no reconocida: "${trimmed}"`,
  };
}

/**
 * Parsea un texto DQDL `Rules = [ ... ]` de vuelta a un array de QualityRule parciales.
 *
 * Usado para round-trip testing. Genera reglas con campos inferidos del DQDL.
 */
export function parseDqdlRuleset(dqdlText: string): QualityRule[] {
  const body = extractRulesBody(dqdlText);
  if (body === null) {
    return [];
  }

  if (!body.trim()) {
    return [];
  }

  // Split expressions by comma (handling newlines)
  const expressions = splitDqdlExpressions(body);
  const rules: QualityRule[] = [];

  for (let i = 0; i < expressions.length; i++) {
    const expr = expressions[i].trim();
    if (!expr) continue;

    const rule = parseSingleExpression(expr, i);
    if (rule) {
      rules.push(rule);
    }
  }

  return rules;
}

/**
 * Genera una expresión DQDL base para un tipo de regla y columna dados.
 *
 * Útil para auto-completar el formulario de creación de reglas.
 */
export function generateBaseExpression(
  type: QualityRuleType,
  column: string,
): string {
  switch (type) {
    case 'completeness':
      return `Completeness "${column}" >= 1.0`;
    case 'uniqueness':
      return `Uniqueness "${column}" >= 1.0`;
    case 'range':
      return `ColumnValues "${column}" between 0 and 100`;
    case 'format':
      return `ColumnValues "${column}" matches ".*"`;
    case 'custom':
      return '';
    default:
      return '';
  }
}

// ─── Helpers internos ────────────────────────────────────────────

/**
 * Extracts the body between `Rules = [` and the matching `]`,
 * correctly handling brackets inside quoted strings (e.g. regex patterns).
 */
function extractRulesBody(dqdlText: string): string | null {
  const startMatch = dqdlText.match(/Rules\s*=\s*\[/);
  if (!startMatch) return null;

  const startIdx = startMatch.index! + startMatch[0].length;
  let depth = 1;
  let inQuotes = false;
  let i = startIdx;

  while (i < dqdlText.length && depth > 0) {
    const ch = dqdlText[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === '[') depth++;
      if (ch === ']') depth--;
    }
    if (depth > 0) i++;
  }

  if (depth !== 0) return null;
  return dqdlText.slice(startIdx, i);
}

function assertTargetColumn(rule: QualityRule): asserts rule is QualityRule & {
  targetColumn: string;
} {
  if (!rule.targetColumn || rule.targetColumn.trim() === '') {
    throw new Error(
      `Regla "${rule.ruleName}" (${rule.ruleId}): targetColumn es requerida para tipo "${rule.type}"`,
    );
  }
}

function parseRange(
  expression: string,
  rule: QualityRule,
): { min: number; max: number } {
  const parts = expression.split(',');
  if (parts.length !== 2) {
    throw new Error(
      `Regla "${rule.ruleName}" (${rule.ruleId}): formato de rango inválido "${expression}". Se espera "min,max"`,
    );
  }

  const min = Number(parts[0].trim());
  const max = Number(parts[1].trim());

  if (isNaN(min) || isNaN(max)) {
    throw new Error(
      `Regla "${rule.ruleName}" (${rule.ruleId}): valores de rango no numéricos en "${expression}"`,
    );
  }

  if (min > max) {
    throw new Error(
      `Regla "${rule.ruleName}" (${rule.ruleId}): min (${min}) no puede ser mayor que max (${max})`,
    );
  }

  return { min, max };
}

function assertValidRegex(expression: string, rule: QualityRule): void {
  try {
    new RegExp(expression);
  } catch {
    throw new Error(
      `Regla "${rule.ruleName}" (${rule.ruleId}): regex inválida "${expression}"`,
    );
  }
}

/**
 * Splits DQDL expressions separated by commas, respecting quoted strings.
 */
function splitDqdlExpressions(body: string): string[] {
  const results: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const ch of body) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === ',' && !inQuotes) {
      results.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    results.push(current.trim());
  }

  return results;
}

function parseSingleExpression(
  expr: string,
  index: number,
): QualityRule | null {
  const baseRule: Omit<QualityRule, 'type' | 'expression' | 'targetColumn' | 'threshold'> = {
    ruleId: `parsed-${index}`,
    ruleName: `Rule ${index + 1}`,
    stage: 'geopos_local',
    enabled: true,
    createdAt: new Date().toISOString(),
  };

  // Completeness "col" >= threshold
  const completenessMatch = expr.match(
    /^Completeness\s+"([^"]+)"\s*>=\s*([\d.]+)$/i,
  );
  if (completenessMatch) {
    return {
      ...baseRule,
      type: 'completeness',
      targetColumn: completenessMatch[1],
      threshold: parseFloat(completenessMatch[2]),
      expression: '',
    };
  }

  // Uniqueness "col" >= threshold
  const uniquenessMatch = expr.match(
    /^Uniqueness\s+"([^"]+)"\s*>=\s*([\d.]+)$/i,
  );
  if (uniquenessMatch) {
    return {
      ...baseRule,
      type: 'uniqueness',
      targetColumn: uniquenessMatch[1],
      threshold: parseFloat(uniquenessMatch[2]),
      expression: '',
    };
  }

  // ColumnValues "col" between min and max
  const rangeMatch = expr.match(
    /^ColumnValues\s+"([^"]+)"\s+between\s+([\d.]+)\s+and\s+([\d.]+)$/i,
  );
  if (rangeMatch) {
    return {
      ...baseRule,
      type: 'range',
      targetColumn: rangeMatch[1],
      threshold: 1.0,
      expression: `${rangeMatch[2]},${rangeMatch[3]}`,
    };
  }

  // ColumnValues "col" matches "regex"
  const formatMatch = expr.match(
    /^ColumnValues\s+"([^"]+)"\s+matches\s+"([^"]*)"$/i,
  );
  if (formatMatch) {
    return {
      ...baseRule,
      type: 'format',
      targetColumn: formatMatch[1],
      threshold: 1.0,
      expression: formatMatch[2],
    };
  }

  // Custom — anything else
  return {
    ...baseRule,
    type: 'custom',
    expression: expr,
    threshold: 1.0,
  };
}

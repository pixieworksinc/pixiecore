/**
 * Coordinates comparators responsibilities inside the PixieCore kernel.
 */

import { isDeepStrictEqual } from 'node:util';
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import type {
  EvaluationComparisonOptions,
  EvaluationComparisonPolicy,
  EvaluationComparisonResult,
  EvaluationDifference,
  NumericToleranceEvaluationComparison,
} from '../../contracts/evaluation/index.js';
import type { JsonObject } from '../../contracts/types/index.js';
import { getBuiltInEvaluationComparator } from './traceable-summary.js';

interface PointerValue {
  readonly found: boolean;
  readonly value?: unknown;
}

/** Compares one actual Blueprint result with one expected evaluation result. */
export async function compareEvaluationOutput(
  actual: Readonly<JsonObject>,
  expected: Readonly<JsonObject>,
  policy: EvaluationComparisonPolicy,
  options: EvaluationComparisonOptions = {},
): Promise<EvaluationComparisonResult> {
  if (policy.mode === 'exact') return exactResult(actual, expected, '');
  if (policy.mode === 'schema') return schemaResult(actual, expected, options);
  if (policy.mode === 'fields') {
    assertPointers(policy.pointers, 'fields comparison');
    return comparePointers(actual, expected, policy.pointers, exactResult);
  }
  if (policy.mode === 'set') {
    assertJsonPointer(policy.pointer);
    return comparePointers(actual, expected, [policy.pointer], setResult);
  }
  if (policy.mode === 'numeric_tolerance') {
    assertNumericPolicy(policy);
    return comparePointers(
      actual,
      expected,
      policy.pointers,
      (actualValue, expectedValue, pointer) => numericResult(
        actualValue,
        expectedValue,
        pointer,
        policy,
      ),
    );
  }
  return customResult(actual, expected, policy.comparator, policy.config ?? {}, options);
}

function exactResult(
  actual: unknown,
  expected: unknown,
  pointer: string,
): EvaluationComparisonResult {
  return isDeepStrictEqual(actual, expected)
    ? passed()
    : failed({ pointer, reason: 'not_equal', expected, actual });
}

function schemaResult(
  actual: Readonly<JsonObject>,
  expected: Readonly<JsonObject>,
  options: EvaluationComparisonOptions,
): EvaluationComparisonResult {
  if (!options.outputSchema) throw new TypeError('schema comparison requires outputSchema');
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(options.outputSchema);
  const differences: EvaluationDifference[] = [];
  if (!validate(expected)) differences.push(...schemaDifferences('expected', validate.errors));
  if (!validate(actual)) differences.push(...schemaDifferences('actual', validate.errors));
  return result(differences);
}

function schemaDifferences(
  side: 'actual' | 'expected',
  errors: null | readonly ErrorObject[] | undefined,
): EvaluationDifference[] {
  return (errors ?? []).map(error => ({
    pointer: error.instancePath,
    reason: 'schema_validation',
    detail: `${side}: ${error.message ?? 'schema validation failed'}`,
  }));
}

function comparePointers(
  actual: Readonly<JsonObject>,
  expected: Readonly<JsonObject>,
  pointers: readonly string[],
  compare: (actualValue: unknown, expectedValue: unknown, pointer: string) => EvaluationComparisonResult,
): EvaluationComparisonResult {
  const differences: EvaluationDifference[] = [];
  for (const pointer of pointers) {
    assertJsonPointer(pointer);
    const actualValue = resolvePointer(actual, pointer);
    const expectedValue = resolvePointer(expected, pointer);
    if (!actualValue.found) {
      differences.push({ pointer, reason: 'missing_actual', expected: expectedValue.value });
      continue;
    }
    if (!expectedValue.found) {
      differences.push({ pointer, reason: 'missing_expected', actual: actualValue.value });
      continue;
    }
    differences.push(...compare(actualValue.value, expectedValue.value, pointer).differences);
  }
  return result(differences);
}

function setResult(
  actual: unknown,
  expected: unknown,
  pointer: string,
): EvaluationComparisonResult {
  if (!Array.isArray(actual) || !Array.isArray(expected)) {
    return failed({ pointer, reason: 'not_array', expected, actual });
  }
  const actualSet = unique(actual);
  const expectedSet = unique(expected);
  if (actualSet.length === expectedSet.length
      && actualSet.every(value => expectedSet.some(candidate => isDeepStrictEqual(value, candidate)))) {
    return passed();
  }
  return failed({ pointer, reason: 'not_equal', expected, actual });
}

function numericResult(
  actual: unknown,
  expected: unknown,
  pointer: string,
  policy: NumericToleranceEvaluationComparison,
): EvaluationComparisonResult {
  if (typeof actual !== 'number' || !Number.isFinite(actual)
      || typeof expected !== 'number' || !Number.isFinite(expected)) {
    return failed({ pointer, reason: 'not_number', expected, actual });
  }
  const permittedDifference = Math.max(
    policy.absolute_tolerance ?? 0,
    Math.abs(expected) * (policy.relative_tolerance ?? 0),
  );
  if (Math.abs(actual - expected) <= permittedDifference) return passed();
  return failed({
    pointer,
    reason: 'outside_tolerance',
    expected,
    actual,
    detail: `permitted difference: ${permittedDifference}`,
  });
}

async function customResult(
  actual: Readonly<JsonObject>,
  expected: Readonly<JsonObject>,
  comparatorId: string,
  config: Readonly<JsonObject>,
  options: EvaluationComparisonOptions,
): Promise<EvaluationComparisonResult> {
  const comparator = getBuiltInEvaluationComparator(comparatorId)
    ?? options.customComparators?.get(comparatorId);
  if (!comparator) throw new TypeError(`Unknown evaluation comparator: ${comparatorId}`);
  const comparison = await comparator({
    actual: structuredClone(actual),
    expected: structuredClone(expected),
    config: structuredClone(config),
    ...(options.inputs === undefined ? {} : { inputs: structuredClone(options.inputs) }),
  });
  assertComparisonResult(comparison, comparatorId);
  return Object.freeze({
    passed: comparison.passed,
    differences: Object.freeze([...comparison.differences]),
  });
}

function assertComparisonResult(value: EvaluationComparisonResult, comparatorId: string): void {
  if (!value || typeof value.passed !== 'boolean' || !Array.isArray(value.differences)) {
    throw new TypeError(`Evaluation comparator returned an invalid result: ${comparatorId}`);
  }
  if (value.passed !== (value.differences.length === 0)) {
    throw new TypeError(`Evaluation comparator returned an inconsistent result: ${comparatorId}`);
  }
}

function assertPointers(pointers: readonly string[], label: string): void {
  if (!pointers.length) throw new TypeError(`${label} requires at least one JSON Pointer`);
  for (const pointer of pointers) assertJsonPointer(pointer);
}

function assertNumericPolicy(policy: NumericToleranceEvaluationComparison): void {
  assertPointers(policy.pointers, 'numeric tolerance comparison');
  if (policy.absolute_tolerance === undefined && policy.relative_tolerance === undefined) {
    throw new TypeError('numeric tolerance comparison requires a tolerance');
  }
  for (const [name, value] of [
    ['absolute_tolerance', policy.absolute_tolerance],
    ['relative_tolerance', policy.relative_tolerance],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new TypeError(`${name} must be a non-negative finite number`);
    }
  }
}

function assertJsonPointer(pointer: string): void {
  if (pointer === '') return;
  if (!pointer.startsWith('/') || /~(?![01])/u.test(pointer)) {
    throw new TypeError(`Invalid JSON Pointer: ${pointer}`);
  }
}

function resolvePointer(value: unknown, pointer: string): PointerValue {
  if (pointer === '') return { found: true, value };
  let current = value;
  for (const encoded of pointer.slice(1).split('/')) {
    const segment = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(segment)) return { found: false };
      const index = Number(segment);
      if (index >= current.length) return { found: false };
      current = current[index];
      continue;
    }
    if (!current || typeof current !== 'object'
        || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

function unique(values: readonly unknown[]): unknown[] {
  const result: unknown[] = [];
  for (const value of values) {
    if (!result.some(candidate => isDeepStrictEqual(value, candidate))) result.push(value);
  }
  return result;
}

function passed(): EvaluationComparisonResult {
  return Object.freeze({ passed: true, differences: Object.freeze([]) });
}

function failed(difference: EvaluationDifference): EvaluationComparisonResult {
  return Object.freeze({ passed: false, differences: Object.freeze([difference]) });
}

function result(differences: EvaluationDifference[]): EvaluationComparisonResult {
  return Object.freeze({
    passed: differences.length === 0,
    differences: Object.freeze(differences),
  });
}

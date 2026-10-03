/**
 * Implements program behavior for the jit plugin.
 */

import { isDeepStrictEqual } from 'node:util';
import {
  cloneFrozenJsonValue,
  type JsonArtifactValue,
} from '../../../core/component/json-artifact/index.js';
import type {
  JitArithmeticOperator,
  JitComparisonOperator,
  JitExpression,
  JitProgram,
  JitProgramLimits,
  JitRoundingMode,
} from '../../../core/contracts/jit/index.js';
import { JitProgramError } from '../../../core/contracts/errors/index.js';
import type { JsonValue } from '../../../core/contracts/types/index.js';

export const JIT_EXPRESSION_KINDS = Object.freeze([
  'input',
  'const',
  'field',
  'arithmetic',
  'round',
  'compare',
  'choose',
  'lookup',
  'concat',
  'compact',
  'toNumber',
  'toText',
] as const);

const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 32,
  maxNodes: 500,
  maxOutputs: 64,
  maxCollectionItems: 128,
});
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const validatedPrograms = new WeakSet<object>();

interface ValidationState {
  nodes: number;
  readonly limits: Required<JitProgramLimits>;
}

/**
 * Validates jit program and rejects unsupported input.
 */
export function validateJitProgram(
  value: unknown,
  limits: JitProgramLimits = {},
): JitProgram {
  const normalizedLimits = normalizeLimits(limits);
  const root = mapping(value, '$');
  exactKeys(root, ['outputs'], '$');
  const outputs = mapping(root.outputs, '$.outputs');
  const entries = Object.entries(outputs);
  if (entries.length === 0) throw contractError('$.outputs must contain at least one field');
  if (entries.length > normalizedLimits.maxOutputs) {
    throw contractError(`$.outputs exceeds the ${normalizedLimits.maxOutputs} field limit`);
  }

  const state: ValidationState = { nodes: 0, limits: normalizedLimits };
  const result: Record<string, JitExpression> = Object.create(null) as Record<string, JitExpression>;
  for (const [name, expression] of entries) {
    safeName(name, `$.outputs.${name}`);
    result[name] = validateExpression(expression, 0, `$.outputs.${name}`, state);
  }
  const program = Object.freeze({ outputs: Object.freeze(result) });
  validatedPrograms.add(program);
  return program;
}

/**
 * Executes jit program through its public boundary.
 */
export function runJitProgram(
  program: JitProgram,
  inputs: Readonly<Record<string, unknown>>,
): Readonly<Record<string, JsonValue>> {
  const validated = validatedPrograms.has(program as object)
    ? program
    : validateJitProgram(program);
  const output: Record<string, JsonValue> = {};
  for (const [name, expression] of Object.entries(validated.outputs)) {
    output[name] = evaluate(expression, inputs);
  }
  return Object.freeze(output);
}

function validateExpression(
  value: unknown,
  depth: number,
  path: string,
  state: ValidationState,
): JitExpression {
  state.nodes++;
  if (state.nodes > state.limits.maxNodes) {
    throw contractError(`Program exceeds the ${state.limits.maxNodes} operation limit`);
  }
  if (depth > state.limits.maxDepth) {
    throw contractError(`${path} exceeds the ${state.limits.maxDepth} depth limit`);
  }
  const expression = mapping(value, path);
  const kind = text(expression.kind, `${path}.kind`);
  const child = (item: unknown, label: string): JitExpression => (
    validateExpression(item, depth + 1, `${path}.${label}`, state)
  );

  switch (kind) {
    case 'input':
      exactKeys(expression, ['kind', 'name'], path);
      return Object.freeze({ kind, name: safeName(text(expression.name, `${path}.name`), `${path}.name`) });
    case 'const':
      exactKeys(expression, ['kind', 'value'], path);
      return Object.freeze({ kind, value: jsonValue(expression.value, `${path}.value`) });
    case 'field':
      exactKeys(expression, ['kind', 'of', 'name'], path);
      return Object.freeze({
        kind,
        of: child(expression.of, 'of'),
        name: safeName(text(expression.name, `${path}.name`), `${path}.name`),
      });
    case 'arithmetic':
      exactKeys(expression, ['kind', 'op', 'left', 'right'], path);
      return Object.freeze({
        kind,
        op: oneOf(expression.op, ['add', 'subtract', 'multiply', 'divide'], `${path}.op`) as JitArithmeticOperator,
        left: child(expression.left, 'left'),
        right: child(expression.right, 'right'),
      });
    case 'round': {
      exactKeys(expression, ['kind', 'mode', 'of'], path, ['digits']);
      const digits = expression.digits === undefined
        ? undefined
        : boundedInteger(expression.digits, -12, 12, `${path}.digits`);
      return Object.freeze({
        kind,
        mode: oneOf(expression.mode, ['ceil', 'floor', 'nearest'], `${path}.mode`) as JitRoundingMode,
        of: child(expression.of, 'of'),
        ...(digits === undefined ? {} : { digits }),
      });
    }
    case 'compare':
      exactKeys(expression, ['kind', 'op', 'left', 'right'], path);
      return Object.freeze({
        kind,
        op: oneOf(expression.op, ['lt', 'lte', 'gt', 'gte', 'eq', 'neq'], `${path}.op`) as JitComparisonOperator,
        left: child(expression.left, 'left'),
        right: child(expression.right, 'right'),
      });
    case 'choose':
      exactKeys(expression, ['kind', 'when', 'then', 'otherwise'], path);
      return Object.freeze({
        kind,
        when: child(expression.when, 'when'),
        then: child(expression.then, 'then'),
        otherwise: child(expression.otherwise, 'otherwise'),
      });
    case 'lookup': {
      exactKeys(expression, ['kind', 'table', 'key'], path, ['fallback']);
      const tableValue = mapping(expression.table, `${path}.table`);
      const tableEntries = Object.entries(tableValue);
      if (tableEntries.length > state.limits.maxCollectionItems) {
        throw contractError(`${path}.table exceeds the ${state.limits.maxCollectionItems} item limit`);
      }
      const table: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
      for (const [name, item] of tableEntries) {
        safeName(name, `${path}.table.${name}`);
        table[name] = jsonValue(item, `${path}.table.${name}`);
      }
      return Object.freeze({
        kind,
        table: Object.freeze(table),
        key: child(expression.key, 'key'),
        ...(expression.fallback === undefined
          ? {}
          : { fallback: jsonValue(expression.fallback, `${path}.fallback`) }),
      });
    }
    case 'concat':
    case 'compact': {
      exactKeys(expression, ['kind', 'parts'], path);
      const parts = array(expression.parts, `${path}.parts`);
      if (parts.length > state.limits.maxCollectionItems) {
        throw contractError(`${path}.parts exceeds the ${state.limits.maxCollectionItems} item limit`);
      }
      return Object.freeze({
        kind,
        parts: Object.freeze(parts.map((part, index) => child(part, `parts[${index}]`))),
      });
    }
    case 'toNumber':
    case 'toText':
      exactKeys(expression, ['kind', 'of'], path);
      return Object.freeze({ kind, of: child(expression.of, 'of') });
    default:
      throw contractError(`${path}.kind is not a supported operation: ${kind}`);
  }
}

function evaluate(expression: JitExpression, inputs: Readonly<Record<string, unknown>>): JsonValue {
  switch (expression.kind) {
    case 'input':
      return inputValue(inputs[expression.name]);
    case 'const':
      return expression.value;
    case 'field': {
      const source = evaluate(expression.of, inputs);
      if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
      return Object.prototype.hasOwnProperty.call(source, expression.name)
        ? source[expression.name] ?? null
        : null;
    }
    case 'arithmetic': {
      const left = numberValue(evaluate(expression.left, inputs));
      const right = numberValue(evaluate(expression.right, inputs));
      if (left === null || right === null) return null;
      if (expression.op === 'add') return finite(left + right);
      if (expression.op === 'subtract') return finite(left - right);
      if (expression.op === 'multiply') return finite(left * right);
      return right === 0 ? null : finite(left / right);
    }
    case 'round': {
      const value = numberValue(evaluate(expression.of, inputs));
      if (value === null) return null;
      const factor = 10 ** (expression.digits ?? 0);
      const scaled = value * factor;
      const rounded = expression.mode === 'ceil'
        ? Math.ceil(scaled)
        : expression.mode === 'floor'
          ? Math.floor(scaled)
          : Math.round(scaled);
      return finite(rounded / factor);
    }
    case 'compare': {
      const left = evaluate(expression.left, inputs);
      const right = evaluate(expression.right, inputs);
      if (expression.op === 'eq') return isDeepStrictEqual(left, right);
      if (expression.op === 'neq') return !isDeepStrictEqual(left, right);
      const leftNumber = numberValue(left);
      const rightNumber = numberValue(right);
      if (leftNumber !== null && rightNumber !== null) {
        return orderedCompare(leftNumber, rightNumber, expression.op);
      }
      if (typeof left === 'string' && typeof right === 'string') {
        return orderedCompare(left, right, expression.op);
      }
      return false;
    }
    case 'choose':
      return evaluate(expression.when, inputs) === true
        ? evaluate(expression.then, inputs)
        : evaluate(expression.otherwise, inputs);
    case 'lookup': {
      const key = evaluate(expression.key, inputs);
      const name = typeof key === 'string' || typeof key === 'number' ? String(key) : '';
      return Object.prototype.hasOwnProperty.call(expression.table, name)
        ? expression.table[name] ?? null
        : expression.fallback ?? null;
    }
    case 'concat':
      return expression.parts.map(part => textValue(evaluate(part, inputs))).join('');
    case 'compact':
      return expression.parts.map(part => evaluate(part, inputs)).filter(item => item !== null);
    case 'toNumber':
      return numberValue(evaluate(expression.of, inputs));
    case 'toText':
      return textValue(evaluate(expression.of, inputs));
  }
}

function normalizeLimits(limits: JitProgramLimits): Required<JitProgramLimits> {
  const result = { ...DEFAULT_LIMITS, ...limits };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
      throw contractError(`${name} must be an integer from 1 to 10000`);
    }
  }
  return result;
}

function mapping(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(`${path} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw contractError(`${path} must be a plain object`);
  }
  if (Reflect.ownKeys(value).some(key => typeof key === 'symbol')) {
    throw contractError(`${path} must not contain symbol properties`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw contractError(`${path}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw contractError(`${path}.${key} is not allowed`);
  }
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw contractError(`${path} must be an array`);
  for (let index = 0; index < value.length; index++) {
    if (!(index in value)) throw contractError(`${path}[${index}] must not be sparse`);
  }
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw contractError(`${path} must be a non-blank string`);
  return value;
}

function safeName(value: string, path: string): string {
  if (BLOCKED_KEYS.has(value)) throw contractError(`${path} uses a blocked object key`);
  return value;
}

function oneOf(value: unknown, values: readonly string[], path: string): string {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw contractError(`${path} must be one of: ${values.join(', ')}`);
  }
  return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw contractError(`${path} must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

function jsonValue(value: unknown, path: string): JsonValue {
  return cloneFrozenJsonValue(value, path, contractError) as JsonValue;
}

function inputValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  try {
    return cloneFrozenJsonValue(value, '$.inputs', contractError) as JsonValue;
  } catch {
    return null;
  }
}

function numberValue(value: JsonArtifactValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value: JsonValue): string {
  if (typeof value === 'string') return value;
  if (value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function orderedCompare(
  left: number | string,
  right: number | string,
  operator: Exclude<JitComparisonOperator, 'eq' | 'neq'>,
): boolean {
  if (operator === 'lt') return left < right;
  if (operator === 'lte') return left <= right;
  if (operator === 'gt') return left > right;
  return left >= right;
}

function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function contractError(message: string): JitProgramError {
  return new JitProgramError(message);
}

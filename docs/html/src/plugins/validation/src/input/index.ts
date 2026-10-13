/**
 * Implements input behavior for the validation plugin.
 */

import { InputTypeError, InputValidationError } from '../../../../core/contracts/errors/index.js';
import type { Blueprint, InputPlaceholder } from '../../../../core/contracts/types/index.js';
import { normalizePlaceholders } from '../schema/shared.js';

/**
 * Validates input contracts before execution.
 */
export class InputValidator {
  readonly placeholders: InputPlaceholder[];

  /**
   * Creates a InputValidator and establishes its initial state.
   */
  constructor(
    placeholders: Blueprint['input_placeholders'] = [],
    private readonly strict = true,
  ) {
    this.placeholders = normalizePlaceholders(placeholders, 'Unknown type');
  }

  /**
   * Validates the requested operation and rejects unsupported state.
   */
  validate(input: Record<string, unknown>): Record<string, unknown> {
    if (this.placeholders.length === 0) return { ...input };
    const errors: string[] = [];
    const output: Record<string, unknown> = {};
    const names = new Set(this.placeholders.map(placeholder => placeholder.name));
    if (this.strict) {
      for (const name of Object.keys(input)) {
        if (!names.has(name)) errors.push(`Unknown input: ${name}`);
      }
    }
    for (const placeholder of this.placeholders) {
      const provided = input[placeholder.name];
      if (provided === undefined && placeholder.required) {
        errors.push(`Missing required input: ${placeholder.name}`);
        continue;
      }
      const value = provided === undefined ? placeholder.default ?? null : provided;
      try {
        output[placeholder.name] = value === null ? null : coerce(value, placeholder.type);
      } catch {
        errors.push(`Input ${placeholder.name} must be ${placeholder.type}`);
      }
    }
    if (!errors.length) return output;
    if (errors.some(error => error.includes(' must be '))) {
      throw new InputTypeError(errors.join('; '));
    }
    throw new InputValidationError(errors.join('; '));
  }
}

function coerce(value: unknown, type: InputPlaceholder['type']): unknown {
  if (type === 'string') {
    if (typeof value !== 'string') throw new Error();
    return value;
  }
  if (type === 'integer') {
    const number = typeof value === 'string' && /^[-+]?\d+$/.test(value)
      ? Number(value)
      : value;
    if (typeof number !== 'number' || !Number.isInteger(number)) throw new Error();
    return number;
  }
  if (type === 'float' || type === 'number') {
    const number = typeof value === 'string' && value.trim() ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number)) throw new Error();
    return number;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string' && /^(true|false)$/i.test(value)) {
      return value.toLowerCase() === 'true';
    }
    throw new Error();
  }
  if (type === 'array') {
    if (!Array.isArray(value)) throw new Error();
    return value;
  }
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  }
  if (typeof value === 'string') return value;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error();
  return value;
}

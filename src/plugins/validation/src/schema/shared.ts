/**
 * Implements shared behavior for the validation plugin.
 */

import { BlueprintValidationError } from '../../../../core/contracts/errors/index.js';
import type { InputPlaceholder, InputType } from '../../../../core/contracts/types/index.js';
import { isInstructionPlaceholderName } from '../../../../core/component/instruction-template/index.js';

const INPUT_TYPES = new Set([
  'string',
  'integer',
  'float',
  'number',
  'boolean',
  'array',
  'object',
  'file',
  'image',
]);

/**
 * Normalizes placeholders while preserving caller-owned input.
 */
export function normalizePlaceholders(raw: unknown, invalidTypePrefix: string): InputPlaceholder[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new BlueprintValidationError('input_placeholders must be an array');
  }
  const placeholders = raw.map(
    (value, index) => normalizePlaceholder(value, index, invalidTypePrefix),
  );
  const names = new Set<string>();
  for (const placeholder of placeholders) {
    if (names.has(placeholder.name)) {
      throw new BlueprintValidationError(`Duplicate input placeholder: ${placeholder.name}`);
    }
    names.add(placeholder.name);
  }
  return placeholders;
}

/**
 * Reports whether record.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePlaceholder(
  value: unknown,
  index: number,
  invalidTypePrefix: string,
): InputPlaceholder {
  if (typeof value === 'string') {
    if (!value.trim()) {
      throw new BlueprintValidationError(`input placeholder at index ${index} requires name`);
    }
    validatePlaceholderName(value, index);
    return { name: value, type: 'string', required: true };
  }
  if (!isRecord(value)) {
    throw new BlueprintValidationError(
      `input placeholder at index ${index} must be a string or object`,
    );
  }
  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new BlueprintValidationError(`input placeholder at index ${index} requires name`);
  }
  validatePlaceholderName(value.name, index);
  if (typeof value.type !== 'string' || !value.type) {
    throw new BlueprintValidationError(`input placeholder ${value.name} requires type`);
  }
  if (!INPUT_TYPES.has(value.type)) {
    throw new BlueprintValidationError(
      `${invalidTypePrefix}: '${value.type}' for input ${value.name}`,
    );
  }
  if (value.required !== undefined && typeof value.required !== 'boolean') {
    throw new BlueprintValidationError(
      `input placeholder ${value.name} required must be boolean`,
    );
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    throw new BlueprintValidationError(
      `input placeholder ${value.name} description must be string`,
    );
  }
  return {
    name: value.name,
    type: value.type as InputType,
    ...(value.required === undefined ? {} : { required: value.required }),
    ...('default' in value ? { default: value.default } : {}),
    ...(value.description === undefined ? {} : { description: value.description }),
  };
}

function validatePlaceholderName(name: string, index: number): void {
  if (isInstructionPlaceholderName(name)) return;
  throw new BlueprintValidationError(
    `input placeholder at index ${index} has invalid name: ${name}`,
  );
}

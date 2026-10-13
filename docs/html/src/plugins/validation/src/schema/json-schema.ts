/**
 * Implements json schema behavior for the validation plugin.
 */

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv/dist/ajv.js';

/**
 * Describes the json schema compiler snapshot contract.
 */
export interface JsonSchemaCompilerSnapshot {
  readonly capacity: number;
  readonly entries: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

/**
 * Encapsulates json schema compiler behavior and lifecycle.
 */
export class JsonSchemaCompiler {
  private readonly validators = new Map<string, ValidateFunction>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  /**
   * Creates a JsonSchemaCompiler and establishes its initial state.
   */
  constructor(readonly capacity = 64) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError('JSON Schema compiler capacity must be a positive integer');
    }
  }

  /**
   * Compiles according to the JsonSchemaCompiler contract.
   */
  compile(schema: string | Record<string, unknown>): ValidateFunction {
    const value = typeof schema === 'string' ? JSON.parse(schema) : schema;
    const key = JSON.stringify(value);
    const cached = this.validators.get(key);
    if (cached) {
      this.validators.delete(key);
      this.validators.set(key, cached);
      this.hits++;
      return cached;
    }

    this.misses++;
    const validate = new Ajv({ allErrors: true, strict: false }).compile(value);
    this.validators.set(key, validate);
    while (this.validators.size > this.capacity) {
      const oldest = this.validators.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.validators.delete(oldest);
      this.evictions++;
    }
    return validate;
  }

  /**
   * Returns an immutable snapshot of the current state.
   */
  snapshot(): JsonSchemaCompilerSnapshot {
    return Object.freeze({
      capacity: this.capacity,
      entries: this.validators.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    });
  }
}

/**
 * Compiles json schema for the owning PixieCore boundary.
 */
export function compileJsonSchema(
  schema: string | Record<string, unknown>,
): ValidateFunction {
  return new JsonSchemaCompiler(1).compile(schema);
}

/**
 * Formats schema errors for the owning PixieCore boundary.
 */
export function formatSchemaErrors(
  subject: string,
  errors: ErrorObject[] | null | undefined,
): string {
  const details = (errors ?? [])
    .map(error => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
  return `${subject} does not match schema: ${details}`;
}

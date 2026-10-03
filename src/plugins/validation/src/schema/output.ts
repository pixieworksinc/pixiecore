/**
 * Implements output behavior for the validation plugin.
 */

import type { ValidateFunction } from 'ajv/dist/ajv.js';
import { SchemaValidationError } from '../../../../core/contracts/errors/index.js';
import { compileJsonSchema, formatSchemaErrors } from './json-schema.js';

/**
 * Validates output contracts before execution.
 */
export class OutputValidator {
  private readonly validateFn: ValidateFunction;

  /**
   * Creates a OutputValidator and establishes its initial state.
   */
  constructor(
    schema: string | Record<string, unknown>,
    compileSchema = compileJsonSchema,
  ) {
    this.validateFn = compileSchema(schema);
  }

  /**
   * Validates the requested operation and rejects unsupported state.
   */
  validate(value: unknown): Record<string, unknown> {
    if (!this.validateFn(value)) {
      throw new SchemaValidationError(formatSchemaErrors('Output', this.validateFn.errors));
    }
    return value as Record<string, unknown>;
  }
}

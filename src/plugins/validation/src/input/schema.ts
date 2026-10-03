/**
 * Implements schema behavior for the validation plugin.
 */

import type { ValidateFunction } from 'ajv/dist/ajv.js';
import { InputValidationError } from '../../../../core/contracts/errors/index.js';
import { compileJsonSchema, formatSchemaErrors } from '../schema/json-schema.js';

/**
 * Validates input schema contracts before execution.
 */
export class InputSchemaValidator {
  private readonly validateFn: ValidateFunction;

  /**
   * Creates a InputSchemaValidator and establishes its initial state.
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
  validate(value: Record<string, unknown>): Record<string, unknown> {
    if (!this.validateFn(value)) {
      throw new InputValidationError(formatSchemaErrors('Input', this.validateFn.errors));
    }
    return { ...value };
  }
}

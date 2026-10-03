/**
 * Implements arguments behavior for the tools plugin.
 */

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv/dist/ajv.js';
import type { ToolArgumentValidationResult } from '../../../core/contracts/tools/index.js';

/**
 * Describes the tool argument validator contract.
 */
export interface ToolArgumentValidator {
  /**
   * Validates the requested operation and rejects unsupported input.
   */
  validate(
    parameters: Record<string, unknown>,
    args: unknown,
  ): ToolArgumentValidationResult;
}

/**
 * Compiles each tool schema once and validates without coercing, defaulting, or
 * removing any caller-supplied values.
 */
export function createToolArgumentValidator(): ToolArgumentValidator {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validators = new WeakMap<Record<string, unknown>, ValidateFunction>();

  return Object.freeze({
    /**
     * Validates the requested operation and rejects unsupported state.
     */
    validate(parameters: Record<string, unknown>, args: unknown) {
      let validate = validators.get(parameters);
      if (!validate) {
        validate = ajv.compile(parameters);
        validators.set(parameters, validate);
      }
      const valid = validate(args);
      return {
        valid,
        errors: valid ? [] : formatAjvErrors(validate.errors),
      };
    },
  });
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`);
}

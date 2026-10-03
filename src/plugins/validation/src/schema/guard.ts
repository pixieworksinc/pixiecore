/**
 * Implements schema guard behavior for the validation plugin.
 */

import { errorMessage } from '../../../../core/component/diagnostics/index.js';
import { SchemaValidationError } from '../../../../core/contracts/errors/index.js';
import type { DecoratorContext, OutputDecorator } from '../../../../core/contracts/types/index.js';
import { OutputValidator } from './output.js';

/**
 * Enforces schema policy at its execution boundary.
 */
export class SchemaGuard implements OutputDecorator {
  readonly priority = 10;
  readonly stage = 'after' as const;

  /**
   * Validates the requested operation and rejects unsupported state.
   */
  validate(context: DecoratorContext): DecoratorContext {
    if (context.blueprint.output_schema === undefined) return context;
    try {
      const output = new OutputValidator(context.blueprint.output_schema).validate(context.output);
      return { ...context, output };
    } catch (error) {
      if (error instanceof SchemaValidationError) throw error;
      throw new SchemaValidationError(`Invalid output schema: ${errorMessage(error)}`);
    }
  }
}

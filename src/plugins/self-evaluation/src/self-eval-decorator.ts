/**
 * Implements self eval decorator behavior for the self evaluation plugin.
 */

import { SelfEvaluationError } from '../../../core/contracts/errors/index.js';
import type { DecoratorContext, OutputDecorator } from '../../../core/contracts/types/index.js';

/**
 * Applies self eval behavior around execution.
 */
export class SelfEvalDecorator implements OutputDecorator {
  readonly priority = 30;
  readonly stage = 'after' as const;

  /**
   * Validates the requested operation and rejects unsupported state.
   */
  validate(context: DecoratorContext): DecoratorContext {
    if (!isRecord(context.output) || !('errors' in context.output)) return context;
    const errors = context.output.errors;
    if (hasErrors(errors)) {
      throw new SelfEvaluationError(`Self-evaluation reported errors: ${formatErrors(errors)}`);
    }
    return context;
  }
}

function hasErrors(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return Boolean(value);
}

function formatErrors(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); }
  catch { return String(value); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

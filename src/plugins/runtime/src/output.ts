/**
 * Implements output behavior for the runtime plugin.
 */

import { SchemaValidationError } from '../../../core/contracts/errors/index.js';
import type { OutputValidatorPort } from '../../../core/contracts/validation/index.js';

/**
 * Validates raw provider output before the ordered decorator pipeline runs.
 * SchemaGuard remains a separate boundary for mutations made by decorators
 * whose priority places them before that guard.
 */
export function validateProviderOutput(
  validator: OutputValidatorPort,
  content: string,
): Record<string, unknown> {
  return validator.validate(parseJson(content));
}

function parseJson(text: string): unknown {
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned) as unknown;
  } catch (cause) {
    throw new SchemaValidationError(
      `Response is not valid JSON: ${(cause as Error).message}`,
    );
  }
}

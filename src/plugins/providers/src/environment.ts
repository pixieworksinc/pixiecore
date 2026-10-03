/**
 * Implements environment behavior for the providers plugin.
 */

import { LLMAPIError } from '../../../core/contracts/errors/index.js';
import type { ProviderHeaderFactory } from '../../../core/contracts/provider/index.js';

/**
 * Handles required environment for the owning PixieCore boundary.
 */
export function requiredEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
  name: string,
): string {
  const value = environment[name];
  if (!value) throw new LLMAPIError(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Handles boolean environment for the owning PixieCore boundary.
 */
export function booleanEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
  name: string,
  fallback: boolean,
): boolean {
  const value = environment[name];
  if (value === undefined) return fallback;
  if (/^(?:1|true|yes|on)$/i.test(value)) return true;
  if (/^(?:0|false|no|off)$/i.test(value)) return false;
  throw new LLMAPIError(`${name} must be true or false`);
}

/**
 * Handles positive integer environment for the owning PixieCore boundary.
 */
export function positiveIntegerEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
  name: string,
  fallback: number,
): number {
  const value = environment[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new LLMAPIError(`${name} must be a positive integer`);
  }
  return parsed;
}

/**
 * Handles bearer headers for the owning PixieCore boundary.
 */
export function bearerHeaders(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

/**
 * Handles static headers for the owning PixieCore boundary.
 */
export function staticHeaders(headers: Record<string, string>): ProviderHeaderFactory {
  return async () => headers;
}

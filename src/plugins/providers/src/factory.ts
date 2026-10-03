/**
 * Implements factory behavior for the providers plugin.
 */

import type { BuiltInProviderName } from '../../../core/contracts/types/index.js';

export const BUILT_IN_PROVIDER_NAMES = [
  'openai',
  'anthropic',
  'azure_openai',
  'azure_native',
  'gemini_native',
  'gemini_openai',
  'apisix',
] as const satisfies readonly BuiltInProviderName[];

/**
 * Reports whether built in provider name.
 */
export function isBuiltInProviderName(name: string): name is BuiltInProviderName {
  return (BUILT_IN_PROVIDER_NAMES as readonly string[]).includes(name);
}

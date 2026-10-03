/**
 * Implements factory behavior for the providers plugin.
 */

import type { ProviderRuntimeServices } from '../../../../../core/contracts/provider/index.js';
import type { Provider, ProviderFactory, RuntimeOptions } from '../../../../../core/contracts/types/index.js';
import {
  booleanEnvironment,
  positiveIntegerEnvironment,
  requiredEnvironment,
} from '../../../providers.js';
import { AnthropicProvider } from './anthropic/index.js';

/**
 * Creates anthropic provider factory after validating the supplied contract.
 */
export function createAnthropicProviderFactory(
  environment: NodeJS.ProcessEnv,
  services: ProviderRuntimeServices,
): ProviderFactory {
  return {
    name: 'anthropic',
    create: options => createAnthropicProvider(
      { ...options, environment: options.environment ?? environment },
      services,
    ),
  };
}

/**
 * Creates anthropic provider after validating the supplied contract.
 */
export function createAnthropicProvider(
  options: RuntimeOptions,
  services: ProviderRuntimeServices,
): Provider {
  const environment = options.environment ?? process.env;
  return new AnthropicProvider(
    options.model ?? environment.ANTHROPIC_MODEL ?? 'claude-sonnet-4-0',
    requiredEnvironment(environment, 'ANTHROPIC_API_KEY'),
    positiveIntegerEnvironment(environment, 'ANTHROPIC_MAX_OUTPUT_TOKENS', 4096),
    booleanEnvironment(environment, 'ANTHROPIC_ENABLE_FILES_API', true),
    services,
    options.fetch,
    options.requestTimeout,
  );
}

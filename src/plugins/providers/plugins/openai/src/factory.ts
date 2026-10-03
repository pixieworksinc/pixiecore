/**
 * Implements factory behavior for the providers plugin.
 */

import type { ProviderSupportServicePort } from '../../../../../core/contracts/provider/index.js';
import type { Provider, ProviderFactory, RuntimeOptions } from '../../../../../core/contracts/types/index.js';
import {
  bearerHeaders,
  requiredEnvironment,
  staticHeaders,
} from '../../../providers.js';

/**
 * Creates open ai provider factory after validating the supplied contract.
 */
export function createOpenAIProviderFactory(
  environment: NodeJS.ProcessEnv,
  support: ProviderSupportServicePort,
): ProviderFactory {
  return {
    name: 'openai',
    create: options => createOpenAIProvider(
      { ...options, environment: options.environment ?? environment },
      support,
    ),
  };
}

/**
 * Creates open ai provider after validating the supplied contract.
 */
export function createOpenAIProvider(
  options: RuntimeOptions,
  support: ProviderSupportServicePort,
): Provider {
  const environment = options.environment ?? process.env;
  const apiKey = requiredEnvironment(environment, 'OPENAI_API_KEY');
  const baseUrl = environment.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  return support.createOpenAICompatible({
    name: 'openai',
    model: options.model ?? environment.OPENAI_MODEL ?? 'gpt-4.1-mini',
    completionUrl: support.joinUrl(baseUrl, 'chat/completions'),
    modelsUrl: support.joinUrl(baseUrl, 'models'),
    headers: staticHeaders(bearerHeaders(apiKey)),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.requestTimeout === undefined ? {} : { timeout: options.requestTimeout }),
  });
}

/**
 * Implements factory behavior for the providers plugin.
 */

import type {
  ProviderRuntimeServices,
  ProviderSupportServicePort,
} from '../../../../../core/contracts/provider/index.js';
import type { Provider, ProviderFactory, RuntimeOptions } from '../../../../../core/contracts/types/index.js';
import {
  bearerHeaders,
  positiveIntegerEnvironment,
  requiredEnvironment,
  staticHeaders,
} from '../../../providers.js';
import { DEFAULT_GEMINI_INLINE_LIMIT, GeminiProvider } from './gemini/index.js';

/**
 * Creates gemini native provider factory after validating the supplied contract.
 */
export function createGeminiNativeProviderFactory(
  environment: NodeJS.ProcessEnv,
  services: ProviderRuntimeServices,
): ProviderFactory {
  return {
    name: 'gemini_native',
    create: options => createGeminiNativeProvider(
      { ...options, environment: options.environment ?? environment },
      services,
    ),
  };
}

/**
 * Creates gemini open ai provider factory after validating the supplied contract.
 */
export function createGeminiOpenAIProviderFactory(
  environment: NodeJS.ProcessEnv,
  support: ProviderSupportServicePort,
): ProviderFactory {
  return {
    name: 'gemini_openai',
    create: options => createGeminiOpenAIProvider(
      { ...options, environment: options.environment ?? environment },
      support,
    ),
  };
}

/**
 * Creates gemini native provider after validating the supplied contract.
 */
export function createGeminiNativeProvider(
  options: RuntimeOptions,
  services: ProviderRuntimeServices,
): Provider {
  const environment = options.environment ?? process.env;
  return new GeminiProvider(
    options.model ?? environment.GEMINI_NATIVE_MODEL
      ?? environment.GEMINI_MODEL
      ?? 'gemini-2.5-flash',
    requiredEnvironment(environment, 'GEMINI_NATIVE_API_KEY'),
    positiveIntegerEnvironment(
      environment,
      'GEMINI_INLINE_FILE_SIZE_LIMIT',
      DEFAULT_GEMINI_INLINE_LIMIT,
    ),
    services,
    options.fetch,
    options.requestTimeout,
  );
}

/**
 * Creates gemini open ai provider after validating the supplied contract.
 */
export function createGeminiOpenAIProvider(
  options: RuntimeOptions,
  support: ProviderSupportServicePort,
): Provider {
  const environment = options.environment ?? process.env;
  const apiKey = requiredEnvironment(environment, 'GEMINI_OPENAI_API_KEY');
  const baseUrl = environment.GEMINI_OPENAI_BASE_URL
    ?? 'https://generativelanguage.googleapis.com/v1beta/openai';
  return support.createOpenAICompatible({
    name: 'gemini_openai',
    model: options.model ?? environment.GEMINI_OPENAI_MODEL
      ?? environment.GEMINI_MODEL
      ?? 'gemini-2.5-flash',
    completionUrl: support.joinUrl(baseUrl, 'chat/completions'),
    modelsUrl: support.joinUrl(baseUrl, 'models'),
    headers: staticHeaders(bearerHeaders(apiKey)),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.requestTimeout === undefined ? {} : { timeout: options.requestTimeout }),
  });
}

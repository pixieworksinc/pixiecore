/**
 * Implements factory behavior for the providers plugin.
 */

import { DefaultAzureCredential } from '@azure/identity';
import { LLMAPIError } from '../../../../../core/contracts/errors/index.js';
import type {
  ProviderHeaderFactory,
  ProviderSupportServicePort,
} from '../../../../../core/contracts/provider/index.js';
import type { Provider, ProviderFactory, RuntimeOptions } from '../../../../../core/contracts/types/index.js';
import {
  bearerHeaders,
  booleanEnvironment,
  requiredEnvironment,
  staticHeaders,
} from '../../../providers.js';

const AZURE_COGNITIVE_SCOPE = 'https://cognitiveservices.azure.com/.default';

/**
 * Creates azure open ai provider factory after validating the supplied contract.
 */
export function createAzureOpenAIProviderFactory(
  environment: NodeJS.ProcessEnv,
  support: ProviderSupportServicePort,
): ProviderFactory {
  return createFactory('azure_openai', environment, options => (
    createAzureOpenAIProvider(options, support)
  ));
}

/**
 * Creates azure native provider factory after validating the supplied contract.
 */
export function createAzureNativeProviderFactory(
  environment: NodeJS.ProcessEnv,
  support: ProviderSupportServicePort,
): ProviderFactory {
  return createFactory('azure_native', environment, options => (
    createAzureNativeProvider(options, support)
  ));
}

function createFactory(
  name: 'azure_openai' | 'azure_native',
  environment: NodeJS.ProcessEnv,
  create: (options: RuntimeOptions) => Provider,
): ProviderFactory {
  return {
    name,
    create: options => create({ ...options, environment: options.environment ?? environment }),
  };
}

/**
 * Creates azure open ai provider after validating the supplied contract.
 */
export function createAzureOpenAIProvider(
  options: RuntimeOptions,
  support: ProviderSupportServicePort,
): Provider {
  const environment = options.environment ?? process.env;
  const endpoint = requiredEnvironment(environment, 'AZURE_OPENAI_ENDPOINT').replace(/\/+$/, '');
  const deployment = options.model ?? environment.AZURE_OPENAI_DEPLOYMENT_NAME
    ?? environment.AZURE_OPENAI_DEPLOYMENT
    ?? requiredEnvironment(environment, 'AZURE_OPENAI_DEPLOYMENT_NAME');
  const version = environment.AZURE_OPENAI_API_VERSION ?? '2024-10-21';
  return support.createOpenAICompatible({
    name: 'azure_openai',
    model: deployment,
    completionUrl: support.joinUrl(
      `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}`,
      'chat/completions',
      { 'api-version': version },
    ),
    headers: azureHeaderFactory(
      options,
      environment,
      'AZURE_OPENAI_USE_AZURE_AD',
      'AZURE_OPENAI_API_KEY',
      'api-key',
    ),
    modelListFallback: [deployment],
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.requestTimeout === undefined ? {} : { timeout: options.requestTimeout }),
  });
}

/**
 * Creates azure native provider after validating the supplied contract.
 */
export function createAzureNativeProvider(
  options: RuntimeOptions,
  support: ProviderSupportServicePort,
): Provider {
  const environment = options.environment ?? process.env;
  const endpoint = requiredEnvironment(environment, 'AZURE_NATIVE_ENDPOINT');
  const model = options.model ?? environment.AZURE_NATIVE_DEPLOYMENT_NAME ?? 'gpt-4o-mini';
  return support.createOpenAICompatible({
    name: 'azure_native',
    model,
    completionUrl: support.joinUrl(endpoint, 'chat/completions'),
    modelsUrl: support.joinUrl(endpoint, 'models'),
    headers: azureHeaderFactory(
      options,
      environment,
      'AZURE_NATIVE_USE_AZURE_AD',
      'AZURE_NATIVE_API_KEY',
      'bearer',
    ),
    modelListFallback: [model],
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.requestTimeout === undefined ? {} : { timeout: options.requestTimeout }),
  });
}

function azureHeaderFactory(
  options: RuntimeOptions,
  environment: NodeJS.ProcessEnv,
  useAzureAdVariable: string,
  apiKeyVariable: string,
  keyStyle: 'api-key' | 'bearer',
): ProviderHeaderFactory {
  if (booleanEnvironment(environment, useAzureAdVariable, false)) {
    const getToken = options.azureTokenProvider ?? defaultAzureTokenProvider();
    return async () => {
      const token = await getToken();
      if (!token) {
        throw new LLMAPIError(
          `Azure token provider for ${useAzureAdVariable} returned an empty token`,
        );
      }
      return bearerHeaders(token.replace(/^Bearer\s+/i, ''));
    };
  }
  const apiKey = requiredEnvironment(environment, apiKeyVariable);
  return staticHeaders(keyStyle === 'api-key' ? { 'api-key': apiKey } : bearerHeaders(apiKey));
}

function defaultAzureTokenProvider(): () => Promise<string> {
  const credential = new DefaultAzureCredential();
  return async () => {
    const token = await credential.getToken(AZURE_COGNITIVE_SCOPE);
    if (!token) throw new LLMAPIError(`DefaultAzureCredential could not acquire ${AZURE_COGNITIVE_SCOPE}`);
    return token.token;
  };
}

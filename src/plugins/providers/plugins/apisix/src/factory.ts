/**
 * Creates the Apache APISIX AI Gateway provider adapter.
 */

import { ConfigurationError } from '../../../../../core/contracts/errors/index.js';
import type { ProviderSupportServicePort } from '../../../../../core/contracts/provider/index.js';
import type {
  Provider,
  ProviderFactory,
  RuntimeOptions,
} from '../../../../../core/contracts/types/index.js';
import {
  booleanEnvironment,
  requiredEnvironment,
  staticHeaders,
} from '../../../providers.js';

const HTTP_HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

/** Creates the manager-owned APISIX provider factory. */
export function createApisixProviderFactory(
  environment: NodeJS.ProcessEnv,
  support: ProviderSupportServicePort,
): ProviderFactory {
  return Object.freeze({
    name: 'apisix',
    create: (options: RuntimeOptions) => createApisixProvider(
      { ...options, environment: options.environment ?? environment },
      support,
    ),
  });
}

/** Creates a text and OpenAI-wire-compatible APISIX gateway provider. */
export function createApisixProvider(
  options: RuntimeOptions,
  support: ProviderSupportServicePort,
): Provider {
  const environment = options.environment ?? process.env;
  const completionUrl = support.joinUrl(
    requiredEnvironment(environment, 'APISIX_GATEWAY_URL'),
    '',
  );
  const configuredModelsUrl = environment.APISIX_GATEWAY_MODELS_URL;
  const model = options.model ?? environment.APISIX_GATEWAY_MODEL ?? 'default';
  return support.createOpenAICompatible({
    name: 'apisix',
    model,
    completionUrl,
    ...(configuredModelsUrl === undefined
      ? {}
      : { modelsUrl: support.joinUrl(configuredModelsUrl, '') }),
    modelListFallback: [model],
    headers: staticHeaders(apisixGatewayHeaders(environment)),
    capabilities: {
      tools: booleanEnvironment(environment, 'APISIX_GATEWAY_SUPPORTS_TOOLS', false),
      vision: booleanEnvironment(environment, 'APISIX_GATEWAY_SUPPORTS_VISION', false),
      fileInput: booleanEnvironment(environment, 'APISIX_GATEWAY_SUPPORTS_FILES', false),
    },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.requestTimeout === undefined ? {} : { timeout: options.requestTimeout }),
  });
}

/** Builds only explicitly configured gateway credentials, never caller request headers. */
export function apisixGatewayHeaders(
  environment: Readonly<NodeJS.ProcessEnv>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const apiKey = environment.APISIX_GATEWAY_API_KEY;
  const bearerToken = environment.APISIX_GATEWAY_BEARER_TOKEN;
  if (apiKey !== undefined) {
    const name = environment.APISIX_GATEWAY_API_KEY_HEADER ?? 'x-api-key';
    if (!HTTP_HEADER_NAME.test(name)) {
      throw new ConfigurationError('APISIX_GATEWAY_API_KEY_HEADER must be a valid HTTP header name');
    }
    headers[name.toLowerCase()] = apiKey;
  }
  if (bearerToken !== undefined) {
    if (Object.hasOwn(headers, 'authorization')) {
      throw new ConfigurationError(
        'APISIX gateway API key header and bearer token both configure authorization',
      );
    }
    headers.authorization = `Bearer ${bearerToken}`;
  }
  return headers;
}

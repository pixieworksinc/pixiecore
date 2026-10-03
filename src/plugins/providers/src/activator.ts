/**
 * Implements activator behavior for the providers plugin.
 */

import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { ConfigurationError } from '../../../core/contracts/errors/index.js';
import {
  LOGGING_SERVICE,
  MULTIMODAL_SERVICE,
  PROVIDER_SUPPORT_SERVICE,
} from '../../../core/contracts/plugin/services.js';
import type {
  OpenAICompatibleProviderConfig,
  ProviderRuntimeServices,
  ProviderSupportServicePort,
} from '../../../core/contracts/provider/index.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { ProviderServices } from './services.js';

/**
 * Creates provider support after validating the supplied contract.
 */
export function createProviderSupport(
  services: ProviderRuntimeServices,
): ProviderSupportServicePort {
  return Object.freeze({
    /**
     * Creates open ai compatible according to the containing class contract.
     */
    createOpenAICompatible(config: OpenAICompatibleProviderConfig) {
      return new OpenAICompatibleProvider(
        config.name,
        config.model,
        config.completionUrl,
        config.modelsUrl,
        config.headers,
        config.modelListFallback ?? [],
        services,
        config.fetch,
        config.timeout,
        config.capabilities,
      );
    },
    joinUrl,
  });
}

function joinUrl(
  baseUrl: string,
  path: string,
  query: Readonly<Record<string, string>> = {},
): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (cause) {
    throw new ConfigurationError(`Invalid provider URL: ${baseUrl}`, { cause });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigurationError(`Provider URL must use http or https: ${baseUrl}`);
  }
  if (url.username || url.password) {
    throw new ConfigurationError('Provider URL must not contain embedded credentials');
  }
  if (path) url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  url.hash = '';
  for (const [parameter, value] of Object.entries(query)) url.searchParams.set(parameter, value);
  return url.toString();
}

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    const services: ProviderServices = {
      logging: context.services.resolve(LOGGING_SERVICE),
      multimodal: context.services.resolve(MULTIMODAL_SERVICE),
    };
    context.services.register(
      PROVIDER_SUPPORT_SERVICE,
      createProviderSupport(services),
    );
  },
});

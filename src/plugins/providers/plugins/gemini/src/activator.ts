/**
 * Implements activator behavior for the providers plugin.
 */

import {
  LOGGING_SERVICE,
  MULTIMODAL_SERVICE,
  PLUGIN_ENVIRONMENT_SERVICE,
  PROVIDER_SUPPORT_SERVICE,
} from '../../../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../../../core/contracts/plugin/activation.js';
import {
  createGeminiNativeProviderFactory,
  createGeminiOpenAIProviderFactory,
} from './factory.js';

export { createGeminiNativeProviderFactory, createGeminiOpenAIProviderFactory };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    const environment = context.services.resolve(PLUGIN_ENVIRONMENT_SERVICE);
    const factories = [
      createGeminiNativeProviderFactory(environment, {
        logging: context.services.resolve(LOGGING_SERVICE),
        multimodal: context.services.resolve(MULTIMODAL_SERVICE),
      }),
      createGeminiOpenAIProviderFactory(
        environment,
        context.services.resolve(PROVIDER_SUPPORT_SERVICE),
      ),
    ];
    for (const factory of factories) {
      context.own(factory);
      context.registerProviderFactory(factory);
    }
  },
});

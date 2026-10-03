/**
 * Implements activator behavior for the providers plugin.
 */

import {
  PLUGIN_ENVIRONMENT_SERVICE,
  PROVIDER_SUPPORT_SERVICE,
} from '../../../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../../../core/contracts/plugin/activation.js';
import {
  createAzureNativeProviderFactory,
  createAzureOpenAIProviderFactory,
} from './factory.js';

export { createAzureNativeProviderFactory, createAzureOpenAIProviderFactory };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    const environment = context.services.resolve(PLUGIN_ENVIRONMENT_SERVICE);
    const support = context.services.resolve(PROVIDER_SUPPORT_SERVICE);
    for (const factory of [
      createAzureOpenAIProviderFactory(environment, support),
      createAzureNativeProviderFactory(environment, support),
    ]) {
      context.own(factory);
      context.registerProviderFactory(factory);
    }
  },
});

/**
 * Implements activator behavior for the providers plugin.
 */

import {
  PLUGIN_ENVIRONMENT_SERVICE,
  PROVIDER_SUPPORT_SERVICE,
} from '../../../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../../../core/contracts/plugin/activation.js';
import { createOpenAIProviderFactory } from './factory.js';

export { createOpenAIProviderFactory };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    const factory = createOpenAIProviderFactory(
      context.services.resolve(PLUGIN_ENVIRONMENT_SERVICE),
      context.services.resolve(PROVIDER_SUPPORT_SERVICE),
    );
    context.own(factory);
    context.registerProviderFactory(factory);
  },
});

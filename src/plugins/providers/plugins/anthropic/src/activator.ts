/**
 * Implements activator behavior for the providers plugin.
 */

import {
  LOGGING_SERVICE,
  MULTIMODAL_SERVICE,
  PLUGIN_ENVIRONMENT_SERVICE,
} from '../../../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../../../core/contracts/plugin/activation.js';
import { createAnthropicProviderFactory } from './factory.js';

export { createAnthropicProviderFactory };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    const factory = createAnthropicProviderFactory(
      context.services.resolve(PLUGIN_ENVIRONMENT_SERVICE),
      {
        logging: context.services.resolve(LOGGING_SERVICE),
        multimodal: context.services.resolve(MULTIMODAL_SERVICE),
      },
    );
    context.own(factory);
    context.registerProviderFactory(factory);
  },
});

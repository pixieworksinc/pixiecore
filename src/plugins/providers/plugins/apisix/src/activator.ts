/**
 * Registers the Apache APISIX provider factory with PixieCore.
 */

import type { PluginActivatorFactory } from '../../../../../core/contracts/plugin/activation.js';
import {
  PLUGIN_ENVIRONMENT_SERVICE,
  PROVIDER_SUPPORT_SERVICE,
} from '../../../../../core/contracts/plugin/services.js';
import { createApisixProviderFactory } from './factory.js';

export { createApisixProviderFactory };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /** Registers the APISIX provider without opening a network connection. */
  activate(context): void {
    const factory = createApisixProviderFactory(
      context.services.resolve(PLUGIN_ENVIRONMENT_SERVICE),
      context.services.resolve(PROVIDER_SUPPORT_SERVICE),
    );
    context.own(factory);
    context.registerProviderFactory(factory);
  },
});

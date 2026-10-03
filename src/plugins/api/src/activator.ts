/**
 * Implements activator behavior for the api plugin.
 */

import {
  API_SERVICE,
  LOGGING_SERVICE,
} from '../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { createApiService } from './service.js';

export { createApiService };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    context.services.register(
      API_SERVICE,
      createApiService(context.services.resolve(LOGGING_SERVICE)),
    );
  },
});

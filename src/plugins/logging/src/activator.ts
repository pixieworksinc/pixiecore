/**
 * Implements activator behavior for the logging plugin.
 */

import { LOGGING_SERVICE } from '../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { createLoggingService } from './service.js';

export { createLoggingService };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    context.services.register(LOGGING_SERVICE, createLoggingService());
  },
});

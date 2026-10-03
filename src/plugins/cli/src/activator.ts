/**
 * Implements activator behavior for the cli plugin.
 */

import { CLI_COMMAND_SERVICE } from '../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { createCliCommandService } from './service.js';

export { createCliCommandService };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    context.services.register(
      CLI_COMMAND_SERVICE,
      createCliCommandService(),
    );
  },
});

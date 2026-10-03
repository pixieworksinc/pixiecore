/**
 * Implements activator behavior for the tools plugin.
 */

import { TOOL_SERVICE } from '../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { createToolService } from './service.js';

export { createToolService };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    context.services.register(TOOL_SERVICE, createToolService());
  },
});

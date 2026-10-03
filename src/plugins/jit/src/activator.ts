/**
 * Implements activator behavior for the jit plugin.
 */

import { JIT_SERVICE } from '../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { createJitService } from './service.js';

export { createJitService };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    context.services.register(JIT_SERVICE, createJitService());
  },
});

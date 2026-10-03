/**
 * Implements activator behavior for the multimodal plugin.
 */

import { MULTIMODAL_SERVICE } from '../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { createMultimodalService } from './service.js';

export { createMultimodalService };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    context.services.register(MULTIMODAL_SERVICE, createMultimodalService());
  },
});

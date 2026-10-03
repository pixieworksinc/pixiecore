/**
 * Implements activator behavior for the runtime plugin.
 */

import {
  LOGGING_SERVICE,
  MCP_SERVICE,
  MULTIMODAL_SERVICE,
  RUNTIME_SERVICE,
  TOOL_SERVICE,
  VALIDATION_SERVICE,
} from '../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { createRuntimeService } from './service.js';

export { createRuntimeService };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    context.services.register(RUNTIME_SERVICE, createRuntimeService({
      logging: context.services.resolve(LOGGING_SERVICE),
      validation: context.services.resolve(VALIDATION_SERVICE),
      multimodal: context.services.resolve(MULTIMODAL_SERVICE),
      tools: context.services.resolve(TOOL_SERVICE),
    }, context.services.resolve(MCP_SERVICE)));
  },
});

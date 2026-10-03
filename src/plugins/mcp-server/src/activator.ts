/**
 * Implements activator behavior for the mcp server plugin.
 */

import { MCP_SERVER_SERVICE } from '../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { createMcpServerService } from './service.js';

export { createMcpServerService };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    context.services.register(MCP_SERVER_SERVICE, createMcpServerService());
  },
});

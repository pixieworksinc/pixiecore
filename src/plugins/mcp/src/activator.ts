/**
 * Implements activator behavior for the mcp plugin.
 */

import {
  MCP_SERVICE,
  PACKAGE_ROOT_SERVICE,
} from '../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { createMcpService } from './service.js';

export { createMcpService };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    const resolvePackageRoot = context.services.resolve(PACKAGE_ROOT_SERVICE);
    context.services.register(MCP_SERVICE, createMcpService(resolvePackageRoot));
  },
});

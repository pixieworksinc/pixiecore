/**
 * Implements activator behavior for the roles plugin.
 */

import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { DefaultAgentRole } from './default-agent-role.js';

export { DefaultAgentRole };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    const role = new DefaultAgentRole();
    context.own(role);
    context.registerAgentRole(role);
  },
});

/**
 * Implements activator behavior for the permissions plugin.
 */

import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { PermissionGuard } from './permission-guard.js';

export { PermissionGuard };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    const decorator = new PermissionGuard();
    context.own(decorator);
    context.registerDecorator(decorator, decorator.priority);
  },
});

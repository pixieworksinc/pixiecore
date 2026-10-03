/**
 * Implements activator behavior for the validation plugin.
 */

import { VALIDATION_SERVICE } from '../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { SchemaGuard } from './schema/guard.js';
import { createValidationService } from './service.js';

export { SchemaGuard, createValidationService };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    context.services.register(VALIDATION_SERVICE, createValidationService());
    const decorator = new SchemaGuard();
    context.own(decorator);
    context.registerDecorator(decorator, decorator.priority);
  },
});

/**
 * Implements activator behavior for the recipe plugin.
 */

import { RECIPE_SERVICE } from '../../../core/contracts/plugin/services.js';
import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { createRecipeService } from './service.js';

export { createRecipeService };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    context.services.register(RECIPE_SERVICE, createRecipeService());
  },
});

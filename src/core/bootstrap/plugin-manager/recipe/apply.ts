/**
 * Provides apply bootstrapping behavior for PixieCore.
 */

import type { PluginHost } from '../manager.js';
import { activateCorePluginRoots } from '../manager.js';
import type { PluginRecipeActivationPlan } from './types.js';

/** Applies an already validated recipe without adding a second lifecycle owner. */
export function applyPluginRecipe(
  manager: PluginHost,
  plan: PluginRecipeActivationPlan,
): void {
  activateCorePluginRoots(manager, plan.activationRootIds);
}

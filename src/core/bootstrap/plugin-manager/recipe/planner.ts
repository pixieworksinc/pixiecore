/**
 * Provides planner bootstrapping behavior for PixieCore.
 */

import { PluginLoadError } from '../../../contracts/errors/index.js';
import type { SynchronousPluginDefinition } from '../model/definition.js';
import type {
  PluginRecipeActivationPlan,
  PluginRecipeDefinition,
} from './types.js';

const RECIPE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

/** Validates a recipe against its catalog and creates an immutable activation plan. */
export function planPluginRecipe(
  recipe: PluginRecipeDefinition,
  definitions: readonly SynchronousPluginDefinition[],
): PluginRecipeActivationPlan {
  validateRecipeIdentity(recipe);
  const definitionsById = new Map(definitions.map(definition => [
    definition.descriptor.id,
    definition,
  ]));
  if (definitionsById.size !== definitions.length) {
    throw new PluginLoadError(`Recipe ${recipe.id} cannot use a catalog with duplicate plugin ids`);
  }

  const pluginIds = uniqueRecipeIds(recipe.id, 'plugins', recipe.plugins);
  const selected = new Set(pluginIds);
  for (const pluginId of pluginIds) {
    const definition = definitionsById.get(pluginId);
    if (!definition) {
      throw new PluginLoadError(`Recipe ${recipe.id} references unknown plugin ${pluginId}`);
    }
    const parentId = definition.descriptor.parentId;
    if (parentId !== undefined && !selected.has(parentId)) {
      throw new PluginLoadError(
        `Recipe ${recipe.id} plugin ${pluginId} requires parent plugin ${parentId}`,
      );
    }
    for (const dependencyId of Object.keys(definition.descriptor.requires)) {
      if (!selected.has(dependencyId)) {
        throw new PluginLoadError(
          `Recipe ${recipe.id} plugin ${pluginId} requires omitted plugin ${dependencyId}`,
        );
      }
    }
  }
  for (const pluginId of definitionsById.keys()) {
    if (!selected.has(pluginId)) {
      throw new PluginLoadError(`Recipe ${recipe.id} omits catalog plugin ${pluginId}`);
    }
  }

  const activationRootIds = uniqueRecipeIds(recipe.id, 'activate', recipe.activate);
  for (const pluginId of activationRootIds) {
    if (!selected.has(pluginId)) {
      throw new PluginLoadError(
        `Recipe ${recipe.id} activates plugin ${pluginId} without including it`,
      );
    }
  }

  return Object.freeze({
    recipeId: recipe.id,
    locked: recipe.locked,
    pluginIds,
    activationRootIds,
  });
}

function validateRecipeIdentity(recipe: PluginRecipeDefinition): void {
  if (recipe.schema !== 'pixiecore.recipe/v1') {
    throw new PluginLoadError(`Recipe ${recipe.id || '<unknown>'} has an invalid schema`);
  }
  if (!RECIPE_ID_PATTERN.test(recipe.id)) {
    throw new PluginLoadError('Recipe requires a lowercase namespaced id');
  }
  if (!recipe.name.trim()) throw new PluginLoadError(`Recipe ${recipe.id} requires a name`);
  if (!recipe.version.trim()) throw new PluginLoadError(`Recipe ${recipe.id} requires a version`);
  if (!recipe.description.trim()) {
    throw new PluginLoadError(`Recipe ${recipe.id} requires a description`);
  }
  if (recipe.locked !== true) {
    throw new PluginLoadError(`Recipe ${recipe.id} must lock its bundled plugin foundation`);
  }
}

function uniqueRecipeIds(
  recipeId: string,
  field: 'plugins' | 'activate',
  values: readonly string[],
): readonly string[] {
  const normalized = values.map(value => value.trim());
  const invalid = normalized.find(value => !value);
  if (invalid !== undefined) {
    throw new PluginLoadError(`Recipe ${recipeId} ${field} contains an empty plugin id`);
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new PluginLoadError(`Recipe ${recipeId} ${field} contains duplicate plugin ids`);
  }
  return Object.freeze(normalized);
}

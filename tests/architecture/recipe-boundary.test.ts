import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginManager as PublicPluginManager } from '../../src/index.js';
import {
  activateCorePluginRoots,
  PluginHost,
  resolvePluginService,
} from '../../src/core/bootstrap/plugin-manager/manager.js';
import {
  applyPluginRecipe,
  planPluginRecipe,
  type PluginRecipeDefinition,
} from '../../src/core/bootstrap/plugin-manager/recipe/index.js';
import { CORE_PLUGIN_CATALOG } from '../../src/core/kernel/generated/core-plugin-catalog.generated.js';
import { RECIPE_SERVICE } from '../../src/core/contracts/plugin/services.js';
import { PIXIECORE_STANDARD_RECIPE } from '../../src/plugins/recipe/recipe.js';
import { createCorePluginCatalog } from '../../src/core/kernel/plugin/catalog.js';

test('generic bootstrap activates only Recipe before applying its composition', async () => {
  const catalog = createCorePluginCatalog();
  const manager = new PluginHost(
    undefined,
    {},
    { pluginConfigPath: 'disabled' },
    catalog,
  );
  try {
    assert.deepEqual(manager.getPluginStatus().plugins, []);
    assert.equal(manager.getAgentRole('default'), undefined);
    assert.equal(manager.getProvider('openai'), undefined);

    activateCorePluginRoots(manager, 'pixiecore.recipe');
    const bootstrapStatus = manager.getPluginStatus().plugins;
    assert.deepEqual(
      bootstrapStatus.filter(plugin => plugin.activated).map(plugin => plugin.id),
      ['pixiecore.recipe'],
    );
    assert.ok(
      bootstrapStatus
        .filter(plugin => plugin.id !== 'pixiecore.recipe')
        .every(plugin => plugin.enabled && !plugin.activated),
    );
    const recipe = resolvePluginService(manager, RECIPE_SERVICE).standardRecipe();
    assert.equal(recipe, PIXIECORE_STANDARD_RECIPE);

    const plan = planPluginRecipe(recipe, catalog.synchronousDefinitions());
    applyPluginRecipe(manager, plan);
    applyPluginRecipe(manager, plan);

    assert.equal(manager.getPluginStatus().plugins.length, CORE_PLUGIN_CATALOG.length);
    assert.ok(manager.getAgentRole('default'));
    assert.ok(manager.getProvider('openai'));
  } finally {
    await manager.close();
  }
});

test('public compatibility manager applies the locked standard recipe', async () => {
  const manager = new PublicPluginManager(undefined, {}, { pluginConfigPath: 'disabled' });
  try {
    const status = manager.getPluginStatus().plugins;
    assert.equal(status.length, PIXIECORE_STANDARD_RECIPE.plugins.length);
    assert.ok(status.every(plugin => plugin.enabled && plugin.locked));
    assert.deepEqual(
      status.map(plugin => plugin.id).sort(),
      [...PIXIECORE_STANDARD_RECIPE.plugins].sort(),
    );
  } finally {
    await manager.close();
  }
});

test('recipe planning rejects unknown, duplicate, incomplete, and uninstalled activation ids', () => {
  const definitions = createCorePluginCatalog().synchronousDefinitions();
  assert.throws(
    () => planPluginRecipe(recipe({ plugins: [...PIXIECORE_STANDARD_RECIPE.plugins, 'pixiecore.unknown'] }), definitions),
    /unknown plugin pixiecore\.unknown/,
  );
  assert.throws(
    () => planPluginRecipe(recipe({ activate: ['pixiecore.roles', 'pixiecore.roles'] }), definitions),
    /activate contains duplicate plugin ids/,
  );
  assert.throws(
    () => planPluginRecipe(recipe({
      plugins: PIXIECORE_STANDARD_RECIPE.plugins.filter(id => id !== 'pixiecore.providers'),
    }), definitions),
    /requires parent plugin pixiecore\.providers/,
  );
  assert.throws(
    () => planPluginRecipe(recipe({
      plugins: PIXIECORE_STANDARD_RECIPE.plugins.filter(id => id !== 'pixiecore.jit'),
      activate: PIXIECORE_STANDARD_RECIPE.activate,
    }), definitions),
    /omits catalog plugin pixiecore\.jit/,
  );
  assert.throws(
    () => planPluginRecipe(recipe({
      plugins: PIXIECORE_STANDARD_RECIPE.plugins.filter(id => id !== 'pixiecore.jit'),
      activate: ['pixiecore.jit'],
    }), definitions.filter(definition => definition.descriptor.id !== 'pixiecore.jit')),
    /activates plugin pixiecore\.jit without including it/,
  );
  assert.throws(
    () => planPluginRecipe(recipe({ locked: false as never }), definitions),
    /must lock its bundled plugin foundation/,
  );
});

function recipe(
  override: Partial<PluginRecipeDefinition>,
): PluginRecipeDefinition {
  return {
    ...PIXIECORE_STANDARD_RECIPE,
    ...override,
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecipeService } from '../../src/service.js';

test('mandatory Recipe plugin exposes the locked standard composition', () => {
  const recipe = createRecipeService().standardRecipe();

  assert.equal(recipe.id, 'pixiecore.standard');
  assert.equal(recipe.locked, true);
  assert.equal(recipe.plugins[0], 'pixiecore.recipe');
  assert.equal(recipe.activate[0], 'pixiecore.recipe');
  assert.ok(Object.isFrozen(recipe));
  assert.ok(Object.isFrozen(recipe.plugins));
  assert.ok(Object.isFrozen(recipe.activate));
});

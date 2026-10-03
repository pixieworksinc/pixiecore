import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { runCoreRecipe } from '../../scripts/generate-core-recipe.mjs';
import { withTempDirectory } from '../helpers/temp.js';

test('core recipe generation is deterministic and rejects catalog drift', async () => {
  await withTempDirectory(async root => {
    const pluginRoot = join(root, 'src', 'plugins', 'example');
    const recipePluginRoot = join(root, 'src', 'plugins', 'recipe');
    const recipesRoot = join(recipePluginRoot, 'recipes');
    await Promise.all([
      mkdir(pluginRoot, { recursive: true }),
      mkdir(recipesRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, 'package.json'), JSON.stringify({
        name: 'recipe-fixture',
        private: true,
        type: 'module',
        version: '1.0.0',
        pixiecore: { plugins: './plugins' },
      })),
      writeFile(join(pluginRoot, 'example.yaml'), pluginManifest()),
      writeFile(join(pluginRoot, 'example.ts'), pluginActivator()),
      writeFile(join(recipePluginRoot, 'recipe.yaml'), recipePluginManifest()),
      writeFile(join(recipePluginRoot, 'recipe.ts'), recipePluginActivator()),
      writeFile(join(recipesRoot, 'pixiecore.recipe.yaml'), recipeManifest()),
    ]);

    const write = await runGenerator(root, '--write');
    assert.equal(write.exitCode, 0, write.output);
    const generatedPath = join(
      root,
      'src',
      'plugins',
      'recipe',
      'src',
      'generated',
      'core-recipe.generated.ts',
    );
    const generated = await readFile(generatedPath, 'utf8');
    assert.match(generated, /PIXIECORE_STANDARD_RECIPE/);
    assert.doesNotMatch(generated, /RECIPE_PLUGIN_MANIFEST/);
    assert.match(generated, /"pixiecore\.recipe"/);
    assert.match(generated, /"pixiecore\.example"/);

    const current = await runGenerator(root, '--check');
    assert.equal(current.exitCode, 0, current.output);

    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'recipe-fixture',
      private: true,
      type: 'module',
      version: '1.0.0',
      pixiecore: { plugins: '../plugins' },
    }));
    const escapedPluginRoot = await runGenerator(root, '--check');
    assert.equal(escapedPluginRoot.exitCode, 1, escapedPluginRoot.output);
    assert.match(escapedPluginRoot.output, /pixiecore\.plugins to be \.\/plugins/);
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'recipe-fixture',
      private: true,
      type: 'module',
      version: '1.0.0',
      pixiecore: { plugins: './plugins' },
    }));

    await writeFile(generatedPath, `${generated}// stale\n`);
    const stale = await runGenerator(root, '--check');
    assert.equal(stale.exitCode, 1, stale.output);
    assert.match(stale.output, /is stale/);

    await writeFile(
      join(recipesRoot, 'pixiecore.recipe.yaml'),
      recipeManifest().replace('  - pixiecore.example\n', '  - pixiecore.unknown\n'),
    );
    const missing = await runGenerator(root, '--check');
    assert.equal(missing.exitCode, 1, missing.output);
    assert.match(missing.output, /omits locked core plugin pixiecore\.example/);
  });
});

function pluginManifest(): string {
  return `schema: pixiecore.plugin/v1
id: pixiecore.example
name: Recipe Fixture
version: '1.0.0'
description: Exercises deterministic recipe generation.
entry: ./example.js
requires: {}
optional_requires: {}
conflicts: {}
components:
  - type: agent_role
    export: ExampleRole
    roles_supported: [example]
`;
}

function recipePluginManifest(): string {
  return `schema: pixiecore.plugin/v1
id: pixiecore.recipe
name: Recipe
version: '1.0.0'
description: Supplies the mandatory locked recipe.
entry: ./recipe.js
requires: {}
optional_requires: {}
conflicts: {}
components:
  - type: service
    export: createRecipeService
    service_id: pixiecore.service.recipe
`;
}

function pluginActivator(): string {
  return `export class ExampleRole {}
export const createCorePluginActivator = () => ({ activate() {} });
`;
}

function recipePluginActivator(): string {
  return `export const createRecipeService = {};
export const createCorePluginActivator = () => ({ activate() {} });
`;
}

function recipeManifest(): string {
  return `schema: pixiecore.recipe/v1
id: pixiecore.standard
name: Fixture Standard
version: 1.0.0
description: Exercises deterministic recipe generation.
locked: true
plugins:
  - pixiecore.recipe
  - pixiecore.example
activate:
  - pixiecore.recipe
  - pixiecore.example
`;
}

async function runGenerator(root: string, mode: '--write' | '--check') {
  return runCoreRecipe({ root, mode: mode.slice(2) as 'write' | 'check' });
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import test from 'node:test';
import YAML from 'yaml';

const recipe = YAML.parse(await readFile(fileURLToPath(new URL(
  '../../src/plugins/recipe/recipes/pixiecore.recipe.yaml',
  import.meta.url,
)), 'utf8')) as Record<string, unknown>;
const schema = JSON.parse(await readFile(fileURLToPath(new URL(
  '../../schemas/pixiecore.recipe-v1.schema.json',
  import.meta.url,
)), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

test('published Recipe schema accepts the canonical locked standard Recipe', () => {
  assert.equal(validate(recipe), true, JSON.stringify(validate.errors));
  assert.equal(recipe.locked, true);
  assert.equal(new Set(recipe.plugins as string[]).size, 24);
});

test('published Recipe schema rejects unlocked, duplicate, and extended definitions', () => {
  for (const invalid of [
    { ...recipe, locked: false },
    { ...recipe, plugins: [...recipe.plugins as string[], (recipe.plugins as string[])[0]] },
    { ...recipe, executable: './apply.js' },
  ]) {
    assert.equal(validate(invalid), false, JSON.stringify(invalid));
  }
});

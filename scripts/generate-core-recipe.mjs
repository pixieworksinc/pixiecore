#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  loadCorePluginMetadata,
  validateManifest,
} from './generate-core-plugin-catalog.mjs';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = dirname(SCRIPT_DIRECTORY);
const RECIPE_PLUGIN_MANIFEST_PATH = 'src/plugins/recipe/recipe.yaml';
const RECIPE_PATH = 'src/plugins/recipe/recipes/pixiecore.recipe.yaml';
const GENERATED_PATH = 'src/plugins/recipe/src/generated/core-recipe.generated.ts';

if (isMainModule()) {
  const command = await runCoreRecipe(parseArguments(process.argv.slice(2)));
  const destination = command.exitCode === 0 ? process.stdout : process.stderr;
  destination.write(command.output);
  process.exitCode = command.exitCode;
}

/** Runs Recipe generation without process or console side effects. */
export async function runCoreRecipe(options = {}) {
  const mode = options.mode ?? 'check';
  const repositoryRoot = resolve(options.root ?? DEFAULT_REPOSITORY_ROOT);
  try {
    const { recipe } = await loadAndValidateRecipe(repositoryRoot);
    const generated = renderRecipe(recipe);
    const outputPath = resolve(repositoryRoot, GENERATED_PATH);
    if (mode === 'write') {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, generated);
      return Object.freeze({
        exitCode: 0,
        output: `Generated ${relative(repositoryRoot, outputPath)} from ${RECIPE_PATH}.\n`,
      });
    }

    const current = await readFile(outputPath, 'utf8').catch(() => undefined);
    if (current !== generated) {
      throw new Error(
        `${relative(repositoryRoot, outputPath)} is stale; run npm run generate:core-plugin-catalog`,
      );
    }
    return Object.freeze({
      exitCode: 0,
      output: `Core recipe is current: ${recipe.plugins.length} locked plugins.\n`,
    });
  } catch (error) {
    return Object.freeze({
      exitCode: 1,
      output: `Core recipe ${mode} failed: ${errorMessage(error)}\n`,
    });
  }
}

async function loadAndValidateRecipe(root) {
  const packageMetadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const pluginSource = await readFile(resolve(root, RECIPE_PLUGIN_MANIFEST_PATH), 'utf8');
  const pluginManifest = validateManifest(
    YAML.parse(pluginSource, { maxAliasCount: 0, uniqueKeys: true }),
    RECIPE_PLUGIN_MANIFEST_PATH,
    './recipe.js',
  );
  if (pluginManifest.id !== 'pixiecore.recipe') {
    throw new Error(`${RECIPE_PLUGIN_MANIFEST_PATH} id must be pixiecore.recipe`);
  }
  if (pluginManifest.version !== packageMetadata.version) {
    throw new Error(
      `${RECIPE_PLUGIN_MANIFEST_PATH} version must match package version ${packageMetadata.version}`,
    );
  }
  const source = await readFile(resolve(root, RECIPE_PATH), 'utf8');
  const recipe = YAML.parse(source, { maxAliasCount: 0, uniqueKeys: true });
  if (!isRecord(recipe)) throw new Error(`${RECIPE_PATH} must contain an object`);

  const fields = new Set([
    'schema',
    'id',
    'name',
    'version',
    'description',
    'locked',
    'plugins',
    'activate',
  ]);
  const unknown = Object.keys(recipe).find(field => !fields.has(field));
  if (unknown !== undefined) throw new Error(`${RECIPE_PATH} contains unknown field ${unknown}`);
  if (recipe.schema !== 'pixiecore.recipe/v1') {
    throw new Error(`${RECIPE_PATH} requires schema pixiecore.recipe/v1`);
  }
  for (const field of ['id', 'name', 'version', 'description']) {
    if (typeof recipe[field] !== 'string' || !recipe[field].trim()) {
      throw new Error(`${RECIPE_PATH} requires non-empty ${field}`);
    }
  }
  if (recipe.id !== 'pixiecore.standard') {
    throw new Error(`${RECIPE_PATH} id must be pixiecore.standard`);
  }
  if (recipe.version !== packageMetadata.version) {
    throw new Error(`${RECIPE_PATH} version must match package version ${packageMetadata.version}`);
  }
  if (recipe.locked !== true) throw new Error(`${RECIPE_PATH} must be locked`);
  const plugins = validateIdList(recipe.plugins, 'plugins');
  const activate = validateIdList(recipe.activate, 'activate');
  const metadata = await loadCorePluginMetadata(root);
  const catalogIds = metadata.map(plugin => plugin.manifest.id);
  assertSameIds(plugins, catalogIds);
  for (const id of activate) {
    if (!plugins.includes(id)) throw new Error(`${RECIPE_PATH} activates plugin not installed: ${id}`);
  }
  return Object.freeze({
    recipe: Object.freeze({
      schema: recipe.schema,
      id: recipe.id,
      name: recipe.name.trim(),
      version: recipe.version,
      description: recipe.description.trim(),
      locked: recipe.locked,
      plugins,
      activate,
    }),
  });
}

function validateIdList(value, field) {
  if (!Array.isArray(value)) throw new Error(`${RECIPE_PATH} ${field} must be an array`);
  const ids = value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`${RECIPE_PATH} ${field}[${index}] must be a non-empty string`);
    }
    return item.trim();
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${RECIPE_PATH} ${field} contains duplicate plugin ids`);
  }
  return Object.freeze(ids);
}

function assertSameIds(recipeIds, catalogIds) {
  const recipeSet = new Set(recipeIds);
  const catalogSet = new Set(catalogIds);
  const missing = catalogIds.filter(id => !recipeSet.has(id));
  const unknown = recipeIds.filter(id => !catalogSet.has(id));
  if (missing.length > 0) {
    throw new Error(`${RECIPE_PATH} omits locked core plugin ${missing[0]}`);
  }
  if (unknown.length > 0) {
    throw new Error(`${RECIPE_PATH} references unknown core plugin ${unknown[0]}`);
  }
}

function renderRecipe(recipe) {
  return [
    '// Generated by scripts/generate-core-recipe.mjs. Do not edit.',
    '',
    "import type { PluginRecipeDefinition } from '../../../../core/contracts/recipe/index.js';",
    '',
    `export const PIXIECORE_STANDARD_RECIPE = ${renderFrozenValue(recipe, 0)} satisfies PluginRecipeDefinition;`,
    '',
  ].join('\n');
}

function renderFrozenValue(value, indent) {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Object.freeze([])';
    const padding = ' '.repeat(indent);
    const childPadding = ' '.repeat(indent + 2);
    return `Object.freeze([\n${value.map(item => `${childPadding}${renderFrozenValue(item, indent + 2)},`).join('\n')}\n${padding}])`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return 'Object.freeze({})';
    const padding = ' '.repeat(indent);
    const childPadding = ' '.repeat(indent + 2);
    return `Object.freeze({\n${entries.map(([key, item]) => `${childPadding}${renderKey(key)}: ${renderFrozenValue(item, indent + 2)},`).join('\n')}\n${padding}})`;
  }
  return JSON.stringify(value);
}

function renderKey(value) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
}

function parseArguments(args) {
  let mode = 'check';
  let root;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--write') mode = 'write';
    else if (argument === '--check') mode = 'check';
    else if (argument === '--root') root = args[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return { mode, root };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Determines whether this module is the invoked CLI entry point. */
function isMainModule() {
  return process.argv[1] !== undefined
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

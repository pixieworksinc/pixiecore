#!/usr/bin/env node

import { constants } from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { resolveDependencyOrder } from '../src/core/bootstrap/plugin-manager/dependency/order.ts';
import {
  CORE_PLUGIN_ID_PATTERN,
  SEMVER_2_PATTERN,
  trustedPluginManifestFields,
  PIXIECORE_PLUGIN_MANIFEST_SCHEMA,
  unknownPluginManifestFields,
} from '../src/core/bootstrap/plugin-manager/model/constants.ts';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = dirname(SCRIPT_DIRECTORY);
const CATALOG_PATH = 'src/core/kernel/generated/core-plugin-catalog.generated.ts';
const semver = createRequire(import.meta.url)('semver');
let activatorImportSequence = 0;

if (isMainModule()) {
  const command = await runCorePluginCatalog(parseArguments(process.argv.slice(2)));
  const destination = command.exitCode === 0 ? process.stdout : process.stderr;
  destination.write(command.output);
  process.exitCode = command.exitCode;
}

/** Runs catalog generation without process or console side effects. */
export async function runCorePluginCatalog(options = {}) {
  const mode = options.mode ?? 'check';
  const repositoryRoot = resolve(options.root ?? DEFAULT_REPOSITORY_ROOT);
  try {
    const plugins = await loadCorePluginMetadata(repositoryRoot);
    const generated = renderCatalog(plugins);
    const outputPath = resolve(repositoryRoot, CATALOG_PATH);
    if (mode === 'write') {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, generated);
      return Object.freeze({
        exitCode: 0,
        output: `Generated ${relative(repositoryRoot, outputPath)} from ${plugins.length} core manifests.\n`,
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
      output: `Core plugin catalog is current: ${plugins.length} canonical manifests.\n`,
    });
  } catch (error) {
    return Object.freeze({
      exitCode: 1,
      output: `Core plugin catalog ${mode} failed: ${errorMessage(error)}\n`,
    });
  }
}

export async function discoverCorePluginManifests(repositoryRootPath = DEFAULT_REPOSITORY_ROOT) {
  return (await discoverCorePluginUnits(repositoryRootPath))
    .map(unit => unit.manifestPath);
}

async function discoverCorePluginUnits(repositoryRootPath, suppliedPackageMetadata) {
  const root = resolve(repositoryRootPath);
  const packageMetadata = suppliedPackageMetadata
    ?? JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const pluginsRoot = configuredCorePluginsRoot(root, packageMetadata);
  const units = [];

  const visit = async (containerRoot, parentManifestPath) => {
    const entries = await readdir(containerRoot, { withFileTypes: true });
    for (const entry of entries
      .filter(value => value.isDirectory())
      .sort((left, right) => compareIds(left.name, right.name))) {
      const pluginRoot = resolve(containerRoot, entry.name);
      const manifestPath = resolve(pluginRoot, `${entry.name}.yaml`);
      await access(manifestPath, constants.R_OK).catch(() => {
        throw new Error(`Core plugin ${entry.name} requires ${entry.name}.yaml`);
      });
      units.push({
        pluginRoot,
        name: entry.name,
        manifestPath,
        ...(parentManifestPath === undefined ? {} : { parentManifestPath }),
      });
      const childPluginsRoot = resolve(pluginRoot, 'plugins');
      const childEntries = await readdir(childPluginsRoot, { withFileTypes: true })
        .catch(error => {
          if (error?.code === 'ENOENT') return undefined;
          throw error;
        });
      if (childEntries !== undefined) await visit(childPluginsRoot, manifestPath);
    }
  };

  await visit(pluginsRoot, undefined);
  return units;
}

function configuredCorePluginsRoot(repositoryRootPath, packageMetadata) {
  const configured = packageMetadata?.pixiecore?.plugins;
  if (configured !== './plugins') {
    throw new Error('package.json requires pixiecore.plugins to be ./plugins');
  }
  const sourceRoot = resolve(repositoryRootPath, 'src');
  const pluginsRoot = resolve(sourceRoot, configured);
  const nested = relative(sourceRoot, pluginsRoot);
  if (isAbsolute(nested) || nested === '..' || nested.startsWith(`..${sep}`)) {
    throw new Error('package.json pixiecore.plugins must resolve inside src');
  }
  return pluginsRoot;
}

export async function loadCorePluginMetadata(repositoryRootPath = DEFAULT_REPOSITORY_ROOT) {
  const root = resolve(repositoryRootPath);
  const packageMetadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const pluginsRoot = configuredCorePluginsRoot(root, packageMetadata);
  const packageVersion = requiredString(packageMetadata.version, 'package version', 'package.json');
  const units = await discoverCorePluginUnits(root, packageMetadata);
  const ids = new Set();
  const plugins = [];
  const pluginByManifestPath = new Map();

  for (const unit of units) {
    const { manifestPath, pluginRoot, name } = unit;
    const directory = normalizePath(relative(pluginsRoot, pluginRoot));
    if (!directory || directory.startsWith('../')) {
      throw new Error(`Core plugin manifest escapes the configured plugin root: ${manifestPath}`);
    }
    const source = await readFile(manifestPath, 'utf8');
    const parsed = YAML.parse(source, { maxAliasCount: 0, uniqueKeys: true });
    const manifest = validateManifest(
      parsed,
      normalizePath(relative(root, manifestPath)),
      `./${name}.js`,
    );
    const parent = unit.parentManifestPath === undefined
      ? undefined
      : pluginByManifestPath.get(unit.parentManifestPath);
    if (unit.parentManifestPath !== undefined && !parent) {
      throw new Error(`Nested core plugin has no discovered parent: ${manifestPath}`);
    }
    if (parent && !manifest.id.startsWith(`${parent.manifest.id}.`)) {
      throw new Error(
        `Nested core plugin id must begin with ${parent.manifest.id}.: ${manifestPath}`,
      );
    }
    if (manifest.version !== packageVersion) {
      throw new Error(`Core plugin version must match package version ${packageVersion}: ${manifestPath}`);
    }
    if (ids.has(manifest.id)) throw new Error(`Duplicate core plugin id: ${manifest.id}`);
    ids.add(manifest.id);

    const plugin = {
      directory,
      name,
      manifest,
      manifestPath,
      ...(parent === undefined ? {} : { parentId: parent.manifest.id }),
    };
    plugins.push(plugin);
    pluginByManifestPath.set(manifestPath, plugin);
  }

  const ordered = validateAndOrderCorePlugins(plugins);
  for (const plugin of ordered) {
    const pluginRoot = dirname(plugin.manifestPath);
    const manifestPath = plugin.manifestPath;

    const activatorPath = resolve(pluginRoot, `${plugin.name}.ts`);
    await access(activatorPath, constants.R_OK).catch(() => {
      throw new Error(`Core plugin manifest requires ${plugin.name}.ts: ${manifestPath}`);
    });
    const activatorUrl = pathToFileURL(activatorPath);
    activatorUrl.searchParams.set('pixiecore_catalog_load', String(++activatorImportSequence));
    const activator = await import(activatorUrl.href);
    validateActivatorModule(activator, plugin.manifest, activatorPath);
  }

  return ordered.map(({ directory, name, manifest, parentId }) => ({
    directory,
    name,
    manifest,
    ...(parentId === undefined ? {} : { parentId }),
  }));
}

export function renderCatalog(plugins) {
  const lines = [
    '// Generated by scripts/generate-core-plugin-catalog.mjs. Do not edit.',
    '',
  ];
  for (const [index, plugin] of plugins.entries()) {
    lines.push(
      `import { createCorePluginActivator as createCorePluginActivator${index} } from '../../../plugins/${plugin.directory}/${plugin.name}.js';`,
    );
  }
  lines.push(
    "import type { StaticCorePluginCatalogEntry } from '../../bootstrap/plugin-manager/model/definition.js';",
    '',
    'export const CORE_PLUGIN_CATALOG = Object.freeze([',
  );
  for (const [index, plugin] of plugins.entries()) {
    lines.push(
      '  Object.freeze({',
      ...(plugin.parentId === undefined ? [] : [`    parentId: ${JSON.stringify(plugin.parentId)},`]),
      `    manifest: ${renderFrozenValue(plugin.manifest, 4)},`,
      `    manifestUrl: new URL('../../../../plugins/${plugin.directory}/${plugin.name}.yaml', import.meta.url),`,
      `    createActivator: createCorePluginActivator${index},`,
      '  }),',
    );
  }
  lines.push(
    ']) satisfies readonly StaticCorePluginCatalogEntry[];',
    '',
  );
  return lines.join('\n');
}

export function validateManifest(value, path, expectedEntry) {
  if (!isRecord(value)) throw new Error(`Core plugin manifest must be an object: ${path}`);
  const trustedField = trustedPluginManifestFields(value)[0];
  if (trustedField !== undefined) {
    throw new Error(`Core plugin manifest may not define trusted field ${trustedField}: ${path}`);
  }
  const unknownField = unknownPluginManifestFields(value)[0];
  if (unknownField !== undefined) {
    throw new Error(`Core plugin manifest contains unknown field ${unknownField}: ${path}`);
  }
  if (value.schema !== PIXIECORE_PLUGIN_MANIFEST_SCHEMA) {
    throw new Error(`Core plugin manifest requires schema pixiecore.plugin/v1: ${path}`);
  }
  const id = requiredString(value.id, 'id', path);
  if (!CORE_PLUGIN_ID_PATTERN.test(id)) {
    throw new Error(`Core plugin id must use the reserved pixiecore namespace: ${path}`);
  }
  const version = requiredString(value.version, 'version', path);
  if (!SEMVER_2_PATTERN.test(version) || !semver.valid(version)) {
    throw new Error(`Core plugin version must be SemVer 2.0: ${path}`);
  }
  const entry = requiredString(value.entry, 'entry', path);
  if (entry !== expectedEntry) {
    throw new Error(`Core plugin entry must be ${expectedEntry}: ${path}`);
  }
  if (!Array.isArray(value.components) || value.components.length === 0) {
    throw new Error(`Core plugin manifest requires at least one component: ${path}`);
  }
  const components = value.components.map((component, index) => (
    validateComponent(component, path, index)
  ));
  const componentKeys = new Set();
  for (const component of components) {
    const key = componentIdentity(component);
    if (componentKeys.has(key)) throw new Error(`Duplicate core plugin component ${key}: ${path}`);
    componentKeys.add(key);
  }
  return {
    schema: PIXIECORE_PLUGIN_MANIFEST_SCHEMA,
    id,
    name: requiredString(value.name, 'name', path),
    version,
    description: requiredString(value.description, 'description', path),
    entry: expectedEntry,
    requires: dependencyMap(value.requires, 'requires', path),
    optional_requires: dependencyMap(value.optional_requires, 'optional_requires', path),
    conflicts: dependencyMap(value.conflicts, 'conflicts', path),
    components,
  };
}

function validateComponent(value, path, index) {
  if (!isRecord(value)) throw new Error(`Core plugin component ${index} must be an object: ${path}`);
  const type = requiredString(value.type, `components[${index}].type`, path);
  const exported = requiredString(value.export, `components[${index}].export`, path);
  if (type === 'agent_role') {
    assertOnlyFields(value, new Set(['type', 'export', 'roles_supported']), path, index);
    if (!Array.isArray(value.roles_supported) || value.roles_supported.length === 0) {
      throw new Error(`Core agent role component requires roles_supported: ${path}`);
    }
    return {
      type,
      export: exported,
      roles_supported: value.roles_supported.map((role, roleIndex) => (
        requiredString(role, `components[${index}].roles_supported[${roleIndex}]`, path)
      )),
    };
  }
  if (type === 'decorator') {
    assertOnlyFields(value, new Set(['type', 'export', 'priority', 'stage']), path, index);
    if (typeof value.priority !== 'number' || !Number.isFinite(value.priority)) {
      throw new Error(`Core decorator component requires a finite priority: ${path}`);
    }
    if (!['before', 'after', 'both'].includes(value.stage)) {
      throw new Error(`Core decorator component has an invalid stage: ${path}`);
    }
    return { type, export: exported, priority: value.priority, stage: value.stage };
  }
  if (type === 'provider') {
    assertOnlyFields(value, new Set(['type', 'export', 'provider_name']), path, index);
    return {
      type,
      export: exported,
      provider_name: requiredString(
        value.provider_name,
        `components[${index}].provider_name`,
        path,
      ),
    };
  }
  if (type === 'extension') {
    assertOnlyFields(value, new Set(['type', 'export', 'extension_point']), path, index);
    return {
      type,
      export: exported,
      extension_point: requiredString(
        value.extension_point,
        `components[${index}].extension_point`,
        path,
      ),
    };
  }
  if (type === 'tool') {
    assertOnlyFields(value, new Set(['type', 'export', 'tool_name']), path, index);
    return {
      type,
      export: exported,
      tool_name: requiredString(value.tool_name, `components[${index}].tool_name`, path),
    };
  }
  if (type === 'service') {
    assertOnlyFields(value, new Set(['type', 'export', 'service_id']), path, index);
    return {
      type,
      export: exported,
      service_id: requiredString(
        value.service_id,
        `components[${index}].service_id`,
        path,
      ),
    };
  }
  if (type === 'command') {
    assertOnlyFields(value, new Set(['type', 'export', 'command_names']), path, index);
    return {
      type,
      export: exported,
      command_names: requiredUniqueStringArray(
        value.command_names,
        `components[${index}].command_names`,
        path,
      ),
    };
  }
  throw new Error(`Core plugin component has unsupported type ${type}: ${path}`);
}

function validateActivatorModule(module, manifest, path) {
  for (const component of manifest.components) {
    if (!Object.hasOwn(module, component.export)) {
      throw new Error(`Core plugin activator does not export component ${component.export}: ${path}`);
    }
  }
  if (typeof module.createCorePluginActivator !== 'function') {
    throw new Error(`Core plugin activator must export createCorePluginActivator(): ${path}`);
  }
  const first = module.createCorePluginActivator();
  const second = module.createCorePluginActivator();
  if (!first || typeof first.activate !== 'function' || !second || typeof second.activate !== 'function') {
    throw new Error(`Core plugin activator factory returned an invalid value: ${path}`);
  }
  if (first === second) throw new Error(`Core plugin activator factory must return fresh values: ${path}`);
  if (first.activate.constructor.name === 'AsyncFunction') {
    throw new Error(`Core plugin activator must be synchronous: ${path}`);
  }
}

function dependencyMap(value, field, path) {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`Core plugin ${field} must be an object: ${path}`);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (!CORE_PLUGIN_ID_PATTERN.test(key)) {
      throw new Error(`Core plugin ${field} may reference only core plugin ids, found ${key}: ${path}`);
    }
    const range = requiredString(value[key], `${field}.${key}`, path);
    if (!semver.validRange(range)) {
      throw new Error(
        `Core plugin ${field}.${key} must be an npm-compatible version range: ${path}`,
      );
    }
    result[key] = range;
  }
  return result;
}

function validateAndOrderCorePlugins(plugins) {
  const sorted = [...plugins].sort((left, right) => compareIds(
    left.manifest.id,
    right.manifest.id,
  ));
  const byId = new Map(sorted.map(plugin => [plugin.manifest.id, plugin]));
  const dependencies = new Map(sorted.map(plugin => [plugin.manifest.id, []]));

  for (const plugin of sorted) {
    const manifest = plugin.manifest;
    if (plugin.parentId !== undefined) {
      dependencies.get(manifest.id).push(plugin.parentId);
    }
    for (const [dependencyId, range] of Object.entries(manifest.requires)) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        throw new Error(`Core plugin ${manifest.id} requires missing core plugin ${dependencyId}`);
      }
      assertCompatibleCorePlugin(manifest, dependency.manifest, range, 'requires');
      dependencies.get(manifest.id).push(dependencyId);
    }

    for (const [dependencyId, range] of Object.entries(manifest.optional_requires)) {
      const dependency = byId.get(dependencyId);
      if (!dependency) continue;
      assertCompatibleCorePlugin(manifest, dependency.manifest, range, 'optionally requires');
      dependencies.get(manifest.id).push(dependencyId);
    }

    for (const [conflictId, range] of Object.entries(manifest.conflicts)) {
      const conflict = byId.get(conflictId);
      if (conflict && semver.satisfies(conflict.manifest.version, range)) {
        throw new Error(
          `Core plugin ${manifest.id} conflicts with selected core plugin ${conflictId}@${conflict.manifest.version} (${range})`,
        );
      }
    }
  }

  const order = resolveDependencyOrder(
    new Set(byId.keys()),
    id => dependencies.get(id) ?? [],
    compareIds,
  );
  if (order.cyclic.length > 0) {
    throw new Error(`Core plugin dependency cycle: ${order.cyclic.join(' -> ')}`);
  }
  return order.ordered.map(id => byId.get(id));
}

function assertCompatibleCorePlugin(owner, dependency, range, relation) {
  if (!semver.satisfies(dependency.version, range)) {
    throw new Error(
      `Core plugin ${owner.id} ${relation} ${dependency.id}@${range}, found ${dependency.version}`,
    );
  }
}

function compareIds(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertOnlyFields(value, allowed, path, index) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new Error(`Core plugin component ${index} contains unknown field ${field}: ${path}`);
    }
  }
}

function componentIdentity(component) {
  if (component.type === 'agent_role') return `${component.type}:${component.roles_supported.join(',')}`;
  if (component.type === 'decorator') return `${component.type}:${component.export}`;
  if (component.type === 'provider') return `${component.type}:${component.provider_name}`;
  if (component.type === 'tool') return `${component.type}:${component.tool_name}`;
  if (component.type === 'extension') return `${component.type}:${component.extension_point}:${component.export}`;
  if (component.type === 'service') return `${component.type}:${component.service_id}`;
  return `${component.type}:${component.command_names.join(',')}`;
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

function requiredString(value, field, path) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Core plugin manifest requires non-empty ${field}: ${path}`);
  }
  return value;
}

function requiredUniqueStringArray(value, field, path) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Core plugin manifest requires non-empty ${field}: ${path}`);
  }
  const strings = value.map((item, index) => requiredString(item, `${field}[${index}]`, path));
  if (new Set(strings).size !== strings.length) {
    throw new Error(`Core plugin manifest requires unique ${field}: ${path}`);
  }
  return strings;
}

async function walkFiles(root) {
  const files = [];
  const visit = async directory => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries.sort((left, right) => compareIds(left.name, right.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await visit(root);
  return files;
}

function parseArguments(arguments_) {
  let mode = 'check';
  let root;
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (argument === '--write') mode = 'write';
    else if (argument === '--check') mode = 'check';
    else if (argument === '--root') root = arguments_[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (root === undefined && arguments_.includes('--root')) throw new Error('--root requires a path');
  return { mode, root };
}

function isMainModule() {
  return process.argv[1] !== undefined
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePath(value) {
  return value.split(sep).join('/');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

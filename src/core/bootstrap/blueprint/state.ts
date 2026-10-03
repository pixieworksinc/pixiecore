/**
 * Provides state bootstrapping behavior for PixieCore.
 */

import { createRequire } from 'node:module';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import YAML from 'yaml';
import { ConfigurationError } from '../../contracts/errors/index.js';
import {
  BLUEPRINT_PACKAGE_STATE_SCHEMA,
  DEFAULT_BLUEPRINT_PACKAGE_DIRECTORY,
  type BlueprintPackageMetadata,
  type BlueprintPackageState,
  type BlueprintPackageStateEntry,
  type MutableBlueprintPackageState,
  type MutableBlueprintPackageStateEntry,
} from './contracts.js';
import { isMissingFile } from './io.js';

interface SemverRuntime {
  /**
   * Compares the supplied values according to the configured evaluation policy.
   */
  compare(left: string, right: string): number;
  /**
   * Returns the canonical value when the input is valid, otherwise null.
   */
  valid(version: string): string | null;
}

const semver = createRequire(import.meta.url)('semver') as SemverRuntime;
const NAMESPACED_ID = /^(?!pixiecore\.)(?:[a-z0-9]+(?:[._-][a-z0-9]+)+)$/u;

/**
 * Returns blueprint package state without exposing mutable internal state.
 */
export async function readBlueprintPackageState(
  configPathInput: string,
): Promise<BlueprintPackageState> {
  const configPath = resolve(configPathInput);
  const packagesRoot = resolve(dirname(configPath), DEFAULT_BLUEPRINT_PACKAGE_DIRECTORY);
  const source = await readStateSource(configPath);
  if (source === undefined) return emptyState(configPath, packagesRoot);
  const root = parseStateSource(source, configPath);
  validateStateRoot(root, configPath);
  const packages = parseStatePackages(root.packages as Record<string, unknown>, configPath);
  return Object.freeze({
    schema: BLUEPRINT_PACKAGE_STATE_SCHEMA,
    configPath,
    packagesRoot,
    packages: Object.freeze(packages),
  });
}

/**
 * Writes blueprint package state for the owning PixieCore boundary.
 */
export async function writeBlueprintPackageState(
  configPath: string,
  state: MutableBlueprintPackageState,
): Promise<void> {
  const outputPackages: Record<string, object> = {};
  for (const name of Object.keys(state.packages).sort()) {
    const entry = state.packages[name]!;
    outputPackages[name] = {
      active: entry.active,
      enabled: entry.enabled,
      installed: sortBlueprintPackageVersions(entry.installed),
      history: entry.history,
      ...(entry.publisherKeyId === undefined ? {} : { publisher_key_id: entry.publisherKeyId }),
    };
  }
  const output = YAML.stringify({ schema: BLUEPRINT_PACKAGE_STATE_SCHEMA, packages: outputPackages });
  await mkdir(dirname(configPath), { recursive: true });
  const temporary = `${configPath}.pixiecore-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, output, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, configPath);
  } catch (cause) {
    await rm(temporary, { force: true });
    throw new ConfigurationError(`Failed to update Blueprint package state: ${configPath}`, { cause });
  }
}

/**
 * Handles mutable blueprint package state for the owning PixieCore boundary.
 */
export function mutableBlueprintPackageState(
  state: BlueprintPackageState,
): MutableBlueprintPackageState {
  return {
    packages: Object.fromEntries(Object.entries(state.packages).map(([name, entry]) => [name, {
      active: entry.active,
      enabled: entry.enabled,
      installed: [...entry.installed],
      history: [...entry.history],
      ...(entry.publisherKeyId === undefined ? {} : { publisherKeyId: entry.publisherKeyId }),
    }])),
  };
}

/**
 * Handles installed blueprint package path for the owning PixieCore boundary.
 */
export function installedBlueprintPackagePath(
  state: BlueprintPackageState,
  metadata: BlueprintPackageMetadata,
): string {
  return blueprintPackageVersionPath(
    state.packagesRoot,
    metadata.package.name,
    metadata.package.version,
  );
}

/**
 * Handles blueprint package version path for the owning PixieCore boundary.
 */
export function blueprintPackageVersionPath(root: string, name: string, version: string): string {
  return join(root, ...name.split('.'), version);
}

/**
 * Sorts blueprint package versions for the owning PixieCore boundary.
 */
export function sortBlueprintPackageVersions(versions: readonly string[]): string[] {
  return [...new Set(versions)].sort(semver.compare);
}

/**
 * Freezes blueprint package state entry for the owning PixieCore boundary.
 */
export function freezeBlueprintPackageStateEntry(
  entry: MutableBlueprintPackageStateEntry,
): BlueprintPackageStateEntry {
  return Object.freeze({
    active: entry.active,
    enabled: entry.enabled,
    installed: Object.freeze([...entry.installed]),
    history: Object.freeze([...entry.history]),
    ...(entry.publisherKeyId === undefined ? {} : { publisherKeyId: entry.publisherKeyId }),
  });
}

async function readStateSource(configPath: string): Promise<string | undefined> {
  try {
    return await readFile(configPath, 'utf8');
  } catch (cause) {
    if (isMissingFile(cause)) return undefined;
    throw new ConfigurationError(`Failed to read Blueprint package state: ${configPath}`, { cause });
  }
}

function emptyState(configPath: string, packagesRoot: string): BlueprintPackageState {
  return Object.freeze({
    schema: BLUEPRINT_PACKAGE_STATE_SCHEMA,
    configPath,
    packagesRoot,
    packages: Object.freeze({}),
  });
}

function parseStateSource(source: string, configPath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = YAML.parse(source, { maxAliasCount: 0, uniqueKeys: true });
  } catch (cause) {
    throw new ConfigurationError(`Failed to parse Blueprint package state: ${configPath}`, { cause });
  }
  return stateRecord(parsed, configPath);
}

function validateStateRoot(root: Record<string, unknown>, configPath: string): void {
  if (root.schema !== BLUEPRINT_PACKAGE_STATE_SCHEMA || !isRecord(root.packages)) {
    throw stateError(configPath, `requires schema ${BLUEPRINT_PACKAGE_STATE_SCHEMA} and packages`);
  }
  if (Object.keys(root).some(key => key !== 'schema' && key !== 'packages')) {
    throw stateError(configPath, 'contains unknown top-level fields');
  }
}

function parseStatePackages(
  values: Record<string, unknown>,
  configPath: string,
): Record<string, BlueprintPackageStateEntry> {
  const packages: Record<string, BlueprintPackageStateEntry> = {};
  for (const [name, rawEntry] of Object.entries(values)) {
    packages[name] = parseStateEntry(name, rawEntry, configPath);
  }
  return packages;
}

function parseStateEntry(
  name: string,
  rawEntry: unknown,
  configPath: string,
): BlueprintPackageStateEntry {
  if (!NAMESPACED_ID.test(name)) throw stateError(configPath, `contains invalid package name: ${name}`);
  const entry = stateRecord(rawEntry, configPath);
  const allowed = ['active', 'enabled', 'installed', 'history', 'publisher_key_id'];
  if (Object.keys(entry).some(key => !allowed.includes(key))) {
    throw stateError(configPath, `package ${name} contains unknown fields`);
  }
  const active = nonBlank(entry.active, `${name}.active`, configPath);
  const enabled = boolean(entry.enabled, `${name}.enabled`, configPath);
  const installed = versionList(entry.installed, `${name}.installed`, configPath);
  const history = versionList(entry.history, `${name}.history`, configPath, true);
  const publisherKeyId = optionalKeyId(entry.publisher_key_id, `${name}.publisher_key_id`, configPath);
  if (!installed.includes(active)) throw stateError(configPath, `${name}.active is not installed`);
  if (history.some(version => !installed.includes(version))) {
    throw stateError(configPath, `${name}.history contains an uninstalled version`);
  }
  return Object.freeze({
    active,
    enabled,
    installed: Object.freeze(installed),
    history: Object.freeze(history),
    ...(publisherKeyId === undefined ? {} : { publisherKeyId }),
  });
}

function stateRecord(value: unknown, configPath: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw stateError(configPath, 'must contain YAML objects');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonBlank(value: unknown, field: string, configPath: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  throw stateError(configPath, `${field} must be a non-blank string`);
}

function boolean(value: unknown, field: string, configPath: string): boolean {
  if (typeof value === 'boolean') return value;
  throw stateError(configPath, `${field} must be a boolean`);
}

function optionalKeyId(value: unknown, field: string, configPath: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)) return value;
  throw stateError(configPath, `${field} must be a SHA-256 key ID`);
}

function versionList(
  value: unknown,
  field: string,
  configPath: string,
  allowDuplicates = false,
): string[] {
  if (!Array.isArray(value)) throw stateError(configPath, `${field} must be an array`);
  const versions = value.map(version => nonBlank(version, field, configPath));
  if (versions.some(version => !semver.valid(version))) {
    throw stateError(configPath, `${field} must contain valid SemVer versions`);
  }
  if (!allowDuplicates && new Set(versions).size !== versions.length) {
    throw stateError(configPath, `${field} contains duplicate versions`);
  }
  return versions;
}

function stateError(configPath: string, message: string): ConfigurationError {
  return new ConfigurationError(`Invalid Blueprint package state ${configPath}: ${message}`);
}

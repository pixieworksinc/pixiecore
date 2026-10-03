/**
 * Provides activation state bootstrapping behavior for PixieCore.
 */

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import YAML from 'yaml';
import { ConfigurationError } from '../../../contracts/errors/index.js';
import { compareCodePoints } from '../model/validation.js';

export const MANAGED_PLUGIN_STATE_SCHEMA = 'pixiecore.plugins/v1' as const;
export const DEFAULT_MANAGED_PLUGIN_STATE_FILENAME = 'pixiecore.plugins.yml';
export const DEFAULT_MANAGED_PLUGIN_DIRECTORY = 'plugins';
export const MANAGED_PLUGIN_STATE_ENVIRONMENT_VARIABLE = 'PIXIECORE_PLUGIN_CONFIG';

const STATE_FIELDS = new Set(['schema', 'roots', 'enabled', 'disabled']);

/**
 * Carries managed plugin activation state state across a boundary.
 */
export interface ManagedPluginActivationStateContext {
  /** `disabled` bypasses managed-plugin state discovery; null and omission enable auto-discovery. */
  readonly pluginConfigPath?: string | 'disabled' | null;
  /** Caller-captured working directory; the resolver never reads process.cwd(). */
  readonly workingDirectory: string;
  /** Caller-captured environment; the resolver never reads process.env. */
  readonly environment: Readonly<NodeJS.ProcessEnv>;
}

/**
 * Describes the managed plugin activation state contract.
 */
export interface ManagedPluginActivationState {
  readonly schema: typeof MANAGED_PLUGIN_STATE_SCHEMA;
  readonly configPath: string;
  readonly roots: readonly string[];
  readonly enabled: readonly string[];
  readonly disabled: readonly string[];
}

/** Resolves and validates the immutable managed-plugin activation snapshot for one load scope. */
export async function resolveManagedPluginActivationState(
  context: ManagedPluginActivationStateContext,
): Promise<ManagedPluginActivationState | undefined> {
  if (context.pluginConfigPath === 'disabled') return undefined;

  const explicitPath = nonEmptyPath(context.pluginConfigPath);
  const environmentPath = nonEmptyPath(
    context.environment[MANAGED_PLUGIN_STATE_ENVIRONMENT_VARIABLE],
  );
  const configuredPath = explicitPath ?? environmentPath;
  const configPath = resolveFromWorkingDirectory(
    configuredPath ?? DEFAULT_MANAGED_PLUGIN_STATE_FILENAME,
    context.workingDirectory,
  );
  const required = configuredPath !== undefined;

  let source: string;
  try {
    source = await readFile(configPath, 'utf8');
  } catch (cause) {
    if (isMissingFileError(cause)) {
      if (!required) return emptyManagedPluginActivationState(configPath);
      throw new ConfigurationError(`Managed plugin state file not found: ${configPath}`, { cause });
    }
    throw new ConfigurationError(`Failed to read managed plugin state file: ${configPath}`, { cause });
  }

  return parseManagedPluginActivationState(source, configPath);
}

/** Parses state without filesystem or process-global access. Relative roots use the state-file parent. */
export function parseManagedPluginActivationState(
  source: string,
  configPath: string,
): ManagedPluginActivationState {
  let parsed: unknown;
  try {
    parsed = YAML.parse(source, { maxAliasCount: 0, uniqueKeys: true });
  } catch (cause) {
    throw new ConfigurationError(`Failed to parse managed plugin state file: ${configPath}`, { cause });
  }

  if (!isRecord(parsed)) {
    throw stateError(configPath, 'must contain a YAML object');
  }

  const unknownFields = Object.keys(parsed)
    .filter(field => !STATE_FIELDS.has(field))
    .sort(compareCodePoints);
  if (unknownFields.length > 0) {
    throw stateError(configPath, `contains unknown field${unknownFields.length === 1 ? '' : 's'}: ${unknownFields.join(', ')}`);
  }
  if (parsed.schema !== MANAGED_PLUGIN_STATE_SCHEMA) {
    throw stateError(configPath, `schema must be ${MANAGED_PLUGIN_STATE_SCHEMA}`);
  }

  const rawRoots = stringList(parsed.roots, 'roots', configPath);
  const enabled = stringList(parsed.enabled, 'enabled', configPath);
  const disabled = stringList(parsed.disabled, 'disabled', configPath);
  const disabledSet = new Set(disabled);
  const overlap = enabled.filter(id => disabledSet.has(id));
  if (overlap.length > 0) {
    throw stateError(
      configPath,
      `plugin id${overlap.length === 1 ? '' : 's'} cannot be both enabled and disabled: ${overlap.join(', ')}`,
    );
  }

  const rootDirectory = dirname(resolve(configPath));
  const roots = uniquePaths([
    resolve(rootDirectory, DEFAULT_MANAGED_PLUGIN_DIRECTORY),
    ...rawRoots.map(root => isAbsolute(root) ? resolve(root) : resolve(rootDirectory, root)),
  ]);
  return Object.freeze({
    schema: MANAGED_PLUGIN_STATE_SCHEMA,
    configPath: resolve(configPath),
    roots: Object.freeze(roots),
    enabled: Object.freeze(enabled),
    disabled: Object.freeze(disabled),
  });
}

function emptyManagedPluginActivationState(configPath: string): ManagedPluginActivationState {
  const resolvedConfigPath = resolve(configPath);
  return Object.freeze({
    schema: MANAGED_PLUGIN_STATE_SCHEMA,
    configPath: resolvedConfigPath,
    roots: Object.freeze([resolve(dirname(resolvedConfigPath), DEFAULT_MANAGED_PLUGIN_DIRECTORY)]),
    enabled: Object.freeze([]),
    disabled: Object.freeze([]),
  });
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function stringList(value: unknown, field: string, configPath: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw stateError(configPath, `${field} must be an array of non-empty strings`);
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      throw stateError(configPath, `${field} must be an array of non-empty strings`);
    }
    const entry = item.trim();
    if (seen.has(entry)) {
      throw stateError(configPath, `${field} contains a duplicate value: ${entry}`);
    }
    seen.add(entry);
    normalized.push(entry);
  }
  return normalized;
}

function nonEmptyPath(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function resolveFromWorkingDirectory(path: string, workingDirectory: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(workingDirectory, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function stateError(configPath: string, message: string): ConfigurationError {
  return new ConfigurationError(`Invalid managed plugin state file ${configPath}: ${message}`);
}

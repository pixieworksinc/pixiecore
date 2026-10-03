/**
 * Provides state editor bootstrapping behavior for PixieCore.
 */

import {
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { ConfigurationError, PluginLoadError } from '../../../contracts/errors/index.js';
import {
  DEFAULT_MANAGED_PLUGIN_DIRECTORY,
  MANAGED_PLUGIN_STATE_SCHEMA,
  parseManagedPluginActivationState,
} from '../activation/state.js';
import { validatePluginProject } from './index.js';

/**
 * Defines the supported plugin state operation values.
 */
export type PluginStateOperation = 'enable' | 'disable';

/**
 * Configures install plugin behavior.
 */
export interface InstallPluginOptions {
  readonly source: string;
  readonly configPath: string;
  readonly enable?: boolean;
}

/**
 * Installs plugin link for the owning PixieCore boundary.
 */
export async function installPluginLink(options: InstallPluginOptions): Promise<{
  readonly id: string;
  readonly linkPath: string;
}> {
  const source = await realpath(resolve(options.source)).catch(cause => {
    throw new PluginLoadError(`Cannot resolve plugin source: ${options.source}`, { cause });
  });
  const project = await validatePluginProject(source);
  const id = project.manifest.id;
  const segments = id.split('.');
  const leaf = segments.pop()!;
  if (leaf !== dirnameName(source)) {
    throw new PluginLoadError(
      `Plugin directory name ${dirnameName(source)} must match the final id segment ${leaf}`,
    );
  }
  const configPath = resolve(options.configPath);
  const pluginsRoot = join(dirname(configPath), DEFAULT_MANAGED_PLUGIN_DIRECTORY);
  const linkPath = join(pluginsRoot, ...segments, leaf);
  await mkdir(dirname(linkPath), { recursive: true });

  const existing = await lstat(linkPath).catch(error => (
    isMissing(error) ? undefined : Promise.reject(error)
  ));
  if (existing) {
    if (!existing.isSymbolicLink()) {
      throw new PluginLoadError(`Plugin install target already exists and is not a symlink: ${linkPath}`);
    }
    const current = await realpath(linkPath);
    if (current !== source) {
      throw new PluginLoadError(`Plugin install target points to a different source: ${linkPath}`);
    }
  } else {
    const temporaryLink = `${linkPath}.pixiecore-${process.pid}-${Date.now()}`;
    try {
      await symlink(source, temporaryLink, 'dir');
      await rename(temporaryLink, linkPath);
    } catch (cause) {
      await unlink(temporaryLink).catch(() => undefined);
      throw new PluginLoadError(`Failed to install plugin link: ${linkPath}`, { cause });
    }
  }

  if (options.enable) {
    try {
      await updatePluginActivationState(configPath, id, 'enable');
    } catch (error) {
      if (!existing) await unlink(linkPath).catch(() => undefined);
      throw error;
    }
  }
  return Object.freeze({ id, linkPath });
}

/**
 * Updates plugin activation state for the owning PixieCore boundary.
 */
export async function updatePluginActivationState(
  configPathInput: string,
  id: string,
  operation: PluginStateOperation,
): Promise<void> {
  const configPath = resolve(configPathInput);
  const source = await readFile(configPath, 'utf8').catch(error => {
    if (isMissing(error)) return undefined;
    throw new ConfigurationError(`Failed to read managed plugin state file: ${configPath}`, {
      cause: error,
    });
  });
  const state = source === undefined
    ? {
        schema: MANAGED_PLUGIN_STATE_SCHEMA,
        configPath,
        roots: [join(dirname(configPath), DEFAULT_MANAGED_PLUGIN_DIRECTORY)],
        enabled: [] as string[],
        disabled: [] as string[],
      }
    : parseManagedPluginActivationState(source, configPath);

  const enabled = new Set(state.enabled);
  const disabled = new Set(state.disabled);
  if (operation === 'enable') {
    disabled.delete(id);
    enabled.add(id);
  } else {
    enabled.delete(id);
    disabled.add(id);
  }
  const defaultRoot = join(dirname(configPath), DEFAULT_MANAGED_PLUGIN_DIRECTORY);
  const roots = state.roots
    .filter(root => resolve(root) !== resolve(defaultRoot))
    .map(root => relative(dirname(configPath), root) || '.');
  const output = YAML.stringify({
    schema: MANAGED_PLUGIN_STATE_SCHEMA,
    ...(roots.length === 0 ? {} : { roots }),
    enabled: [...enabled].sort(),
    disabled: [...disabled].sort(),
  });
  await atomicWrite(configPath, output);
}

/**
 * Returns installed plugin link without exposing mutable internal state.
 */
export async function readInstalledPluginLink(linkPath: string): Promise<string> {
  const stat = await lstat(linkPath);
  if (!stat.isSymbolicLink()) throw new PluginLoadError(`Not a plugin symlink: ${linkPath}`);
  return readlink(linkPath);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.pixiecore-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } catch (cause) {
    await unlink(temporary).catch(() => undefined);
    throw new ConfigurationError(`Failed to update managed plugin state file: ${path}`, { cause });
  }
}

function dirnameName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.at(-1) ?? '';
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

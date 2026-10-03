/**
 * Provides discovery bootstrapping behavior for PixieCore.
 */

import { access, readdir } from 'node:fs/promises';
import { delimiter, resolve } from 'node:path';
import { ConfigurationError, PluginLoadError } from '../../../contracts/errors/index.js';
import { errorMessage } from '../../../component/diagnostics/index.js';
import { PLUGIN_MANIFEST_FILENAMES } from '../model/constants.js';
import { asError } from '../model/validation.js';

/**
 * Normalizes plugin directories while preserving caller-owned input.
 */
export function normalizePluginDirectories(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const values = typeof value === 'string' ? value.split(delimiter) : value;
  if (!Array.isArray(values) || values.some(item => typeof item !== 'string')) {
    throw new ConfigurationError('pluginsDir must be a string or an array of strings');
  }
  return [...new Set(values.map(item => item.trim()).filter(Boolean).map(item => resolve(item)))];
}

/**
 * Discovers plugin manifests for the owning PixieCore boundary.
 */
export async function discoverPluginManifests(root: string): Promise<string[]> {
  try { await access(root); }
  catch { return []; }
  const found: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      throw new PluginLoadError(`Failed to read plugin directory ${directory}: ${errorMessage(error)}`, {
        cause: asError(error),
      });
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!PLUGIN_MANIFEST_FILENAMES.some(name => name === entry.name)) continue;
      found.push(path);
    }
  };
  await visit(root);
  return found;
}

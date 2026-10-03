/**
 * Provides manifest bootstrapping behavior for PixieCore.
 */

import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { PluginLoadError } from '../../../contracts/errors/index.js';
import { errorMessage } from '../../../component/diagnostics/index.js';
import { asError, isRecord } from '../model/validation.js';

/** Parsed legacy envelope. Component validation remains activation-ordered. */
export interface LegacyPluginManifest {
  readonly name: string;
  readonly version: string | undefined;
  readonly module: unknown;
  readonly entry: unknown;
  readonly components: unknown;
}

/**
 * Returns legacy plugin manifest without exposing mutable internal state.
 */
export async function readLegacyPluginManifest(path: string): Promise<LegacyPluginManifest> {
  try {
    const source = await readFile(path, 'utf8');
    if (!source.trim()) throw new PluginLoadError(`Empty plugin file: ${path}`);
    const parsed: unknown = YAML.parse(source);
    if (!isRecord(parsed)) throw new PluginLoadError(`Plugin manifest must be an object: ${path}`);
    if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
      throw new PluginLoadError(`Plugin manifest requires a non-empty name: ${path}`);
    }
    if (parsed.version !== undefined
        && (typeof parsed.version !== 'string' || !parsed.version.trim())) {
      throw new PluginLoadError(`Plugin manifest version must be a non-empty string: ${path}`);
    }
    return {
      name: parsed.name,
      version: parsed.version as string | undefined,
      module: parsed.module,
      entry: parsed.entry,
      components: parsed.components,
    };
  } catch (error) {
    if (error instanceof PluginLoadError) throw error;
    throw new PluginLoadError(`Failed to parse plugin manifest ${path}: ${errorMessage(error)}`, {
      cause: asError(error),
    });
  }
}

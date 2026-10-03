/**
 * Provides module loader bootstrapping behavior for PixieCore.
 */

import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PluginLoadError } from '../../../contracts/errors/index.js';
import { errorMessage } from '../../../component/diagnostics/index.js';
import {
  asError,
  componentError,
  isRecord,
  type UnknownRecord,
} from '../model/validation.js';

/**
 * Imports plugin module for the owning PixieCore boundary.
 */
export async function importPluginModule(manifestPath: string, specifier: string): Promise<UnknownRecord> {
  const modulePath = resolve(dirname(manifestPath), specifier);
  return importPluginModulePath(modulePath);
}

/**
 * The single capability boundary for manifest-selected module imports.
 * Callers may supply a cache key for authoring-time validation of changing files.
 */
export async function importPluginModulePath(
  modulePath: string,
  cacheKey?: string,
): Promise<UnknownRecord> {
  try {
    const moduleUrl = pathToFileURL(modulePath);
    if (cacheKey !== undefined) moduleUrl.searchParams.set('pixiecore-cache-key', cacheKey);
    const namespace: unknown = await import(moduleUrl.href);
    if (!isRecord(namespace)) throw new Error('module namespace is not an object');
    return namespace;
  } catch (error) {
    throw new PluginLoadError(`Failed to load plugin module ${modulePath}: ${errorMessage(error)}`, {
      cause: asError(error),
    });
  }
}

/**
 * Resolves export for the owning PixieCore boundary.
 */
export function resolveExport(namespace: UnknownRecord, configured: string): unknown {
  const fragment = configured.includes('#') ? configured.slice(configured.lastIndexOf('#') + 1) : configured;
  const name = fragment.includes('.') ? fragment.slice(fragment.lastIndexOf('.') + 1) : fragment;
  if (name === 'default') return namespace.default;
  return namespace[name] ?? (isRecord(namespace.default) ? namespace.default[name] : undefined);
}

/**
 * Instantiates component for the owning PixieCore boundary.
 */
export function instantiateComponent(value: unknown, path: string, index: number): UnknownRecord {
  if (isRecord(value)) return value;
  if (typeof value !== 'function') throw componentError(path, index, 'export must be an object, class, or factory');
  try {
    const result = new (value as new () => unknown)();
    if (!isRecord(result)) throw new Error('constructor did not return an object');
    return result;
  } catch (constructError) {
    try {
      const result = (value as () => unknown)();
      if (!isRecord(result) || result instanceof Promise) {
        throw new Error('factory must synchronously return an object');
      }
      return result;
    } catch (factoryError) {
      throw new PluginLoadError(
        `Failed to instantiate component ${index} from ${path}: ${errorMessage(factoryError)}`,
        { cause: asError(constructError) },
      );
    }
  }
}

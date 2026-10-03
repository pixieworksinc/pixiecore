/**
 * Provides adapters bootstrapping behavior for PixieCore.
 */

import { PluginLoadError } from '../../../contracts/errors/index.js';
import type {
  ProviderFactory,
  ProviderPlugin,
  RegisteredTool,
  RuntimeOptions,
} from '../../../contracts/types/index.js';
import {
  DEFAULT_TOOL_DESCRIPTION,
  JSON_SCHEMA_OBJECT_TYPE,
} from '../model/constants.js';
import {
  componentError,
  isProvider,
  isProviderFactory,
  isRecord,
  validateProvider,
  type UnknownRecord,
} from '../model/validation.js';

const PROVIDER_EXPORT_CONTRACT_REQUIREMENT = 'must be a provider, class, or factory';
const PROVIDER_PLUGIN_CONTRACT_ERROR = 'Provider plugin must implement generate() or create()';
const TOOL_EXPORT_CONTRACT_ERROR = 'tool export requires execute()';

/**
 * Handles provider factory from export for the owning PixieCore boundary.
 */
export function providerFactoryFromExport(name: string, value: unknown): ProviderFactory {
  if (isProvider(value)) return { name, create: () => value };
  if (isProviderFactory(value)) {
    return {
      name,
      create: options => value.create(options),
      ...(typeof value.close === 'function' ? { close: () => value.close!() } : {}),
    };
  }
  if (typeof value !== 'function') {
    throw new PluginLoadError(`Provider export ${name} ${PROVIDER_EXPORT_CONTRACT_REQUIREMENT}`);
  }
  return {
    name,
    create: async options => {
      let candidate: unknown;
      try { candidate = new (value as new (options: RuntimeOptions) => unknown)(options); }
      catch { candidate = await (value as (options: RuntimeOptions) => unknown)(options); }
      validateProvider(candidate, name);
      return candidate;
    },
  };
}

/**
 * Normalizes provider factory while preserving caller-owned input.
 */
export function normalizeProviderFactory(provider: ProviderPlugin): ProviderFactory {
  if (isProvider(provider)) return { name: provider.name, create: () => provider };
  if (isProviderFactory(provider)) return provider;
  throw new PluginLoadError(PROVIDER_PLUGIN_CONTRACT_ERROR);
}

/**
 * Handles tool from export for the owning PixieCore boundary.
 */
export function toolFromExport(name: string, value: UnknownRecord, path: string, index: number): RegisteredTool {
  if (typeof value.execute !== 'function') throw componentError(path, index, TOOL_EXPORT_CONTRACT_ERROR);
  const execute = value.execute as RegisteredTool['execute'];
  const description = typeof value.description === 'string'
    ? value.description
    : DEFAULT_TOOL_DESCRIPTION;
  return {
    name,
    description,
    parameters: normalizeToolParameters(value.parameters),
    execute: args => execute.call(value, args),
  };
}

function normalizeToolParameters(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (!Array.isArray(value)) return { type: JSON_SCHEMA_OBJECT_TYPE, properties: {} };
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.type !== 'string') continue;
    properties[item.name] = {
      type: item.type,
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
    };
    if (item.required === true) required.push(item.name);
  }
  return {
    type: JSON_SCHEMA_OBJECT_TYPE,
    properties,
    ...(required.length ? { required } : {}),
  };
}

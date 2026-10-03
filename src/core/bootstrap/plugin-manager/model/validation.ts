/**
 * Provides validation bootstrapping behavior for PixieCore.
 */

import { PluginLoadError } from '../../../contracts/errors/index.js';
import type {
  DecoratorStage,
  Provider,
  ProviderFactory,
  RegisteredTool,
} from '../../../contracts/types/index.js';
import {
  DECORATOR_STAGES,
  PLUGIN_COMPONENT_TYPES,
  type PluginComponentType,
} from './constants.js';

/**
 * Defines the supported component type values.
 */
export type ComponentType = PluginComponentType;
/**
 * Records unknown evidence.
 */
export type UnknownRecord = Record<string, unknown>;

/**
 * Reports whether record.
 */
export function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalizes an unknown failure into an Error instance.
 */
export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Locale-independent lexical ordering for deterministic plugin policy. */
export function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Handles component error for the owning PixieCore boundary.
 */
export function componentError(path: string, index: number, message: string): PluginLoadError {
  return new PluginLoadError(`Plugin component ${index} ${message}: ${path}`);
}

/**
 * Validates optional array and rejects unsupported input.
 */
export function validateOptionalArray(value: unknown, field: string, path: string): void {
  if (value !== undefined && !Array.isArray(value)) {
    throw new PluginLoadError(`Plugin ${field} must be an array: ${path}`);
  }
}

/**
 * Validates string array and rejects unsupported input.
 */
export function validateStringArray(value: unknown, field: string, requireNonEmpty: boolean): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim()) || (requireNonEmpty && value.length === 0)) {
    throw new PluginLoadError(`${field} must be ${requireNonEmpty ? 'a non-empty ' : 'an '}array of non-empty strings`);
  }
  return [...new Set(value)];
}

/**
 * Validates decorator stage and rejects unsupported input.
 */
export function validateDecoratorStage(value: unknown): asserts value is DecoratorStage | undefined {
  if (value !== undefined && !DECORATOR_STAGES.some(stage => stage === value)) {
    throw new PluginLoadError('Decorator stage must be before, after, or both');
  }
}

/**
 * Handles optional non empty string for the owning PixieCore boundary.
 */
export function optionalNonEmptyString(value: unknown, field: string, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new PluginLoadError(`${field} must be a non-empty string: ${path}`);
  }
  return value;
}

/**
 * Handles required non empty string for the owning PixieCore boundary.
 */
export function requiredNonEmptyString(value: unknown, field: string, path: string, index: number): string {
  if (typeof value !== 'string' || !value.trim()) throw componentError(path, index, `requires ${field}`);
  return value;
}

/**
 * Reports whether component type.
 */
export function isComponentType(value: unknown): value is ComponentType {
  return PLUGIN_COMPONENT_TYPES.some(type => type === value);
}

/**
 * Validates tool and rejects unsupported input.
 */
export function validateTool(tool: RegisteredTool): void {
  if (!tool || typeof tool.name !== 'string' || !tool.name.trim() || typeof tool.description !== 'string'
    || !isRecord(tool.parameters) || typeof tool.execute !== 'function') {
    throw new PluginLoadError('Tool plugin requires name, description, parameters, and execute()');
  }
}

/**
 * Validates provider and rejects unsupported input.
 */
export function validateProvider(value: unknown, configuredName: string): asserts value is Provider {
  if (!isProvider(value) || typeof value.model !== 'string' || typeof value.supportsTools !== 'boolean'
    || typeof value.supportsMultimodal !== 'boolean' || typeof value.supportsVision !== 'function'
    || typeof value.supportsFileInput !== 'function' || typeof value.getModelList !== 'function') {
    throw new PluginLoadError(`Provider ${configuredName} does not implement the PixieCore Provider interface`);
  }
  if (value.name !== configuredName) {
    throw new PluginLoadError(`Provider ${configuredName} returned mismatched name: ${value.name}`);
  }
}

/**
 * Reports whether provider.
 */
export function isProvider(value: unknown): value is Provider {
  return isRecord(value) && typeof value.name === 'string' && typeof value.generate === 'function';
}

/**
 * Reports whether provider factory.
 */
export function isProviderFactory(value: unknown): value is ProviderFactory {
  return isRecord(value) && typeof value.name === 'string' && typeof value.create === 'function';
}

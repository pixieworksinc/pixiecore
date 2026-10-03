/**
 * Provides constants bootstrapping behavior for PixieCore.
 */

import type { DecoratorStage } from '../../../contracts/types/index.js';

export const PLUGIN_COMPONENT_TYPE = {
  AGENT_ROLE: 'agent_role',
  DECORATOR: 'decorator',
  TOOL: 'tool',
  PROVIDER: 'provider',
  EXTENSION: 'extension',
} as const;

export const PLUGIN_COMPONENT_TYPES = [
  PLUGIN_COMPONENT_TYPE.AGENT_ROLE,
  PLUGIN_COMPONENT_TYPE.DECORATOR,
  PLUGIN_COMPONENT_TYPE.TOOL,
  PLUGIN_COMPONENT_TYPE.PROVIDER,
  PLUGIN_COMPONENT_TYPE.EXTENSION,
] as const;

/**
 * Defines the supported plugin component type values.
 */
export type PluginComponentType = typeof PLUGIN_COMPONENT_TYPES[number];

export const DECORATOR_STAGE = {
  BEFORE: 'before',
  AFTER: 'after',
  BOTH: 'both',
} as const satisfies Readonly<Record<string, DecoratorStage>>;

export const DECORATOR_STAGES = [
  DECORATOR_STAGE.BEFORE,
  DECORATOR_STAGE.AFTER,
  DECORATOR_STAGE.BOTH,
] as const;

export const PLUGIN_MANIFEST_FILENAMES = ['plugin.yml', 'plugin.yaml'] as const;

export const PIXIECORE_PLUGIN_MANIFEST_SCHEMA = 'pixiecore.plugin/v1' as const;
export const CORE_PLUGIN_ID_PATTERN = /^pixiecore\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export const MANAGED_PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/;
export const RESERVED_PLUGIN_ID_PATTERN = /^pixiecore\./;
export const SEMVER_2_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const PLUGIN_MANIFEST_TRUST_FIELDS = Object.freeze([
  'core',
  'origin',
  'locked',
  'enabled',
  'disabled',
] as const);

const PLUGIN_MANIFEST_TOP_LEVEL_FIELDS = new Set([
  'schema',
  'id',
  'name',
  'version',
  'description',
  'entry',
  'requires',
  'optional_requires',
  'conflicts',
  'components',
]);

/**
 * Handles trusted plugin manifest fields for the owning PixieCore boundary.
 */
export function trustedPluginManifestFields(
  value: Readonly<Record<string, unknown>>,
): readonly string[] {
  return PLUGIN_MANIFEST_TRUST_FIELDS.filter(field => Object.hasOwn(value, field));
}

/**
 * Handles unknown plugin manifest fields for the owning PixieCore boundary.
 */
export function unknownPluginManifestFields(
  value: Readonly<Record<string, unknown>>,
): readonly string[] {
  return Object.keys(value).filter(field => !PLUGIN_MANIFEST_TOP_LEVEL_FIELDS.has(field));
}

export const DEFAULT_TOOL_DESCRIPTION = '';
export const JSON_SCHEMA_OBJECT_TYPE = 'object';

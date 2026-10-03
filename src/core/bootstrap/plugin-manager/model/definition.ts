/**
 * Provides definition bootstrapping behavior for PixieCore.
 */

import type {
  PluginActivator,
  PluginActivatorFactory,
  SynchronousPluginActivator,
} from '../../../contracts/plugin/activation.js';
import type {
  PluginManifestSchema,
  PluginOrigin,
} from '../../../contracts/plugin/management.js';

/** Trusted, loader-independent metadata used by every future catalog source. */
export interface NormalizedPluginDescriptor {
  readonly id: string;
  readonly parentId?: string;
  readonly schema: PluginManifestSchema;
  readonly name: string;
  readonly version: string | undefined;
  readonly origin: PluginOrigin;
  readonly manifestPath: string;
  readonly rootPath: string;
  readonly ordinal: number;
  readonly requires: Readonly<Record<string, string>>;
  readonly optionalRequires: Readonly<Record<string, string>>;
  readonly conflicts: Readonly<Record<string, string>>;
}

/** Separates trusted metadata from the origin-specific activator loader. */
export interface PluginDefinition {
  readonly descriptor: NormalizedPluginDescriptor;
  /**
   * Returns activator without exposing mutable internal state.
   */
  loadActivator(): PluginActivator | Promise<PluginActivator>;
}

/**
 * Describes the synchronous plugin definition contract.
 */
export interface SynchronousPluginDefinition extends PluginDefinition {
  readonly components?: readonly StaticCorePluginComponent[];
  /**
   * Returns activator without exposing mutable internal state.
   */
  loadActivator(): SynchronousPluginActivator;
}

/**
 * Describes the plugin catalog contract.
 */
export interface PluginCatalog {
  /**
   * Returns plugin definitions available without deferred discovery.
   */
  synchronousDefinitions(): readonly SynchronousPluginDefinition[];
  /**
   * Returns the plugin definitions visible through this catalog.
   */
  definitions(): AsyncIterable<PluginDefinition>;
}

/**
 * Describes the static core plugin manifest contract.
 */
export interface StaticCorePluginManifest {
  readonly schema: 'pixiecore.plugin/v1';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly entry: `./${string}.js`;
  readonly requires: Readonly<Record<string, string>>;
  readonly optional_requires: Readonly<Record<string, string>>;
  readonly conflicts: Readonly<Record<string, string>>;
  readonly components: readonly StaticCorePluginComponent[];
}

/**
 * Describes the static core agent role component contract.
 */
export interface StaticCoreAgentRoleComponent {
  readonly type: 'agent_role';
  readonly export: string;
  readonly roles_supported: readonly string[];
}

/**
 * Describes the static core decorator component contract.
 */
export interface StaticCoreDecoratorComponent {
  readonly type: 'decorator';
  readonly export: string;
  readonly priority: number;
  readonly stage: 'before' | 'after' | 'both';
}

/**
 * Describes the static core provider component contract.
 */
export interface StaticCoreProviderComponent {
  readonly type: 'provider';
  readonly export: string;
  readonly provider_name: string;
}

/**
 * Describes the static core tool component contract.
 */
export interface StaticCoreToolComponent {
  readonly type: 'tool';
  readonly export: string;
  readonly tool_name: string;
}

/** Trusted extension-point metadata shared with managed plugin units. */
export interface StaticCoreExtensionComponent {
  readonly type: 'extension';
  readonly export: string;
  readonly extension_point: string;
}

/** Trusted core-only service metadata; managed plugins retain four contribution kinds. */
export interface StaticCoreServiceComponent {
  readonly type: 'service';
  readonly export: string;
  readonly service_id: string;
}

/** Trusted core-only CLI command metadata; activation still registers commands only. */
export interface StaticCoreCommandComponent {
  readonly type: 'command';
  readonly export: string;
  readonly command_names: readonly string[];
}

/**
 * Defines the supported static core plugin component values.
 */
export type StaticCorePluginComponent =
  | StaticCoreAgentRoleComponent
  | StaticCoreDecoratorComponent
  | StaticCoreProviderComponent
  | StaticCoreToolComponent
  | StaticCoreExtensionComponent
  | StaticCoreServiceComponent
  | StaticCoreCommandComponent;

/**
 * Describes the static core plugin catalog entry contract.
 */
export interface StaticCorePluginCatalogEntry {
  readonly parentId?: string;
  readonly manifest: StaticCorePluginManifest;
  readonly manifestUrl: URL;
  readonly createActivator: PluginActivatorFactory;
}

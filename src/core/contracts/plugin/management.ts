/**
 * Defines management contracts shared across PixieCore boundaries.
 */

/**
 * Defines the supported plugin origin values.
 */
export type PluginOrigin = 'core' | 'managed-custom' | 'legacy';

/**
 * Defines the supported plugin manifest schema values.
 */
export type PluginManifestSchema = 'legacy' | 'pixiecore.plugin/v1';

/**
 * Defines the supported plugin status state values.
 */
export type PluginStatusState =
  | 'discovered'
  | 'invalid-disabled'
  | 'disabled'
  | 'enabled'
  | 'resolved'
  | 'loaded'
  | 'registered'
  | 'activated'
  | 'failed'
  | 'deactivated'
  | 'disposed';

/**
 * Describes the plugin status diagnostic contract.
 */
export interface PluginStatusDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly pluginId: string | undefined;
  readonly manifestPath: string | undefined;
}

/** Immutable, loader-independent status for one plugin inventory entry. */
export interface PluginStatus {
  readonly id: string | undefined;
  readonly schema: PluginManifestSchema | undefined;
  readonly name: string | undefined;
  readonly version: string | undefined;
  readonly origin: PluginOrigin;
  readonly state: PluginStatusState;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly activated: boolean;
  readonly manifestPath: string | undefined;
  readonly rootPath: string | undefined;
  readonly ordinal: number;
  readonly requires: Readonly<Record<string, string>>;
  readonly optionalRequires: Readonly<Record<string, string>>;
  readonly conflicts: Readonly<Record<string, string>>;
  readonly diagnostics: readonly PluginStatusDiagnostic[];
}

/** Passive snapshot. Reading it never performs discovery or imports plugin code. */
export interface PluginStatusSnapshot {
  readonly configPath: string | undefined;
  readonly roots: readonly string[];
  readonly plugins: readonly PluginStatus[];
  readonly diagnostics: readonly PluginStatusDiagnostic[];
}

/**
 * Configures plugin manager behavior.
 */
export interface PluginManagerOptions {
  /**
   * Managed activation state file. Relative paths resolve from the captured
   * current working directory. Use `disabled` to bypass managed discovery.
   */
  readonly pluginConfigPath?: string | 'disabled' | null;
}

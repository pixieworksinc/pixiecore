/**
 * Defines Apache APISIX gateway integration contracts.
 */

/** Canonical extension point for APISIX route-plugin contributions. */
export const APISIX_PLUGIN_EXTENSION_POINT = 'pixiecore.providers.apisix.plugin';

/** Context supplied while rendering deployment-owned APISIX configuration. */
export interface ApisixPluginConfigurationContext {
  readonly environment: Readonly<NodeJS.ProcessEnv>;
}

/** One independently managed APISIX route-plugin contribution. */
export interface ApisixPluginContribution {
  readonly name: string;
  /** Returns APISIX plugin configuration, or `undefined` when not configured. */
  createConfiguration(
    context: ApisixPluginConfigurationContext,
  ): Readonly<Record<string, unknown>> | undefined;
}

/** Immutable output suitable for declarative APISIX route adapters. */
export interface CompiledApisixPluginConfiguration {
  readonly name: string;
  readonly config: Readonly<Record<string, unknown>>;
}

/** Minimal extension source implemented by PixieCore's public PluginManager. */
export interface ApisixPluginExtensionSource {
  /** Returns values registered at one namespaced extension point. */
  getExtensions<Value>(point: string): readonly Value[];
}

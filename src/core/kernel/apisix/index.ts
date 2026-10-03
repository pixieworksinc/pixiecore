/**
 * Compiles PixieCore APISIX plugin contributions into declarative configuration.
 */

import { ConfigurationError } from '../../contracts/errors/index.js';
import { cloneFrozenJsonObject } from '../../component/json-artifact/index.js';
import {
  APISIX_PLUGIN_EXTENSION_POINT,
  type ApisixPluginConfigurationContext,
  type ApisixPluginContribution,
  type ApisixPluginExtensionSource,
  type CompiledApisixPluginConfiguration,
} from '../../contracts/apisix/index.js';

export {
  APISIX_PLUGIN_EXTENSION_POINT,
  type ApisixPluginConfigurationContext,
  type ApisixPluginContribution,
  type ApisixPluginExtensionSource,
  type CompiledApisixPluginConfiguration,
} from '../../contracts/apisix/index.js';

/**
 * Compiles active APISIX contributions in deterministic plugin activation order.
 * No Admin API request or gateway mutation is performed.
 */
export function compileApisixPluginConfiguration(
  source: ApisixPluginExtensionSource,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): readonly CompiledApisixPluginConfiguration[] {
  const contributions = source.getExtensions<ApisixPluginContribution>(
    APISIX_PLUGIN_EXTENSION_POINT,
  );
  const names = new Set<string>();
  const compiled: CompiledApisixPluginConfiguration[] = [];
  const context: ApisixPluginConfigurationContext = { environment };

  for (const contribution of contributions) {
    validateContribution(contribution);
    if (names.has(contribution.name)) {
      throw new ConfigurationError(`Duplicate APISIX plugin contribution: ${contribution.name}`);
    }
    names.add(contribution.name);
    const config = contribution.createConfiguration(context);
    if (config === undefined) continue;
    if (!isRecord(config)) {
      throw new ConfigurationError(
        `APISIX plugin ${contribution.name} configuration must be an object`,
      );
    }
    compiled.push(Object.freeze({
      name: contribution.name,
      config: cloneFrozenJsonObject(
        config,
        `APISIX plugin ${contribution.name} configuration`,
        message => new ConfigurationError(
          `APISIX plugin ${contribution.name} configuration must contain JSON-compatible values: `
            + message,
        ),
      ),
    }));
  }
  return Object.freeze(compiled);
}

function validateContribution(value: unknown): asserts value is ApisixPluginContribution {
  if (!isRecord(value)
      || typeof value.name !== 'string'
      || !value.name.trim()
      || typeof value.createConfiguration !== 'function') {
    throw new ConfigurationError(
      'APISIX plugin contribution requires a non-empty name and createConfiguration()',
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

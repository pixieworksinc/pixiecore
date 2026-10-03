/**
 * Defines reusable APISIX child-plugin contribution helpers.
 */

import type {
  ApisixPluginContribution,
  ApisixPluginConfigurationContext,
} from '../../../../../core/contracts/apisix/index.js';
import { APISIX_PLUGIN_EXTENSION_POINT } from '../../../../../core/contracts/apisix/index.js';
import { ConfigurationError } from '../../../../../core/contracts/errors/index.js';
import type { PluginActivatorFactory } from '../../../../../core/contracts/plugin/activation.js';

/** Creates a fresh activator factory for one APISIX child-plugin contribution. */
export function createApisixContributionActivator(
  contribution: ApisixPluginContribution,
): PluginActivatorFactory {
  return () => ({
    /** Registers the child value at the APISIX extension point. */
    activate(context): void {
      context.registerExtension({
        point: APISIX_PLUGIN_EXTENSION_POINT,
        value: contribution,
      });
    },
  });
}

/** Creates a contribution whose JSON configuration is supplied by one environment variable. */
export function createEnvironmentApisixPluginContribution(
  name: string,
  environmentVariable: string,
): ApisixPluginContribution {
  if (!name.trim() || !environmentVariable.trim()) {
    throw new ConfigurationError('APISIX contribution requires plugin and environment names');
  }
  return Object.freeze({
    name,
    createConfiguration(context: ApisixPluginConfigurationContext) {
      const source = context.environment[environmentVariable];
      if (source === undefined) return undefined;
      if (!source.trim()) {
        throw new ConfigurationError(`${environmentVariable} must contain a JSON object`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(source);
      } catch (cause) {
        throw new ConfigurationError(`${environmentVariable} must contain valid JSON`, { cause });
      }
      if (!isRecord(parsed)) {
        throw new ConfigurationError(`${environmentVariable} must contain a JSON object`);
      }
      return parsed;
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

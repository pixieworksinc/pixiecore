/**
 * Provides module loader bootstrapping behavior for PixieCore.
 */

import type {
  PluginActivationContext,
  PluginActivator,
} from '../../../contracts/plugin/activation.js';
import {
  loadPluginObject,
  registerManifestComponent,
} from '../catalog/legacy-manifest-adapter.js';

/**
 * Describes the managed module component contract.
 */
export interface ManagedModuleComponent {
  readonly type: 'agent_role' | 'decorator' | 'tool' | 'provider' | 'extension';
  readonly export: string;
  readonly modulePath: string;
  readonly roles_supported?: readonly string[];
  readonly priority?: number;
  readonly stage?: 'before' | 'after' | 'both';
  readonly tool_name?: string;
  readonly provider_name?: string;
  readonly extension_point?: string;
}

/**
 * Describes the managed module manifest contract.
 */
export interface ManagedModuleManifest {
  readonly manifestPath: string;
  readonly entryPath: string;
  readonly components: readonly ManagedModuleComponent[] | undefined;
}

/**
 * Creates a side-effect-free activator. Dynamic imports deliberately remain in
 * activate(), after managed selection and dependency resolution have finished.
 */
export function createManagedPluginActivator(
  manifest: ManagedModuleManifest,
): PluginActivator {
  return {
    activate: target => activateManagedPluginModules(manifest, target),
  };
}

async function activateManagedPluginModules(
  manifest: ManagedModuleManifest,
  target: PluginActivationContext,
): Promise<void> {
  if (manifest.components === undefined) {
    await loadPluginObject(manifest.manifestPath, manifest.entryPath, target);
    return;
  }

  for (const [index, component] of manifest.components.entries()) {
    await registerManifestComponent(
      manifest.manifestPath,
      manifest.entryPath,
      componentForActivation(component),
      index,
      target,
    );
  }
}

function componentForActivation(
  component: ManagedModuleComponent,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    type: component.type,
    export: component.export,
    module: component.modulePath,
    ...(component.roles_supported === undefined
      ? {}
      : { roles_supported: component.roles_supported }),
    ...(component.priority === undefined ? {} : { priority: component.priority }),
    ...(component.stage === undefined ? {} : { stage: component.stage }),
    ...(component.tool_name === undefined ? {} : { tool_name: component.tool_name }),
    ...(component.provider_name === undefined
      ? {}
      : { provider_name: component.provider_name }),
    ...(component.extension_point === undefined
      ? {}
      : { extension_point: component.extension_point }),
  });
}

/**
 * Provides legacy manifest adapter bootstrapping behavior for PixieCore.
 */

import { dirname, relative, sep } from 'node:path';
import { PluginLoadError } from '../../../contracts/errors/index.js';
import type {
  PluginActivationContext,
  PluginActivator,
} from '../../../contracts/plugin/activation.js';
import type {
  AgentRolePlugin,
  OutputDecorator,
  PixieCorePlugin,
} from '../../../contracts/types/index.js';
import { providerFactoryFromExport, toolFromExport } from './adapters.js';
import type { PluginDefinition } from '../model/definition.js';
import { PLUGIN_COMPONENT_TYPE } from '../model/constants.js';
import { readLegacyPluginManifest, type LegacyPluginManifest } from './manifest.js';
import { importPluginModule, instantiateComponent, resolveExport } from './module-loader.js';
import {
  componentError,
  isComponentType,
  isRecord,
  optionalNonEmptyString,
  requiredNonEmptyString,
  validateDecoratorStage,
  validateOptionalArray,
  validateStringArray,
} from '../model/validation.js';

const EMPTY_DEPENDENCIES: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Describes the legacy manifest source contract.
 */
export interface LegacyManifestSource {
  readonly rootPath: string;
  readonly manifestPath: string;
  readonly sourceOrdinal: number;
  readonly ordinal: number;
}

/**
 * Handles synthetic legacy plugin id for the owning PixieCore boundary.
 */
export function syntheticLegacyPluginId(source: LegacyManifestSource): string {
  const manifest = relative(source.rootPath, source.manifestPath)
    .split(sep)
    .join('/')
    .replaceAll('\\', '/');
  return `legacy:${source.sourceOrdinal}:${manifest}`;
}

interface ComponentManifest {
  type?: unknown;
  module?: unknown;
  export?: unknown;
  class?: unknown;
  roles_supported?: unknown;
  priority?: unknown;
  stage?: unknown;
  tool_name?: unknown;
  provider_name?: unknown;
  extension_point?: unknown;
}

/** Parses legacy metadata without importing or evaluating the plugin module. */
export async function adaptLegacyManifest(
  source: LegacyManifestSource,
): Promise<PluginDefinition> {
  const manifest = await readLegacyPluginManifest(source.manifestPath);
  const descriptor = Object.freeze({
    id: syntheticLegacyPluginId(source),
    schema: 'legacy' as const,
    name: manifest.name,
    version: manifest.version,
    origin: 'legacy' as const,
    manifestPath: source.manifestPath,
    rootPath: dirname(source.manifestPath),
    ordinal: source.ordinal,
    requires: EMPTY_DEPENDENCIES,
    optionalRequires: EMPTY_DEPENDENCIES,
    conflicts: EMPTY_DEPENDENCIES,
  });
  return {
    descriptor,
    loadActivator: (): PluginActivator => ({
      activate: target => activateLegacyManifest(source.manifestPath, manifest, target),
    }),
  };
}

async function activateLegacyManifest(
  path: string,
  manifest: LegacyPluginManifest,
  target: PluginActivationContext,
): Promise<void> {
  const rootModule = optionalNonEmptyString(
    manifest.module ?? manifest.entry,
    'Plugin manifest module',
    path,
  );
  if (manifest.components === undefined) {
    if (!rootModule) {
      throw new PluginLoadError(`Plugin manifest requires module, entry, or components: ${path}`);
    }
    await loadPluginObject(path, rootModule, target);
    return;
  }
  if (!Array.isArray(manifest.components)) {
    throw new PluginLoadError(`Plugin manifest components must be an array: ${path}`);
  }
  for (const [index, raw] of manifest.components.entries()) {
    await registerManifestComponent(path, rootModule, raw, index, target);
  }
}

/** Shared by the managed adapter after its stricter schema and path checks. */
export async function loadPluginObject(
  path: string,
  rootModule: string,
  target: PluginActivationContext,
): Promise<void> {
  const namespace = await importPluginModule(path, rootModule);
  const exported = namespace.default ?? namespace;
  const value = typeof exported === 'function' ? await (exported as () => unknown)() : exported;
  registerPluginObject(value, path, target);
}

function registerPluginObject(
  value: unknown,
  path: string,
  target: PluginActivationContext,
): void {
  if (!isRecord(value)) throw new PluginLoadError(`Plugin module must export an object: ${path}`);
  const plugin = value as PixieCorePlugin;
  validateOptionalArray(plugin.agentRoles, 'agentRoles', path);
  validateOptionalArray(plugin.decorators, 'decorators', path);
  validateOptionalArray(plugin.tools, 'tools', path);
  validateOptionalArray(plugin.providers, 'providers', path);
  validateOptionalArray(plugin.extensions, 'extensions', path);
  if (!plugin.agentRoles && !plugin.decorators && !plugin.tools && !plugin.providers
      && !plugin.extensions) {
    throw new PluginLoadError(`Plugin module exports no supported components: ${path}`);
  }
  target.own(plugin);
  for (const extension of plugin.extensions ?? []) target.registerExtension(extension);
  for (const role of plugin.agentRoles ?? []) target.registerAgentRole(role);
  for (const decorator of plugin.decorators ?? []) target.registerDecorator(decorator);
  for (const tool of plugin.tools ?? []) target.registerTool(tool);
  for (const provider of plugin.providers ?? []) target.registerProvider(provider);
}

/** Shared by the managed adapter with already-normalized canonical fields. */
export async function registerManifestComponent(
  path: string,
  rootModule: string | undefined,
  raw: unknown,
  index: number,
  target: PluginActivationContext,
): Promise<void> {
  if (!isRecord(raw)) throw componentError(path, index, 'must be an object');
  const component = raw as ComponentManifest;
  if (!isComponentType(component.type)) {
    throw componentError(path, index, 'has an invalid or missing type');
  }
  const exportName = optionalNonEmptyString(
    component.export ?? component.class,
    'component export/class',
    path,
  );
  if (!exportName) throw componentError(path, index, 'is missing export or class');
  const moduleSpecifier = optionalNonEmptyString(component.module, 'component module', path)
    ?? rootModule;
  if (!moduleSpecifier) throw componentError(path, index, 'requires a module');
  const namespace = await importPluginModule(path, moduleSpecifier);
  const exported = resolveExport(namespace, exportName);
  if (exported === undefined) {
    throw componentError(path, index, `cannot find export ${exportName}`);
  }
  if (component.type === PLUGIN_COMPONENT_TYPE.PROVIDER) {
    const name = requiredNonEmptyString(component.provider_name, 'provider_name', path, index);
    target.registerProviderFactory(providerFactoryFromExport(name, exported));
    target.own(exported);
    return;
  }
  if (component.type === PLUGIN_COMPONENT_TYPE.EXTENSION) {
    const point = requiredNonEmptyString(
      component.extension_point,
      'extension_point',
      path,
      index,
    );
    const value = instantiateComponent(exported, path, index);
    target.registerExtension({ point, value });
    return;
  }
  const instance = instantiateComponent(exported, path, index);
  target.own(instance);
  if (component.type === PLUGIN_COMPONENT_TYPE.AGENT_ROLE) {
    target.registerAgentRole(agentRoleFromComponent(component, instance, path, index));
    return;
  }
  if (component.type === PLUGIN_COMPONENT_TYPE.DECORATOR) {
    const decorator = decoratorFromComponent(component, instance, path, index);
    target.registerDecorator(decorator, decorator.priority);
    return;
  }
  const name = requiredNonEmptyString(component.tool_name, 'tool_name', path, index);
  target.registerTool(toolFromExport(name, instance, path, index));
}

function agentRoleFromComponent(
  component: ComponentManifest,
  instance: Record<string, unknown>,
  path: string,
  index: number,
): AgentRolePlugin {
  const roles = validateStringArray(
    component.roles_supported,
    `components[${index}].roles_supported`,
    true,
  );
  if (typeof instance.apply !== 'function') {
    throw componentError(path, index, 'agent role export requires apply()');
  }
  const apply = instance.apply as AgentRolePlugin['apply'];
  return {
    supportedRoles: roles,
    apply: (prompt, blueprint, inputs) => apply.call(instance, prompt, blueprint, inputs),
  };
}

function decoratorFromComponent(
  component: ComponentManifest,
  instance: Record<string, unknown>,
  path: string,
  index: number,
): OutputDecorator {
  if (typeof component.priority !== 'number' || !Number.isFinite(component.priority)) {
    throw componentError(path, index, 'decorator requires a finite priority');
  }
  if (typeof instance.validate !== 'function') {
    throw componentError(path, index, 'decorator export requires validate()');
  }
  const stage = component.stage ?? instance.stage;
  validateDecoratorStage(stage);
  const validate = instance.validate as OutputDecorator['validate'];
  return {
    priority: component.priority,
    ...(stage === undefined ? {} : { stage }),
    validate: context => validate.call(instance, context),
  };
}

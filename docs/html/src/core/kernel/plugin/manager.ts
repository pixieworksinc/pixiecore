/**
 * Coordinates public plugin-manager responsibilities inside the PixieCore kernel.
 */

import {
  activateCorePluginRoots as activateHostPluginRoots,
  getRegisteredDecorators as getHostRegisteredDecorators,
  PluginHost,
  resolvePluginService as resolveHostPluginService,
} from '../../bootstrap/plugin-manager/manager.js';
import {
  applyPluginRecipe,
  planPluginRecipe,
} from '../../bootstrap/plugin-manager/recipe/index.js';
import type { ServiceToken } from '../../contracts/plugin/activation.js';
import type {
  PluginManagerOptions,
  PluginStatusSnapshot,
} from '../../contracts/plugin/management.js';
import { RECIPE_SERVICE } from '../../contracts/plugin/services.js';
import type {
  AgentRolePlugin,
  OutputDecorator,
  Provider,
  ProviderFactory,
  ProviderPlugin,
  RegisteredTool,
  RuntimeOptions,
} from '../../contracts/types/index.js';
import type { DecoratorRegistration } from '../../bootstrap/plugin-manager/registries/contributions.js';
import { createCorePluginCatalog } from './catalog.js';

const RECIPE_BOOTSTRAP_PLUGIN_ID = 'pixiecore.recipe';
const hostByManager = new WeakMap<PluginManager, PluginHost>();

/** Activates bundled plugin roots through the manager's private host. */
export function activateCorePluginRoots(
  manager: PluginManager,
  rootIds: string | readonly string[],
): void {
  activateHostPluginRoots(pluginHost(manager), rootIds);
}

/** Resolves a scoped plugin service through the manager's private host. */
export function resolvePluginService<Value>(
  manager: PluginManager,
  token: ServiceToken<Value>,
): Value {
  return resolveHostPluginService(pluginHost(manager), token);
}

/** Returns effective decorator metadata without exposing the mutable registry. */
export function getRegisteredDecorators(
  manager: PluginManager,
): readonly DecoratorRegistration[] {
  return getHostRegisteredDecorators(pluginHost(manager));
}

/** Public facade that composes a private bootstrap host and locked Recipe. */
export class PluginManager {
  private readonly host: PluginHost;

  /** Creates an isolated plugin host and applies PixieCore's standard Recipe. */
  constructor(
    pluginsDir?: string | string[],
    environment: NodeJS.ProcessEnv = process.env,
    options: PluginManagerOptions = {},
  ) {
    const catalog = createCorePluginCatalog();
    this.host = new PluginHost(pluginsDir, environment, options, catalog);
    hostByManager.set(this, this.host);
    activateHostPluginRoots(this.host, RECIPE_BOOTSTRAP_PLUGIN_ID);
    const recipe = resolveHostPluginService(this.host, RECIPE_SERVICE).standardRecipe();
    applyPluginRecipe(
      this.host,
      planPluginRecipe(recipe, catalog.synchronousDefinitions()),
    );
  }

  /** Returns registered roles as a read-only view. */
  get agentRoles(): ReadonlyMap<string, AgentRolePlugin> { return new Map(this.host.agentRoles); }

  /** Returns registered tools as a read-only view. */
  get tools(): ReadonlyMap<string, RegisteredTool> { return new Map(this.host.tools); }

  /** Returns registered provider factories as a read-only view. */
  get providers(): ReadonlyMap<string, ProviderFactory> { return new Map(this.host.providers); }

  /** Returns normalized plugin directories without exposing host state. */
  get pluginDirectories(): readonly string[] { return Object.freeze([...this.host.pluginDirectories]); }

  /** Returns decorators in effective execution order. */
  get decorators(): readonly OutputDecorator[] { return this.host.decorators; }

  /** Returns a defensive plugin-directory copy. */
  getPluginDirectories(): string[] { return this.host.getPluginDirectories(); }

  /** Returns the passive plugin status snapshot. */
  getPluginStatus(): PluginStatusSnapshot { return this.host.getPluginStatus(); }

  /** Returns a frozen snapshot of values registered at one extension point. */
  getExtensions<Value>(point: string): readonly Value[] {
    return this.host.getExtensions<Value>(point);
  }

  /** Returns the role registered for a canonical role name. */
  getAgentRole(role: string): AgentRolePlugin | undefined { return this.host.getAgentRole(role); }

  /** Returns the registered tool with the supplied name. */
  getTool(name: string): RegisteredTool | undefined { return this.host.getTool(name); }

  /** Returns the provider factory with the supplied name. */
  getProvider(name: string): ProviderFactory | undefined { return this.host.getProvider(name); }

  /** Returns decorators in effective execution order. */
  getDecorators(): OutputDecorator[] { return this.host.getDecorators(); }

  /** Registers a role through the lifecycle-aware host. */
  registerAgentRole(plugin: AgentRolePlugin): void { this.host.registerAgentRole(plugin); }

  /** Registers one extension value through the lifecycle-aware host. */
  registerExtension<Value>(extension: import('../../contracts/plugin/extension.js').PluginExtension<Value>): void {
    this.host.registerExtension(extension);
  }

  /** Registers an output decorator through the lifecycle-aware host. */
  registerDecorator(decorator: OutputDecorator, priority = decorator.priority ?? 100): void {
    this.host.registerDecorator(decorator, priority);
  }

  /** Registers a tool through the lifecycle-aware host. */
  registerTool(tool: RegisteredTool): void { this.host.registerTool(tool); }

  /** Registers a provider contribution through the lifecycle-aware host. */
  registerProvider(provider: ProviderPlugin): void { this.host.registerProvider(provider); }

  /** Creates a provider owned by this manager scope. */
  createProvider(name: string, options: RuntimeOptions = {}): Promise<Provider> {
    return this.host.createProvider(name, options);
  }

  /** Reports whether a provider factory belongs to the bundled catalog. */
  isBuiltInProvider(name: string): boolean { return this.host.isBuiltInProvider(name); }

  /** Loads selected managed and legacy plugins. */
  load(): Promise<void> { return this.host.load(); }

  /** Closes all resources owned by this manager scope. */
  close(): Promise<void> { return this.host.close(); }
}

function pluginHost(manager: PluginManager): PluginHost {
  const host = hostByManager.get(manager);
  if (!host) throw new TypeError('PluginManager host is unavailable');
  return host;
}

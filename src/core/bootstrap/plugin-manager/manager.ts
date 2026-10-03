/**
 * Provides manager bootstrapping behavior for PixieCore.
 */

import { PluginLoadError } from '../../contracts/errors/index.js';
import type {
  PluginActivationContext,
  ServiceToken,
} from '../../contracts/plugin/activation.js';
import {
  PACKAGE_ROOT_SERVICE,
  PLUGIN_ENVIRONMENT_SERVICE,
} from '../../contracts/plugin/services.js';
import { resolvePixieCorePackageRoot } from '../config/package-root.js';
import type {
  PluginManagerOptions,
  PluginStatusSnapshot,
} from '../../contracts/plugin/management.js';
import type {
  AgentRolePlugin,
  OutputDecorator,
  Provider,
  ProviderFactory,
  ProviderPlugin,
  RegisteredTool,
  RuntimeOptions,
} from '../../contracts/types/index.js';
import { CompositePluginCatalog, LegacyPluginCatalog } from './catalog/index.js';
import { normalizePluginDirectories } from './catalog/discovery.js';
import { PluginEngine } from './activation/engine.js';
import { ManagedPluginCatalog } from './managed/catalog.js';
import {
  ContributionRegistries,
  type DecoratorRegistration,
} from './registries/contributions.js';
import type {
  NormalizedPluginDescriptor,
  PluginCatalog,
  PluginDefinition,
} from './model/definition.js';
import { ScopedServiceRegistry } from './registries/services.js';
import { PluginStatusTracker } from './activation/status.js';

interface PluginHostInternals {
  readonly engine: PluginEngine;
  readonly registries: ContributionRegistries;
  readonly services: ScopedServiceRegistry;
}

const internalsByHost = new WeakMap<PluginHost, PluginHostInternals>();
const EMPTY_PLUGIN_CATALOG: PluginCatalog = Object.freeze({
  /**
   * Implements the synchronous definitions operation for the enclosing service contract.
   */
  synchronousDefinitions(): readonly [] { return []; },
  /**
   * Implements the definitions operation for the enclosing service contract.
   */
  async *definitions(): AsyncIterable<PluginDefinition> {},
});

/** Internal bootstrap seam; deliberately omitted from the public class and package barrels. */
export function activateCorePluginRoots(
  host: PluginHost,
  rootIds: string | readonly string[],
): void {
  hostInternals(host).engine.activateSynchronousRoots(
    typeof rootIds === 'string' ? [rootIds] : rootIds,
  );
}

/** Internal bootstrap seam for resolving a typed service in one manager scope. */
export function resolvePluginService<Value>(
  host: PluginHost,
  token: ServiceToken<Value>,
): Value {
  return hostInternals(host).services.resolve(token);
}

/** Internal bootstrap seam preserving effective decorator metadata. */
export function getRegisteredDecorators(
  host: PluginHost,
): readonly DecoratorRegistration[] {
  return hostInternals(host).registries.getDecoratorRegistrations();
}

/**
 * Owns plugin catalogs, dependency-ordered activation, contribution registries,
 * scoped services, status reporting, and reverse-order resource cleanup.
 */
export class PluginHost {
  private readonly registries = new ContributionRegistries();
  readonly agentRoles = this.registries.agentRoles;
  readonly tools = this.registries.tools;
  readonly providers = this.registries.providers;
  readonly pluginDirectories: readonly string[];

  private readonly services = new ScopedServiceRegistry();
  private readonly status = new PluginStatusTracker();
  private readonly engine: PluginEngine;
  private readonly environment: NodeJS.ProcessEnv;

  /**
   * Creates an unloaded plugin scope from bundled, managed, and legacy catalogs.
   *
   * @param pluginsDir - Optional legacy plugin directories.
   * @param environment - Environment snapshot used for discovery and policy.
   * @param options - Managed-plugin activation state options.
   * @param bundledCatalog - Trusted bundled definitions supplied by the kernel.
   */
  constructor(
    pluginsDir?: string | string[],
    environment: NodeJS.ProcessEnv = process.env,
    options: PluginManagerOptions = {},
    bundledCatalog: PluginCatalog = EMPTY_PLUGIN_CATALOG,
  ) {
    this.environment = { ...environment };
    this.services.register(PLUGIN_ENVIRONMENT_SERVICE, this.environment);
    this.services.register(
      PACKAGE_ROOT_SERVICE,
      () => resolvePixieCorePackageRoot(import.meta.url),
    );
    const configured = pluginsDir ?? this.environment.PROMPT_RUNTIME_PLUGINS_DIR;
    this.pluginDirectories = normalizePluginDirectories(configured);
    const bundledDefinitions = bundledCatalog.synchronousDefinitions();
    this.engine = new PluginEngine(
      new CompositePluginCatalog([
        bundledCatalog,
        new ManagedPluginCatalog({
          activationState: {
            ...(options.pluginConfigPath === undefined
              ? {}
              : { pluginConfigPath: options.pluginConfigPath }),
            workingDirectory: process.cwd(),
            environment: this.environment,
          },
          legacyDirectories: this.pluginDirectories,
          coreDescriptors: bundledDefinitions.map(item => item.descriptor),
          status: this.status,
        }),
        new LegacyPluginCatalog(this.pluginDirectories, this.status),
      ]),
      descriptor => this.activationContext(descriptor),
      () => this.close(),
      this.status,
    );
    internalsByHost.set(this, {
      engine: this.engine,
      registries: this.registries,
      services: this.services,
    });
  }

  /**
   * Returns decorators from the PluginManager state.
   */
  get decorators(): readonly OutputDecorator[] { return this.getDecorators(); }

  /**
   * Returns plugin directories from the PluginManager state.
   */
  getPluginDirectories(): string[] { return [...this.pluginDirectories]; }
  /**
   * Returns plugin status from the PluginManager state.
   */
  getPluginStatus(): PluginStatusSnapshot { return this.status.getSnapshot(); }
  /** Returns values registered for one namespaced extension point. */
  getExtensions<Value>(point: string): readonly Value[] {
    return this.registries.getExtensions<Value>(point);
  }
  /**
   * Returns agent role from the PluginManager state.
   */
  getAgentRole(role: string): AgentRolePlugin | undefined {
    return this.registries.getAgentRole(role);
  }
  /**
   * Returns tool from the PluginManager state.
   */
  getTool(name: string): RegisteredTool | undefined { return this.registries.getTool(name); }
  /**
   * Returns provider from the PluginManager state.
   */
  getProvider(name: string): ProviderFactory | undefined {
    return this.registries.getProvider(name);
  }
  /**
   * Returns decorators from the PluginManager state.
   */
  getDecorators(): OutputDecorator[] { return this.registries.getDecorators(); }

  /**
   * Registers agent role with the PluginManager.
   */
  registerAgentRole(plugin: AgentRolePlugin): void {
    this.engine.assertOpen();
    this.registries.registerAgentRole(plugin);
    this.trackResource(plugin);
  }

  /** Registers one extension value through the lifecycle-aware host. */
  registerExtension<Value>(extension: import('../../contracts/plugin/extension.js').PluginExtension<Value>): void {
    this.engine.assertOpen();
    this.registries.registerExtension(extension);
    this.trackResource(extension.value);
  }

  /**
   * Registers decorator with the PluginManager.
   */
  registerDecorator(decorator: OutputDecorator, priority = decorator.priority ?? 100): void {
    this.engine.assertOpen();
    this.registries.registerDecorator(decorator, priority);
    this.trackResource(decorator);
  }

  /**
   * Registers tool with the PluginManager.
   */
  registerTool(tool: RegisteredTool): void {
    this.engine.assertOpen();
    this.registries.registerTool(tool);
    this.trackResource(tool);
  }

  /**
   * Registers provider with the PluginManager.
   */
  registerProvider(provider: ProviderPlugin): void {
    this.registerProviderContribution(provider, false);
  }

  /**
   * Creates provider according to the PluginManager contract.
   */
  async createProvider(name: string, options: RuntimeOptions = {}): Promise<Provider> {
    this.engine.assertOpen();
    const provider = await this.registries.createProvider(name, options);
    try {
      this.trackResource(provider);
      return provider;
    } catch (error) {
      if (provider.close) {
        await Promise.resolve().then(() => provider.close!()).catch(() => undefined);
      }
      throw error;
    }
  }

  /** Reports whether a provider factory belongs to the trusted bundled catalog. */
  isBuiltInProvider(name: string): boolean {
    return this.registries.isBuiltInProvider(name);
  }

  /** Discovers, orders, and activates the selected plugin graph exactly once. */
  async load(): Promise<void> {
    await this.engine.load();
  }

  /** Closes tracked resources in reverse ownership order and seals the manager. */
  async close(): Promise<void> {
    await this.engine.close();
  }

  /** Creates the scoped registration API exposed to one plugin activator. */
  private activationContext(descriptor: NormalizedPluginDescriptor): PluginActivationContext {
    const builtIn = descriptor.origin === 'core';
    return {
      services: this.services,
      own: value => this.trackResource(value),
      registerExtension: extension => this.registerExtension(extension),
      registerAgentRole: role => this.registerAgentRole(role),
      registerDecorator: (decorator, priority) => this.registerDecorator(decorator, priority),
      registerTool: tool => this.registerTool(tool),
      registerProvider: provider => this.registerProviderContribution(provider, builtIn),
      registerProviderFactory: factory => this.registerProviderInternal(factory, builtIn),
    };
  }

  /**
   * Registers provider contribution with the PluginManager.
   */
  private registerProviderContribution(provider: ProviderPlugin, builtIn: boolean): void {
    this.engine.assertOpen();
    this.registries.registerProvider(provider, builtIn);
    this.trackResource(provider);
  }

  /**
   * Registers provider internal with the PluginManager.
   */
  private registerProviderInternal(factory: ProviderFactory, builtIn: boolean): void {
    this.engine.assertOpen();
    this.registries.registerProviderFactory(factory, builtIn);
  }

  /** Transfers cleanup ownership of a plugin-created value to the engine. */
  private trackResource(value: unknown): void {
    this.engine.trackResource(value);
  }
}

function hostInternals(host: PluginHost): PluginHostInternals {
  const internals = internalsByHost.get(host);
  if (!internals) throw new PluginLoadError('Plugin manager bootstrap scope is unavailable');
  return internals;
}

/**
 * Provides contributions bootstrapping behavior for PixieCore.
 */

import { ConfigurationError, PluginLoadError } from '../../../contracts/errors/index.js';
import type {
  AgentRolePlugin,
  OutputDecorator,
  Provider,
  ProviderFactory,
  ProviderPlugin,
  RegisteredTool,
  RuntimeOptions,
} from '../../../contracts/types/index.js';
import type { PluginExtension } from '../../../contracts/plugin/extension.js';
import { normalizeProviderFactory } from '../catalog/adapters.js';
import {
  validateDecoratorStage,
  validateProvider,
  validateStringArray,
  validateTool,
} from '../model/validation.js';

/**
 * Describes the decorator registration contract.
 */
export interface DecoratorRegistration {
  readonly decorator: OutputDecorator;
  readonly effectivePriority: number;
  readonly order: number;
}

/** Typed contribution storage with the PluginManager's existing collision rules. */
export class ContributionRegistries {
  readonly agentRoles = new Map<string, AgentRolePlugin>();
  readonly tools = new Map<string, RegisteredTool>();
  readonly providers = new Map<string, ProviderFactory>();

  private readonly extensions = new Map<string, unknown[]>();

  private readonly builtInProviderFactories = new Map<string, ProviderFactory>();
  private readonly decoratorRegistrations: DecoratorRegistration[] = [];
  private decoratorOrder = 0;

  /** Returns extension values in deterministic registration order. */
  getExtensions<Value>(point: string): readonly Value[] {
    return Object.freeze([...(this.extensions.get(point) ?? [])] as Value[]);
  }

  /** Registers one value for a namespaced extension point. */
  registerExtension<Value>(extension: PluginExtension<Value>): void {
    if (!extension || typeof extension.point !== 'string' || !extension.point.trim()) {
      throw new PluginLoadError('Plugin extension requires a non-empty point');
    }
    if (extension.value === undefined) {
      throw new PluginLoadError(`Plugin extension ${extension.point} requires a value`);
    }
    const point = extension.point.trim();
    const values = this.extensions.get(point) ?? [];
    values.push(extension.value);
    this.extensions.set(point, values);
  }

  /**
   * Returns agent role from the ContributionRegistries state.
   */
  getAgentRole(role: string): AgentRolePlugin | undefined {
    return this.agentRoles.get(role);
  }

  /**
   * Returns tool from the ContributionRegistries state.
   */
  getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Returns provider from the ContributionRegistries state.
   */
  getProvider(name: string): ProviderFactory | undefined {
    return this.providers.get(name);
  }

  /**
   * Returns decorators from the ContributionRegistries state.
   */
  getDecorators(): OutputDecorator[] {
    return this.getDecoratorRegistrations().map(item => item.decorator);
  }

  /**
   * Returns decorator registrations from the ContributionRegistries state.
   */
  getDecoratorRegistrations(): DecoratorRegistration[] {
    return [...this.decoratorRegistrations]
      .sort((left, right) => left.effectivePriority - right.effectivePriority || left.order - right.order);
  }

  /**
   * Registers agent role with the ContributionRegistries.
   */
  registerAgentRole(plugin: AgentRolePlugin): void {
    if (!plugin || typeof plugin.apply !== 'function') {
      throw new PluginLoadError('Agent role plugin requires apply()');
    }
    const roles = validateStringArray(plugin.supportedRoles, 'Agent role plugin supportedRoles', true);
    for (const role of roles) this.agentRoles.set(role, plugin);
  }

  /**
   * Registers decorator with the ContributionRegistries.
   */
  registerDecorator(decorator: OutputDecorator, priority = decorator.priority ?? 100): void {
    if (!decorator || typeof decorator.validate !== 'function') {
      throw new PluginLoadError('Decorator plugin requires validate()');
    }
    if (!Number.isFinite(priority)) throw new PluginLoadError('Decorator priority must be a finite number');
    validateDecoratorStage(decorator.stage);
    this.decoratorRegistrations.push({
      decorator,
      effectivePriority: priority,
      order: this.decoratorOrder++,
    });
  }

  /**
   * Registers tool with the ContributionRegistries.
   */
  registerTool(tool: RegisteredTool): void {
    validateTool(tool);
    this.tools.set(tool.name, tool);
  }

  /**
   * Registers provider with the ContributionRegistries.
   */
  registerProvider(provider: ProviderPlugin, builtIn = false): void {
    this.registerProviderFactory(normalizeProviderFactory(provider), builtIn);
  }

  /**
   * Registers provider factory with the ContributionRegistries.
   */
  registerProviderFactory(factory: ProviderFactory, builtIn = false): void {
    if (!factory || typeof factory.name !== 'string' || !factory.name.trim() || typeof factory.create !== 'function') {
      throw new PluginLoadError('Provider plugin requires a non-empty name and create()');
    }
    this.providers.set(factory.name, factory);
    if (builtIn) this.builtInProviderFactories.set(factory.name, factory);
  }

  /**
   * Creates provider according to the ContributionRegistries contract.
   */
  async createProvider(name: string, options: RuntimeOptions = {}): Promise<Provider> {
    const factory = this.providers.get(name);
    if (!factory) throw new ConfigurationError(`Unknown provider: ${name}`);
    const provider = await factory.create(options);
    validateProvider(provider, name);
    return provider;
  }

  /**
   * Reports whether built in provider.
   */
  isBuiltInProvider(name: string): boolean {
    const factory = this.providers.get(name);
    return factory !== undefined && factory === this.builtInProviderFactories.get(name);
  }
}

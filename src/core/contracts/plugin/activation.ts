/**
 * Defines activation contracts shared across PixieCore boundaries.
 */

import { PluginLoadError } from '../errors/index.js';
import type {
  AgentRolePlugin,
  OutputDecorator,
  ProviderFactory,
  ProviderPlugin,
  RegisteredTool,
} from '../types/index.js';
import type { PluginExtension } from './extension.js';

const serviceTokenType: unique symbol = Symbol('pixiecore.service-token');

/**
 * Defines the supported service collision policy.
 */
export type ServiceCollisionPolicy = 'reject' | 'replace';

/**
 * Configures service token behavior.
 */
export interface ServiceTokenOptions {
  readonly collisionPolicy?: ServiceCollisionPolicy;
}

/** A scope-local, invariant key for one service value type. */
export interface ServiceToken<Value> {
  readonly id: string;
  readonly collisionPolicy: ServiceCollisionPolicy;
  /** Preserves the invariant service type without exposing it at runtime. */
  readonly [serviceTokenType]: (value: Value) => Value;
}

/** Internal factory; the contracts barrel deliberately re-exports only types. */
export function createServiceToken<Value>(
  id: string,
  options: ServiceTokenOptions = {},
): ServiceToken<Value> {
  if (typeof id !== 'string' || !id.trim()) {
    throw new PluginLoadError('Service token requires a non-empty id');
  }
  return Object.freeze({
    id: id.trim(),
    collisionPolicy: options.collisionPolicy ?? 'reject',
    [serviceTokenType]: (value: Value): Value => value,
  });
}

/**
 * Defines the service registry boundary implemented by adapters.
 */
export interface ServiceRegistryPort {
  /**
   * Reports whether the requested operation.
   */
  has<Value>(token: ServiceToken<Value>): boolean;
  /**
   * Resolves for the owning PixieCore boundary.
   */
  resolve<Value>(token: ServiceToken<Value>): Value;
  /**
   * Resolves optional for the owning PixieCore boundary.
   */
  resolveOptional<Value>(token: ServiceToken<Value>): Value | undefined;
  /**
   * Registers for the owning PixieCore boundary.
   */
  register<Value>(token: ServiceToken<Value>, value: Value): void;
}

/**
 * Describes the plugin contribution registrar contract.
 */
export interface PluginContributionRegistrar {
  /** Registers a value for one namespaced extension point. */
  registerExtension<Value>(extension: PluginExtension<Value>): void;
  /**
   * Registers agent role for the owning PixieCore boundary.
   */
  registerAgentRole(value: AgentRolePlugin): void;
  /**
   * Registers decorator for the owning PixieCore boundary.
   */
  registerDecorator(value: OutputDecorator, priority?: number): void;
  /**
   * Registers tool for the owning PixieCore boundary.
   */
  registerTool(value: RegisteredTool): void;
  /**
   * Registers provider for the owning PixieCore boundary.
   */
  registerProvider(value: ProviderPlugin): void;
  /**
   * Registers provider factory for the owning PixieCore boundary.
   */
  registerProviderFactory(value: ProviderFactory): void;
}

/** Capabilities available to every normalized plugin activator. */
export interface PluginActivationContext extends PluginContributionRegistrar {
  readonly services: ServiceRegistryPort;
  /**
   * Takes ownership of for the owning PixieCore boundary.
   */
  own(value: unknown): void;
}

/**
 * Describes the plugin activator contract.
 */
export interface PluginActivator {
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context: PluginActivationContext): void | Promise<void>;
  /**
   * Releases resources owned by the implementation.
   */
  close?(): void | Promise<void>;
}

/**
 * Describes the synchronous plugin activator contract.
 */
export interface SynchronousPluginActivator extends PluginActivator {
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context: PluginActivationContext): void;
}

/**
 * Defines the supported plugin activator factory values.
 */
export type PluginActivatorFactory = () => SynchronousPluginActivator;

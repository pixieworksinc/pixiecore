/**
 * Provides services bootstrapping behavior for PixieCore.
 */

import { PluginLoadError } from '../../../contracts/errors/index.js';
import type {
  ServiceRegistryPort,
  ServiceToken,
} from '../../../contracts/plugin/activation.js';

interface ServiceRegistration {
  readonly value: unknown;
}

/** One bootstrap scope's typed services; lifecycle ownership remains explicit. */
export class ScopedServiceRegistry implements ServiceRegistryPort {
  private readonly registrations = new Map<object, ServiceRegistration>();
  private readonly tokensById = new Map<string, object>();

  /**
   * Handles has according to the ScopedServiceRegistry contract.
   */
  has<Value>(token: ServiceToken<Value>): boolean {
    return this.registrations.has(token);
  }

  /**
   * Resolves the requested operation without mutating caller-owned input.
   */
  resolve<Value>(token: ServiceToken<Value>): Value {
    const registration = this.registrations.get(token);
    if (!registration) throw new PluginLoadError(`Plugin service is not registered: ${token.id}`);
    return registration.value as Value;
  }

  /**
   * Resolves optional without mutating caller-owned input.
   */
  resolveOptional<Value>(token: ServiceToken<Value>): Value | undefined {
    return this.registrations.get(token)?.value as Value | undefined;
  }

  /**
   * Registers the requested operation with the ScopedServiceRegistry.
   */
  register<Value>(token: ServiceToken<Value>, value: Value): void {
    const matchingId = this.tokensById.get(token.id);
    if (matchingId && matchingId !== token) {
      throw new PluginLoadError(`Plugin service token id is already registered: ${token.id}`);
    }
    if (this.registrations.has(token) && token.collisionPolicy !== 'replace') {
      throw new PluginLoadError(`Plugin service is already registered: ${token.id}`);
    }
    this.tokensById.set(token.id, token);
    this.registrations.set(token, { value });
  }
}

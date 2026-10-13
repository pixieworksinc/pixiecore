/**
 * Provides engine bootstrapping behavior for PixieCore.
 */

import { PluginLoadError } from '../../../contracts/errors/index.js';
import type { PluginActivationContext } from '../../../contracts/plugin/activation.js';
import { errorMessage } from '../../../component/diagnostics/index.js';
import type {
  NormalizedPluginDescriptor,
  PluginCatalog,
  SynchronousPluginDefinition,
} from '../model/definition.js';
import { resolveDependencyOrder } from '../dependency/order.js';
import { PluginLifecycle } from './lifecycle.js';
import type { PluginStatusTracker } from './status.js';
import { asError } from '../model/validation.js';

/** Sequential catalog-to-activator orchestration behind the public manager facade. */
export class PluginEngine {
  private readonly lifecycle = new PluginLifecycle();
  private readonly synchronousDefinitions: readonly SynchronousPluginDefinition[];
  private readonly synchronousDefinitionsById = new Map<string, SynchronousPluginDefinition>();
  private readonly activatedSynchronousIds = new Set<string>();
  private synchronousCatalogRecorded = false;
  private loadPromise: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;
  private closeRequested = false;
  private cleaningAfterLoadFailure = false;

  /**
   * Creates a PluginEngine and establishes its initial state.
   */
  constructor(
    private readonly catalog: PluginCatalog,
    private readonly contextFor: (descriptor: NormalizedPluginDescriptor) => PluginActivationContext,
    private readonly cleanupAfterLoadFailure: () => Promise<void> = () => this.close(),
    private readonly status?: PluginStatusTracker,
  ) {
    this.synchronousDefinitions = Object.freeze([...catalog.synchronousDefinitions()]);
    for (const definition of this.synchronousDefinitions) {
      const id = definition.descriptor.id;
      if (this.synchronousDefinitionsById.has(id)) {
        throw new PluginLoadError(`Duplicate synchronous plugin id: ${id}`);
      }
      this.synchronousDefinitionsById.set(id, definition);
    }
  }

  /**
   * Tracks resource according to the PluginEngine contract.
   */
  trackResource(value: unknown): void {
    this.assertOpen();
    this.lifecycle.trackResource(value);
  }

  /**
   * Validates open and rejects unsupported state.
   */
  assertOpen(): void {
    if (this.closeRequested) throw new PluginLoadError('Plugin manager is closed');
    this.lifecycle.assertOpen();
  }

  /**
   * Handles activate synchronous catalog according to the PluginEngine contract.
   */
  activateSynchronousCatalog(): void {
    this.activateSynchronousRoots(
      this.synchronousDefinitions.map(definition => definition.descriptor.id),
    );
  }

  /** Activates the required dependency closure for the requested core roots. */
  activateSynchronousRoots(rootIds: readonly string[]): void {
    this.assertOpen();
    this.recordSynchronousCatalog();
    for (const definition of this.resolveSynchronousActivationOrder(rootIds)) {
      if (this.activatedSynchronousIds.has(definition.descriptor.id)) continue;
      this.status?.recordDescriptor(definition.descriptor, {
        state: 'resolved',
        enabled: true,
        locked: definition.descriptor.origin === 'core',
      });
      this.activateSynchronousDefinition(definition);
      this.activatedSynchronousIds.add(definition.descriptor.id);
    }
  }

  /**
   * Loads the requested operation and normalizes it for the PluginEngine.
   */
  load(): Promise<void> {
    this.assertOpen();
    this.loadPromise ??= this.loadCatalog().catch(error => {
      this.loadPromise = undefined;
      throw error;
    });
    return this.loadPromise;
  }

  /**
   * Loads catalog and normalizes it for the PluginEngine.
   */
  private async loadCatalog(): Promise<void> {
    if (!this.lifecycle.beginLoad()) return;
    try {
      for await (const definition of this.catalog.definitions()) {
        this.status?.recordDescriptor(definition.descriptor, { state: 'resolved' });
        try {
          this.activateRequiredSynchronousDependencies(definition.descriptor);
          const activator = await definition.loadActivator();
          this.status?.markLoaded(definition.descriptor);
          this.lifecycle.trackResource(activator);
          await activator.activate(this.contextFor(definition.descriptor));
          this.status?.markActivated(definition.descriptor);
        } catch (error) {
          this.status?.markFailed(definition.descriptor, error);
          throw error;
        }
      }
      this.lifecycle.completeLoad();
    } catch (error) {
      if (this.closeRequested) {
        await this.closeLifecycle().catch(() => undefined);
      } else {
        this.cleaningAfterLoadFailure = true;
        try {
          await this.cleanupAfterLoadFailure().catch(() => undefined);
        } finally {
          this.cleaningAfterLoadFailure = false;
        }
      }
      if (error instanceof PluginLoadError) throw error;
      throw new PluginLoadError(`Failed to load plugins: ${errorMessage(error)}`, {
        cause: asError(error),
      });
    }
  }

  /**
   * Releases resources owned by the PluginEngine.
   */
  close(): Promise<void> {
    this.closeRequested = true;
    if (this.cleaningAfterLoadFailure) return this.closeLifecycle();
    this.closePromise ??= this.closeAfterLoad().catch(error => {
      this.closePromise = undefined;
      throw error;
    });
    return this.closePromise;
  }

  /**
   * Releases resources owned by the PluginEngine.
   */
  private async closeAfterLoad(): Promise<void> {
    const load = this.loadPromise;
    if (load) await load.catch(() => undefined);
    await this.closeLifecycle();
  }

  /**
   * Releases resources owned by the PluginEngine.
   */
  private async closeLifecycle(): Promise<void> {
    try {
      await this.lifecycle.close();
    } finally {
      this.status?.disposeActivated();
    }
  }

  /**
   * Handles activate synchronous definition according to the PluginEngine contract.
   */
  private activateSynchronousDefinition(definition: SynchronousPluginDefinition): void {
    try {
      const activator = definition.loadActivator();
      this.status?.markLoaded(definition.descriptor);
      this.lifecycle.trackResource(activator);
      const activate = activator.activate as (context: PluginActivationContext) => unknown;
      const result = activate.call(activator, this.contextFor(definition.descriptor));
      if (result && typeof (result as PromiseLike<void>).then === 'function') {
        throw new PluginLoadError(
          `Core plugin must activate synchronously: ${definition.descriptor.id}`,
        );
      }
      this.status?.markActivated(definition.descriptor);
    } catch (error) {
      this.status?.markFailed(definition.descriptor, error);
      throw error;
    }
  }

  /**
   * Records synchronous catalog according to the PluginEngine contract.
   */
  private recordSynchronousCatalog(): void {
    if (this.synchronousCatalogRecorded) return;
    for (const definition of this.synchronousDefinitions) {
      this.status?.recordDescriptor(definition.descriptor, {
        state: 'enabled',
        enabled: true,
        locked: definition.descriptor.origin === 'core',
      });
    }
    this.synchronousCatalogRecorded = true;
  }

  /**
   * Handles activate required synchronous dependencies according to the PluginEngine contract.
   */
  private activateRequiredSynchronousDependencies(
    descriptor: NormalizedPluginDescriptor,
  ): void {
    const requiredCoreRoots = Object.keys(descriptor.requires)
      .filter(id => this.synchronousDefinitionsById.has(id));
    if (requiredCoreRoots.length > 0) this.activateSynchronousRoots(requiredCoreRoots);
  }

  /**
   * Resolves synchronous activation order without mutating caller-owned input.
   */
  private resolveSynchronousActivationOrder(
    rootIds: readonly string[],
  ): readonly SynchronousPluginDefinition[] {
    const selected = new Set<string>();
    const pending = [...new Set(rootIds)];
    const childrenByParent = new Map<string, string[]>();
    for (const definition of this.synchronousDefinitions) {
      const parentId = definition.descriptor.parentId;
      if (parentId === undefined) continue;
      const children = childrenByParent.get(parentId) ?? [];
      children.push(definition.descriptor.id);
      childrenByParent.set(parentId, children);
    }
    while (pending.length > 0) {
      const id = pending.shift()!;
      if (selected.has(id)) continue;
      const definition = this.synchronousDefinitionsById.get(id);
      if (!definition) throw new PluginLoadError(`Unknown core plugin activation root: ${id}`);
      selected.add(id);
      for (const childId of childrenByParent.get(id) ?? []) pending.push(childId);
      for (const dependencyId of Object.keys(definition.descriptor.requires)) {
        if (!this.synchronousDefinitionsById.has(dependencyId)) {
          throw new PluginLoadError(
            `Core plugin ${id} requires missing core plugin ${dependencyId}`,
          );
        }
        pending.push(dependencyId);
      }
    }

    const order = resolveDependencyOrder(
      selected,
      id => {
        const descriptor = this.synchronousDefinitionsById.get(id)!.descriptor;
        return [
          ...Object.keys(descriptor.requires),
          ...Object.keys(descriptor.optionalRequires),
        ];
      },
      (left, right) => this.compareSynchronousDefinitions(left, right),
    );
    if (order.cyclic.length > 0) {
      throw new PluginLoadError(`Core plugin dependency cycle: ${order.cyclic.join(' -> ')}`);
    }
    return order.ordered.map(id => this.synchronousDefinitionsById.get(id)!);
  }

  /**
   * Handles compare synchronous definitions according to the PluginEngine contract.
   */
  private compareSynchronousDefinitions(leftId: string, rightId: string): number {
    const left = this.synchronousDefinitionsById.get(leftId)!.descriptor;
    const right = this.synchronousDefinitionsById.get(rightId)!.descriptor;
    return left.ordinal - right.ordinal
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  }
}

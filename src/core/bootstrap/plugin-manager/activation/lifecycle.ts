/**
 * Provides lifecycle bootstrapping behavior for PixieCore.
 */

import { ResourceStack } from '../../../component/resource-stack/index.js';
import { PluginLoadError } from '../../../contracts/errors/index.js';

/** Owns PluginManager load state and resources without changing facade behavior. */
export class PluginLifecycle {
  private readonly resources = new ResourceStack();
  private loaded = false;
  private closed = false;

  /**
   * Validates open and rejects unsupported state.
   */
  assertOpen(): void {
    if (this.closed) throw new PluginLoadError('Plugin manager is closed');
  }

  /** Returns false when a completed load makes another load a no-op. */
  beginLoad(): boolean {
    this.assertOpen();
    if (this.loaded) return false;
    return true;
  }

  /**
   * Handles complete load according to the PluginLifecycle contract.
   */
  completeLoad(): void {
    this.loaded = true;
  }

  /**
   * Tracks resource according to the PluginLifecycle contract.
   */
  trackResource(value: unknown): void {
    this.assertOpen();
    this.resources.add(value);
  }

  /**
   * Releases resources owned by the PluginLifecycle.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.resources.close('Failed to close one or more plugin resources');
  }
}

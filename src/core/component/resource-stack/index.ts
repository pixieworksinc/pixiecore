/**
 * Provides reusable resource stack primitives for PixieCore.
 */

/**
 * Describes the closable resource contract.
 */
export interface ClosableResource {
  /**
   * Releases resources owned by the implementation.
   */
  close(): void | Promise<void>;
}

/**
 * Reports whether closable resource.
 */
export function isClosableResource(value: unknown): value is ClosableResource {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'close' in value
    && typeof value.close === 'function';
}

/** Owns acquired resources and closes them once, in reverse acquisition order. */
export class ResourceStack {
  private readonly resources = new Set<ClosableResource>();
  private closed = false;

  /**
   * Registers the requested operation with the ResourceStack.
   */
  add(value: unknown): void {
    if (this.closed) throw new Error('Resource stack is closed');
    if (isClosableResource(value)) this.resources.add(value);
  }

  /**
   * Releases resources owned by the ResourceStack.
   */
  async close(message = 'Failed to close one or more resources'): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const resource of [...this.resources].reverse()) {
      try { await resource.close(); }
      catch (error) { errors.push(error); }
    }
    this.resources.clear();
    if (errors.length) throw new AggregateError(errors, message);
  }
}

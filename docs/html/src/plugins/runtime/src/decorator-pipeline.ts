/**
 * Applies ordered output decorators for the runtime plugin.
 */

import type {
  DecoratorContext,
  OutputDecorator,
} from '../../../core/contracts/types/index.js';

interface DecoratorEntry {
  readonly decorator: OutputDecorator;
  readonly priority: number;
  readonly order: number;
}

/** Owns decorator registration and stable before/after execution ordering. */
export class OutputDecoratorPipeline {
  private readonly entries: DecoratorEntry[] = [];
  private nextOrder = 0;

  /** Registers a decorator with explicit priority and insertion order. */
  register(decorator: OutputDecorator, priority = decorator.priority ?? 100): void {
    this.entries.push({ decorator, priority, order: this.nextOrder++ });
  }

  /** Applies decorators configured for the requested execution stage. */
  async apply(
    stage: 'before' | 'after',
    initial: DecoratorContext,
  ): Promise<DecoratorContext> {
    let context = initial;
    const sorted = [...this.entries].sort((left, right) => (
      left.priority - right.priority || left.order - right.order
    ));
    for (const { decorator } of sorted) {
      const configuredStage = decorator.stage ?? 'after';
      if (configuredStage !== stage && configuredStage !== 'both') continue;
      context = await decorator.validate(context) ?? context;
    }
    return context;
  }
}

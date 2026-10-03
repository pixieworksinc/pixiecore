/**
 * Implements trace behavior for the logging plugin.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** Async-local trace context owned by the logging core plugin. */
const traceContext = new AsyncLocalStorage<string | null>();

/**
 * Creates trace id after validating the supplied contract.
 */
export function generateTraceId(): string {
  return randomUUID();
}

/**
 * Binds a trace identifier to the current asynchronous context.
 */
export function setTraceId(traceId: string | null): void {
  traceContext.enterWith(traceId);
}

/**
 * Returns trace id without exposing mutable internal state.
 */
export function getTraceId(): string {
  return traceContext.getStore() || 'no-trace';
}

/**
 * Executes with trace id through its public boundary.
 */
export function runWithTraceId<T>(traceId: string, task: () => T): T {
  return traceContext.run(traceId, task);
}

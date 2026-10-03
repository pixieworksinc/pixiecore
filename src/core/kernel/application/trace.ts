/**
 * Coordinates trace responsibilities inside the PixieCore kernel.
 */

import type {
  ApplicationExecutionResult,
  ApplicationNodeDefinition,
  ApplicationNodeTrace,
  ApplicationProviderUsage,
  ApplicationTrace,
  ApplicationTraceNodeOptions,
  TraceApplicationOptions,
} from '../../contracts/application/index.js';
import type { LogRecord } from '../../contracts/logging/index.js';
import { generateTraceId, runWithTraceId } from '../../../plugins/logging/logging.js';

export const APPLICATION_TRACE_SCHEMA = 'pixiecore.application-trace/v1' as const;

interface MutableProviderUsage {
  provider: string;
  model: string;
  calls: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/**
 * Records application trace events without changing execution.
 */
export class ApplicationTraceRecorder {
  readonly traceId: string;
  readonly startedAt: string;
  private readonly started = performance.now();
  private readonly nodeTraces: ApplicationNodeTrace[] = [];
  private completed: ApplicationTrace | undefined;

  /**
   * Creates a ApplicationTraceRecorder and establishes its initial state.
   */
  constructor(traceId = generateTraceId()) {
    if (typeof traceId !== 'string' || !traceId.trim()) {
      throw new TypeError('Application trace ID must be non-blank');
    }
    this.traceId = traceId;
    this.startedAt = new Date().toISOString();
  }

  /**
   * Executes node through the ApplicationTraceRecorder boundary.
   */
  async runNode<T>(options: ApplicationTraceNodeOptions, task: () => Promise<T>): Promise<T> {
    if (this.completed) throw new TypeError('Application trace is already complete');
    const started = performance.now();
    const startedAt = new Date().toISOString();
    const usage = new Map<string, MutableProviderUsage>();
    const unsubscribe = options.logger.subscribe(record => {
      collectProviderUsage(record, this.traceId, usage);
    });

    try {
      const value = await task();
      this.appendNode(options.node, startedAt, started, 'succeeded', usage);
      return value;
    } catch (error) {
      this.appendNode(
        options.node,
        startedAt,
        started,
        executionResult(error, options.signal),
        usage,
        errorCode(error),
      );
      throw error;
    } finally {
      unsubscribe();
    }
  }

  /**
   * Finalizes according to the ApplicationTraceRecorder contract.
   */
  finish(result: ApplicationExecutionResult): ApplicationTrace {
    this.completed ??= Object.freeze({
      schema: APPLICATION_TRACE_SCHEMA,
      trace_id: this.traceId,
      started_at: this.startedAt,
      duration_ms: durationSince(this.started),
      result,
      nodes: Object.freeze([...this.nodeTraces]),
    });
    return this.completed;
  }

  /**
   * Finalizes failure according to the ApplicationTraceRecorder contract.
   */
  finishFailure(error: unknown): ApplicationTrace {
    const lastNode = this.nodeTraces.at(-1);
    return this.finish(
      lastNode?.result === 'cancelled' ? 'cancelled' : executionResult(error),
    );
  }

  /**
   * Registers node with the ApplicationTraceRecorder.
   */
  private appendNode(
    node: ApplicationNodeDefinition,
    startedAt: string,
    started: number,
    result: ApplicationExecutionResult,
    usage: ReadonlyMap<string, MutableProviderUsage>,
    error?: string,
  ): void {
    const providerUsage = [...usage.values()].map(freezeProviderUsage);
    this.nodeTraces.push(Object.freeze({
      node_id: node.id,
      blueprint_version: node.blueprintVersion,
      started_at: startedAt,
      duration_ms: durationSince(started),
      result,
      provider_usage: Object.freeze(providerUsage),
      ...(error === undefined ? {} : { error_code: error }),
    }));
  }
}

/**
 * Traces application for the owning PixieCore boundary.
 */
export async function traceApplication<T>(
  options: TraceApplicationOptions,
  task: (recorder: ApplicationTraceRecorder) => Promise<T>,
): Promise<T> {
  const recorder = new ApplicationTraceRecorder(options.traceId);
  let value: T;
  try {
    value = await runWithTraceId(recorder.traceId, () => task(recorder));
  } catch (error) {
    options.onTrace?.(recorder.finishFailure(error));
    throw error;
  }
  options.onTrace?.(recorder.finish('succeeded'));
  return value;
}

function collectProviderUsage(
  record: LogRecord,
  traceId: string,
  usageByProvider: Map<string, MutableProviderUsage>,
): void {
  if (
    record.trace_id !== traceId
    || record.step !== 'llm_call'
    || record.event !== 'response'
    || typeof record.provider !== 'string'
    || typeof record.model !== 'string'
  ) return;
  const key = `${record.provider}\u0000${record.model}`;
  const usage = usageByProvider.get(key) ?? {
    provider: record.provider,
    model: record.model,
    calls: 0,
  };
  usage.calls++;
  if (isRecord(record.usage)) {
    const inputTokens = tokenCount(record.usage.input_tokens);
    const outputTokens = tokenCount(record.usage.output_tokens);
    const totalTokens = tokenCount(record.usage.total_tokens);
    if (inputTokens !== undefined) usage.inputTokens = (usage.inputTokens ?? 0) + inputTokens;
    if (outputTokens !== undefined) usage.outputTokens = (usage.outputTokens ?? 0) + outputTokens;
    if (totalTokens !== undefined) usage.totalTokens = (usage.totalTokens ?? 0) + totalTokens;
  }
  usageByProvider.set(key, usage);
}

function freezeProviderUsage(value: MutableProviderUsage): ApplicationProviderUsage {
  return Object.freeze({
    provider: value.provider,
    model: value.model,
    calls: value.calls,
    ...(value.inputTokens === undefined ? {} : { input_tokens: value.inputTokens }),
    ...(value.outputTokens === undefined ? {} : { output_tokens: value.outputTokens }),
    ...(value.totalTokens === undefined ? {} : { total_tokens: value.totalTokens }),
  });
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function executionResult(
  error: unknown,
  signal?: AbortSignal,
): ApplicationExecutionResult {
  if (signal?.aborted || isAbortFailure(error)) return 'cancelled';
  return 'failed';
}

function isAbortFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error && current.name === 'AbortError') return true;
    current = current.cause;
  }
  return false;
}

function errorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === 'string' && error.code.trim()) return error.code;
  if (error instanceof Error && error.name.trim()) return error.name;
  return 'unknown_error';
}

function durationSince(started: number): number {
  return Math.max(0, Math.round((performance.now() - started) * 1_000) / 1_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

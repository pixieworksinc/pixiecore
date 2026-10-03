/**
 * Coordinates telemetry responsibilities inside the PixieCore kernel.
 */

import type { LogRecord } from '../../contracts/logging/index.js';
import type {
  ExecutionTelemetry,
  ExecutionTelemetryRecorderOptions,
  TelemetryExecutionResult,
  TelemetryPricingRule,
  TelemetryRetryOwner,
  TelemetryUnitOptions,
  TelemetryUnitType,
} from '../../contracts/telemetry/index.js';
import { generateTraceId, runWithTraceId } from '../../../plugins/logging/logging.js';
import {
  aggregateTelemetryResult,
  createTelemetryTotals,
  createTelemetryUnit,
  type AttemptObservation,
  type MutableUsage,
} from './aggregation.js';

export type {
  ExecutionTelemetry,
  ExecutionTelemetryRecorderOptions,
  ExecutionTelemetryTotals,
  ExecutionTelemetryUnit,
  TelemetryCost,
  TelemetryCostStatus,
  TelemetryExecutionResult,
  TelemetryPricingRule,
  TelemetryProviderUsage,
  TelemetryRetryCounts,
  TelemetryRetryOwner,
  TelemetryTokenUsage,
  TelemetryUnitOptions,
  TelemetryUnitType,
} from '../../contracts/telemetry/index.js';

export const EXECUTION_TELEMETRY_SCHEMA = 'pixiecore.execution-telemetry/v1' as const;

/**
 * Records execution telemetry events without changing execution.
 */
export class ExecutionTelemetryRecorder {
  readonly telemetryId: string;
  readonly startedAt: string;
  private readonly started = performance.now();
  private readonly pricing: ReadonlyMap<string, Readonly<TelemetryPricingRule>>;
  private readonly observations = new Map<string, AttemptObservation[]>();
  private readonly activeKeys = new Set<string>();
  private activeUnits = 0;
  private completed: ExecutionTelemetry | undefined;
  private unitSequence = 0;

  /**
   * Creates a ExecutionTelemetryRecorder and establishes its initial state.
   */
  constructor(options: ExecutionTelemetryRecorderOptions = {}) {
    const telemetryId = options.telemetryId ?? generateTraceId();
    requireNonBlank(telemetryId, 'Telemetry ID');
    this.telemetryId = telemetryId;
    this.startedAt = new Date().toISOString();
    this.pricing = indexPricing(options.pricing ?? []);
  }

  /**
   * Executes unit through the ExecutionTelemetryRecorder boundary.
   */
  async runUnit<Value>(options: TelemetryUnitOptions, task: () => Promise<Value>): Promise<Value> {
    if (this.completed) throw new TypeError('Execution telemetry is already complete');
    validateUnitOptions(options);
    const key = unitKey(options.unitType, options.unitId, options.blueprintVersion);
    if (this.activeKeys.has(key)) throw new TypeError(`Telemetry unit ${options.unitId} is already active`);
    const previous = this.observations.get(key) ?? [];
    const attempt = options.attempt ?? previous.length + 1;
    if (attempt !== previous.length + 1) {
      throw new TypeError(`Telemetry attempt for ${options.unitId} must be ${previous.length + 1}`);
    }

    const started = performance.now();
    const startedAt = new Date().toISOString();
    const usage = new Map<string, MutableUsage>();
    let runtimeRetries = 0;
    const traceId = `${this.telemetryId}.unit-${++this.unitSequence}`;
    const unsubscribe = options.logger.subscribe(record => {
      if (record.trace_id !== traceId) return;
      if (record.step === 'execution_retry' && record.event === 'scheduled') {
        runtimeRetries++;
        return;
      }
      collectProviderUsage(record, usage);
    });
    this.activeUnits++;
    this.activeKeys.add(key);

    try {
      const value = await runWithTraceId(traceId, task);
      this.appendObservation(key, previous, {
        unitType: options.unitType,
        unitId: options.unitId,
        blueprintVersion: options.blueprintVersion,
        startedAt,
        durationMs: durationSince(started),
        result: 'succeeded',
        attempt,
        retryOwner: options.retryOwner ?? 'runtime',
        runtimeRetries,
        usage: [...usage.values()],
      });
      return value;
    } catch (error) {
      this.appendObservation(key, previous, {
        unitType: options.unitType,
        unitId: options.unitId,
        blueprintVersion: options.blueprintVersion,
        startedAt,
        durationMs: durationSince(started),
        result: executionResult(error, options.signal),
        attempt,
        retryOwner: options.retryOwner ?? 'runtime',
        runtimeRetries,
        errorCode: errorCode(error),
        usage: [...usage.values()],
      });
      throw error;
    } finally {
      this.activeUnits--;
      this.activeKeys.delete(key);
      unsubscribe();
    }
  }

  /**
   * Finalizes according to the ExecutionTelemetryRecorder contract.
   */
  finish(): ExecutionTelemetry {
    if (this.activeUnits !== 0) throw new TypeError('Execution telemetry has active units');
    this.completed ??= this.createArtifact();
    return this.completed;
  }

  /**
   * Registers observation with the ExecutionTelemetryRecorder.
   */
  private appendObservation(
    key: string,
    previous: AttemptObservation[],
    observation: AttemptObservation,
  ): void {
    this.observations.set(key, [...previous, Object.freeze(observation)]);
  }

  /**
   * Creates artifact according to the ExecutionTelemetryRecorder contract.
   */
  private createArtifact(): ExecutionTelemetry {
    const units = [...this.observations.values()].map(attempts => (
      createTelemetryUnit(attempts, this.pricing)
    ));
    const result = aggregateTelemetryResult(units);
    return Object.freeze({
      schema: EXECUTION_TELEMETRY_SCHEMA,
      telemetry_id: this.telemetryId,
      started_at: this.startedAt,
      duration_ms: durationSince(this.started),
      result,
      units: Object.freeze(units),
      totals: createTelemetryTotals(units),
    });
  }
}

/**
 * Records execution telemetry for the owning PixieCore boundary.
 */
export async function recordExecutionTelemetry<Value>(
  recorderOptions: ExecutionTelemetryRecorderOptions,
  unitOptions: TelemetryUnitOptions,
  task: () => Promise<Value>,
): Promise<{ readonly value: Value; readonly telemetry: ExecutionTelemetry }> {
  const recorder = new ExecutionTelemetryRecorder(recorderOptions);
  const value = await recorder.runUnit(unitOptions, task);
  return Object.freeze({ value, telemetry: recorder.finish() });
}

function collectProviderUsage(record: LogRecord, usageByProvider: Map<string, MutableUsage>): void {
  if (
    record.step !== 'llm_call'
    || record.event !== 'response'
    || typeof record.provider !== 'string'
    || typeof record.model !== 'string'
  ) return;
  const key = providerKey(record.provider, record.model);
  const usage = usageByProvider.get(key) ?? {
    provider: record.provider,
    model: record.model,
    calls: 0,
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: undefined,
    usageComplete: true,
  };
  usage.calls++;
  const inputTokens = isRecord(record.usage) ? tokenCount(record.usage.input_tokens) : undefined;
  const outputTokens = isRecord(record.usage) ? tokenCount(record.usage.output_tokens) : undefined;
  const totalTokens = isRecord(record.usage) ? tokenCount(record.usage.total_tokens) : undefined;
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) {
    usage.usageComplete = false;
  }
  usage.inputTokens = addToken(usage.inputTokens, inputTokens);
  usage.outputTokens = addToken(usage.outputTokens, outputTokens);
  usage.totalTokens = addToken(usage.totalTokens, totalTokens);
  usageByProvider.set(key, usage);
}

function indexPricing(
  rules: readonly TelemetryPricingRule[],
): ReadonlyMap<string, Readonly<TelemetryPricingRule>> {
  const indexed = new Map<string, Readonly<TelemetryPricingRule>>();
  for (const rule of rules) {
    requireNonBlank(rule.provider, 'Pricing provider');
    requireNonBlank(rule.model, 'Pricing model');
    requireNonBlank(rule.currency, 'Pricing currency');
    requireNonBlank(rule.source, 'Pricing source');
    if (!isTimestamp(rule.effectiveAt)) throw new TypeError('Pricing effectiveAt must be an RFC 3339 UTC timestamp');
    requireFiniteNonNegative(rule.inputPerMillionTokens, 'Pricing inputPerMillionTokens');
    requireFiniteNonNegative(rule.outputPerMillionTokens, 'Pricing outputPerMillionTokens');
    const key = providerKey(rule.provider, rule.model);
    if (indexed.has(key)) throw new TypeError(`Duplicate telemetry pricing rule: ${rule.provider}/${rule.model}`);
    indexed.set(key, Object.freeze({ ...rule }));
  }
  return indexed;
}

function validateUnitOptions(options: TelemetryUnitOptions): void {
  if (options.unitType !== 'blueprint' && options.unitType !== 'node') {
    throw new TypeError('Telemetry unitType must be blueprint or node');
  }
  requireNonBlank(options.unitId, 'Telemetry unit ID');
  requireNonBlank(options.blueprintVersion, 'Telemetry Blueprint version');
  if (options.attempt !== undefined && (!Number.isSafeInteger(options.attempt) || options.attempt < 1)) {
    throw new TypeError('Telemetry attempt must be a positive safe integer');
  }
  if (options.retryOwner !== undefined && !['runtime', 'application', 'host'].includes(options.retryOwner)) {
    throw new TypeError('Telemetry retryOwner must be runtime, application, or host');
  }
}

function executionResult(error: unknown, signal?: AbortSignal): TelemetryExecutionResult {
  if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return 'cancelled';
  return 'failed';
}

function errorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === 'string' && error.code.trim()) return error.code;
  if (error instanceof Error && error.name.trim()) return error.name;
  return 'unknown_error';
}

function addToken(current: number | undefined, value: unknown): number | undefined {
  const token = tokenCount(value);
  return token === undefined ? current : (current ?? 0) + token;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function providerKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}

function unitKey(type: TelemetryUnitType, id: string, version: string): string {
  return `${type}\u0000${id}\u0000${version}`;
}

function requireNonBlank(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be non-blank`);
}

function requireFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be finite and non-negative`);
}

function isTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}

function durationSince(started: number): number {
  return rounded(Math.max(0, performance.now() - started));
}

function rounded(value: number): number {
  return Number(value.toFixed(12));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

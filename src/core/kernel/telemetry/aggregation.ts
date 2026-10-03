/**
 * Coordinates aggregation responsibilities inside the PixieCore kernel.
 */

import type {
  ExecutionTelemetryTotals,
  ExecutionTelemetryUnit,
  TelemetryCost,
  TelemetryExecutionResult,
  TelemetryPricingRule,
  TelemetryProviderUsage,
  TelemetryRetryCounts,
  TelemetryRetryOwner,
  TelemetryTokenUsage,
  TelemetryUnitType,
} from '../../contracts/telemetry/index.js';

/**
 * Describes the mutable usage contract.
 */
export interface MutableUsage {
  provider: string;
  model: string;
  calls: number;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
  usageComplete: boolean;
}

/**
 * Describes the attempt observation contract.
 */
export interface AttemptObservation {
  readonly unitType: TelemetryUnitType;
  readonly unitId: string;
  readonly blueprintVersion: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly result: TelemetryExecutionResult;
  readonly attempt: number;
  readonly retryOwner: TelemetryRetryOwner;
  readonly runtimeRetries: number;
  readonly errorCode?: string;
  readonly usage: readonly MutableUsage[];
}

/**
 * Creates telemetry unit after validating the supplied contract.
 */
export function createTelemetryUnit(
  attempts: readonly AttemptObservation[],
  pricing: ReadonlyMap<string, Readonly<TelemetryPricingRule>>,
): ExecutionTelemetryUnit {
  const first = attempts[0]!;
  const last = attempts.at(-1)!;
  const usage = aggregateProviderUsage(attempts.flatMap(item => item.usage), pricing);
  const retries = retryCounts(attempts);
  const errorCodes = [...new Set(attempts.flatMap(item => (
    item.errorCode === undefined ? [] : [item.errorCode]
  )))].sort();
  return Object.freeze({
    unit_type: first.unitType,
    unit_id: first.unitId,
    blueprint_version: first.blueprintVersion,
    started_at: first.startedAt,
    duration_ms: rounded(attempts.reduce((total, item) => total + item.durationMs, 0)),
    result: last.result,
    attempts: attempts.length,
    retries,
    failure_count: attempts.filter(item => item.result === 'failed').length,
    error_codes: Object.freeze(errorCodes),
    provider_usage: Object.freeze(usage),
    tokens: sumTokens(usage),
    token_complete: usage.every(item => item.tokens !== null),
    costs: Object.freeze(sumCosts(usage)),
    cost_complete: usage.every(item => item.cost_status === 'calculated'),
  });
}

/**
 * Creates telemetry totals after validating the supplied contract.
 */
export function createTelemetryTotals(
  units: readonly ExecutionTelemetryUnit[],
): ExecutionTelemetryTotals {
  const retries = sumRetries(units.map(unit => unit.retries));
  return Object.freeze({
    unit_count: units.length,
    attempts: units.reduce((total, unit) => total + unit.attempts, 0),
    retries,
    failure_count: units.reduce((total, unit) => total + unit.failure_count, 0),
    provider_calls: units.reduce((total, unit) => (
      total + unit.provider_usage.reduce((sum, usage) => sum + usage.calls, 0)
    ), 0),
    tokens: sumTokenValues(units.map(unit => unit.tokens)),
    token_complete: units.every(unit => unit.token_complete),
    costs: Object.freeze(sumCostValues(units.flatMap(unit => unit.costs))),
    cost_complete: units.every(unit => unit.cost_complete),
  });
}

/**
 * Aggregates telemetry result for the owning PixieCore boundary.
 */
export function aggregateTelemetryResult(
  units: readonly ExecutionTelemetryUnit[],
): TelemetryExecutionResult {
  if (units.some(unit => unit.result === 'cancelled')) return 'cancelled';
  if (units.some(unit => unit.result === 'failed')) return 'failed';
  return 'succeeded';
}

function aggregateProviderUsage(
  observations: readonly MutableUsage[],
  pricing: ReadonlyMap<string, Readonly<TelemetryPricingRule>>,
): TelemetryProviderUsage[] {
  const aggregated = new Map<string, MutableUsage>();
  for (const item of observations) {
    const key = providerKey(item.provider, item.model);
    const current = aggregated.get(key) ?? {
      provider: item.provider,
      model: item.model,
      calls: 0,
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
      usageComplete: true,
    };
    current.calls += item.calls;
    current.inputTokens = sumOptional(current.inputTokens, item.inputTokens);
    current.outputTokens = sumOptional(current.outputTokens, item.outputTokens);
    current.totalTokens = sumOptional(current.totalTokens, item.totalTokens);
    current.usageComplete = current.usageComplete && item.usageComplete;
    aggregated.set(key, current);
  }
  return [...aggregated.values()]
    .sort((left, right) => providerKey(left.provider, left.model)
      .localeCompare(providerKey(right.provider, right.model)))
    .map(item => freezeProviderUsage(item, pricing.get(providerKey(item.provider, item.model))));
}

function freezeProviderUsage(
  usage: MutableUsage,
  pricing: Readonly<TelemetryPricingRule> | undefined,
): TelemetryProviderUsage {
  const tokens = completeTokens(usage);
  if (tokens === null) {
    return Object.freeze({
      provider: usage.provider,
      model: usage.model,
      calls: usage.calls,
      tokens: null,
      cost: null,
      cost_status: 'missing_usage',
    });
  }
  if (pricing === undefined) {
    return Object.freeze({
      provider: usage.provider,
      model: usage.model,
      calls: usage.calls,
      tokens,
      cost: null,
      cost_status: 'missing_pricing',
    });
  }
  return Object.freeze({
    provider: usage.provider,
    model: usage.model,
    calls: usage.calls,
    tokens,
    cost: Object.freeze({
      currency: pricing.currency,
      amount: rounded((
        tokens.input_tokens * pricing.inputPerMillionTokens
        + tokens.output_tokens * pricing.outputPerMillionTokens
      ) / 1_000_000),
    }),
    cost_status: 'calculated',
    pricing_source: pricing.source,
    pricing_effective_at: pricing.effectiveAt,
  });
}

function retryCounts(attempts: readonly AttemptObservation[]): TelemetryRetryCounts {
  const mutable = { runtime: 0, application: 0, host: 0 };
  for (const attempt of attempts) mutable.runtime += attempt.runtimeRetries;
  for (const attempt of attempts.slice(1)) mutable[attempt.retryOwner]++;
  return freezeRetryCounts(mutable.runtime, mutable.application, mutable.host);
}

function sumRetries(values: readonly TelemetryRetryCounts[]): TelemetryRetryCounts {
  return freezeRetryCounts(
    values.reduce((total, value) => total + value.runtime, 0),
    values.reduce((total, value) => total + value.application, 0),
    values.reduce((total, value) => total + value.host, 0),
  );
}

function freezeRetryCounts(runtime: number, application: number, host: number): TelemetryRetryCounts {
  return Object.freeze({ runtime, application, host, total: runtime + application + host });
}

function sumTokens(usage: readonly TelemetryProviderUsage[]): TelemetryTokenUsage {
  return sumTokenValues(usage.flatMap(item => item.tokens === null ? [] : [item.tokens]));
}

function sumTokenValues(tokens: readonly TelemetryTokenUsage[]): TelemetryTokenUsage {
  return Object.freeze({
    input_tokens: tokens.reduce((total, value) => total + value.input_tokens, 0),
    output_tokens: tokens.reduce((total, value) => total + value.output_tokens, 0),
    total_tokens: tokens.reduce((total, value) => total + value.total_tokens, 0),
  });
}

function sumCosts(usage: readonly TelemetryProviderUsage[]): TelemetryCost[] {
  return sumCostValues(usage.flatMap(item => item.cost === null ? [] : [item.cost]));
}

function sumCostValues(costs: readonly TelemetryCost[]): TelemetryCost[] {
  const byCurrency = new Map<string, number>();
  for (const cost of costs) {
    byCurrency.set(cost.currency, (byCurrency.get(cost.currency) ?? 0) + cost.amount);
  }
  return [...byCurrency.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => Object.freeze({ currency, amount: rounded(amount) }));
}

function completeTokens(usage: MutableUsage): TelemetryTokenUsage | null {
  if (
    !usage.usageComplete
    || usage.inputTokens === undefined
    || usage.outputTokens === undefined
    || usage.totalTokens === undefined
  ) return null;
  return Object.freeze({
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
  });
}

function sumOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left + right;
}

function providerKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}

function rounded(value: number): number {
  return Number(value.toFixed(12));
}

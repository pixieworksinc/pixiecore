/**
 * Defines telemetry contracts shared across PixieCore boundaries.
 */

import type { LoggerPort } from '../logging/index.js';

/**
 * Defines the supported telemetry unit type values.
 */
export type TelemetryUnitType = 'blueprint' | 'node';
/**
 * Describes the result of telemetry execution.
 */
export type TelemetryExecutionResult = 'succeeded' | 'failed' | 'cancelled';
/**
 * Defines the supported telemetry retry owner values.
 */
export type TelemetryRetryOwner = 'runtime' | 'application' | 'host';
/**
 * Defines the supported telemetry cost status values.
 */
export type TelemetryCostStatus = 'calculated' | 'missing_usage' | 'missing_pricing';

/**
 * Describes the telemetry token usage contract.
 */
export interface TelemetryTokenUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
}

/**
 * Describes the telemetry cost contract.
 */
export interface TelemetryCost {
  readonly currency: string;
  readonly amount: number;
}

/**
 * Describes the telemetry provider usage contract.
 */
export interface TelemetryProviderUsage {
  readonly provider: string;
  readonly model: string;
  readonly calls: number;
  readonly tokens: TelemetryTokenUsage | null;
  readonly cost: TelemetryCost | null;
  readonly cost_status: TelemetryCostStatus;
  readonly pricing_source?: string;
  readonly pricing_effective_at?: string;
}

/**
 * Describes the telemetry retry counts contract.
 */
export interface TelemetryRetryCounts {
  readonly runtime: number;
  readonly application: number;
  readonly host: number;
  readonly total: number;
}

/**
 * Describes the execution telemetry unit contract.
 */
export interface ExecutionTelemetryUnit {
  readonly unit_type: TelemetryUnitType;
  readonly unit_id: string;
  readonly blueprint_version: string;
  readonly started_at: string;
  readonly duration_ms: number;
  readonly result: TelemetryExecutionResult;
  readonly attempts: number;
  readonly retries: TelemetryRetryCounts;
  readonly failure_count: number;
  readonly error_codes: readonly string[];
  readonly provider_usage: readonly TelemetryProviderUsage[];
  readonly tokens: TelemetryTokenUsage;
  readonly token_complete: boolean;
  readonly costs: readonly TelemetryCost[];
  readonly cost_complete: boolean;
}

/**
 * Describes the execution telemetry totals contract.
 */
export interface ExecutionTelemetryTotals {
  readonly unit_count: number;
  readonly attempts: number;
  readonly retries: TelemetryRetryCounts;
  readonly failure_count: number;
  readonly provider_calls: number;
  readonly tokens: TelemetryTokenUsage;
  readonly token_complete: boolean;
  readonly costs: readonly TelemetryCost[];
  readonly cost_complete: boolean;
}

/**
 * Describes the execution telemetry contract.
 */
export interface ExecutionTelemetry {
  readonly schema: 'pixiecore.execution-telemetry/v1';
  readonly telemetry_id: string;
  readonly started_at: string;
  readonly duration_ms: number;
  readonly result: TelemetryExecutionResult;
  readonly units: readonly ExecutionTelemetryUnit[];
  readonly totals: ExecutionTelemetryTotals;
}

/**
 * Describes the telemetry pricing rule contract.
 */
export interface TelemetryPricingRule {
  readonly provider: string;
  readonly model: string;
  readonly currency: string;
  readonly inputPerMillionTokens: number;
  readonly outputPerMillionTokens: number;
  readonly source: string;
  readonly effectiveAt: string;
}

/**
 * Configures execution telemetry recorder behavior.
 */
export interface ExecutionTelemetryRecorderOptions {
  readonly telemetryId?: string;
  readonly pricing?: readonly TelemetryPricingRule[];
}

/**
 * Configures telemetry unit behavior.
 */
export interface TelemetryUnitOptions {
  readonly unitType: TelemetryUnitType;
  readonly unitId: string;
  readonly blueprintVersion: string;
  readonly logger: LoggerPort;
  readonly attempt?: number;
  readonly retryOwner?: TelemetryRetryOwner;
  readonly signal?: AbortSignal;
}

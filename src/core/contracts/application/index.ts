/**
 * Defines application contracts shared across PixieCore boundaries.
 */

import type { LoggerPort } from '../logging/index.js';
import type { JsonObject, JsonValue } from '../types/index.js';

/**
 * Describes the application node definition contract.
 */
export interface ApplicationNodeDefinition {
  readonly id: string;
  readonly blueprintPath: string;
  readonly blueprintVersion: string;
}

/** Inspection-only graph metadata. It does not define application execution. */
export interface ApplicationGraphNodeDefinition extends ApplicationNodeDefinition {
  readonly dependsOn?: readonly string[];
}

/**
 * Describes the application graph definition contract.
 */
export interface ApplicationGraphDefinition {
  readonly name: string;
  readonly version: string;
  readonly nodes: readonly ApplicationGraphNodeDefinition[];
}

/**
 * Describes the application graph edge inspection contract.
 */
export interface ApplicationGraphEdgeInspection {
  readonly from: string;
  readonly to: string;
}

/**
 * Describes the application graph node inspection contract.
 */
export interface ApplicationGraphNodeInspection {
  readonly id: string;
  readonly blueprint_name: string;
  readonly blueprint_version: string;
  readonly role: string;
  readonly depends_on: readonly string[];
  readonly input_schema: JsonValue;
  readonly output_schema: JsonValue;
}

/**
 * Describes the application graph inspection contract.
 */
export interface ApplicationGraphInspection {
  readonly schema: 'pixiecore.application-graph-inspection/v1';
  readonly name: string;
  readonly version: string;
  readonly nodes: readonly ApplicationGraphNodeInspection[];
  readonly edges: readonly ApplicationGraphEdgeInspection[];
}

/**
 * Describes the application mapping source contract.
 */
export interface ApplicationMappingSource {
  readonly nodeId: string;
  readonly output: unknown;
}

/**
 * Describes the application mapping request contract.
 */
export interface ApplicationMappingRequest {
  readonly targetNodeId: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly sources?: readonly ApplicationMappingSource[];
}

/**
 * Defines the supported application mapping stage values.
 */
export type ApplicationMappingStage =
  | 'definition'
  | 'source-output'
  | 'target-input';

/**
 * Describes the result of application execution.
 */
export type ApplicationExecutionResult = 'succeeded' | 'failed' | 'cancelled';

/**
 * Describes the application provider usage contract.
 */
export interface ApplicationProviderUsage {
  readonly provider: string;
  readonly model: string;
  readonly calls: number;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly total_tokens?: number;
}

/**
 * Describes the application node trace contract.
 */
export interface ApplicationNodeTrace {
  readonly node_id: string;
  readonly blueprint_version: string;
  readonly started_at: string;
  readonly duration_ms: number;
  readonly result: ApplicationExecutionResult;
  readonly provider_usage: readonly ApplicationProviderUsage[];
  readonly error_code?: string;
}

/**
 * Describes the application trace contract.
 */
export interface ApplicationTrace {
  readonly schema: 'pixiecore.application-trace/v1';
  readonly trace_id: string;
  readonly started_at: string;
  readonly duration_ms: number;
  readonly result: ApplicationExecutionResult;
  readonly nodes: readonly ApplicationNodeTrace[];
}

/**
 * Configures application trace node behavior.
 */
export interface ApplicationTraceNodeOptions {
  readonly node: ApplicationNodeDefinition;
  readonly logger: LoggerPort;
  readonly signal?: AbortSignal;
}

/**
 * Configures trace application behavior.
 */
export interface TraceApplicationOptions {
  readonly traceId?: string;
  /** Receives the immutable trace after application execution completes. */
  readonly onTrace?: (trace: ApplicationTrace) => void;
}

/**
 * Defines the supported application failure mode values.
 */
export type ApplicationFailureMode = 'fail-fast' | 'recoverable';
/**
 * Defines the supported application retry owner values.
 */
export type ApplicationRetryOwner = 'runtime' | 'application' | 'host';

/**
 * Defines the supported application node execution policy.
 */
export interface ApplicationNodeExecutionPolicy {
  readonly failureMode: ApplicationFailureMode;
  readonly retryOwner: ApplicationRetryOwner;
  /** Only valid when retryOwner is application. Defaults to one attempt. */
  readonly maxAttempts?: number;
}

/**
 * Configures application node execution behavior.
 */
export interface ApplicationNodeExecutionOptions {
  readonly node: ApplicationNodeDefinition;
  readonly policy: ApplicationNodeExecutionPolicy;
  readonly signal?: AbortSignal;
  /** Decides whether an application-owned retry may follow a failed attempt. */
  readonly shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>;
}

/**
 * Configures application node error behavior.
 */
export interface ApplicationNodeErrorOptions {
  readonly code?: string;
  readonly name?: string;
  readonly replayCommand?: string;
  readonly suggestions?: readonly string[];
}

/**
 * Carries application node execution state across a boundary.
 */
export interface ApplicationNodeExecutionContext {
  readonly attempt: number;
  readonly signal?: AbortSignal;
}

/**
 * Records application failure evidence.
 */
export interface ApplicationFailureRecord {
  readonly node_id: string;
  readonly blueprint_version: string;
  readonly error_code: string;
  readonly attempts: number;
  readonly retry_owner: ApplicationRetryOwner;
}

/**
 * Describes the application node success contract.
 */
export interface ApplicationNodeSuccess<Value> {
  readonly status: 'succeeded';
  readonly value: Value;
  readonly attempts: number;
}

/**
 * Describes the application node recoverable failure contract.
 */
export interface ApplicationNodeRecoverableFailure {
  readonly status: 'failed';
  readonly failure: ApplicationFailureRecord;
  /** In-memory cause for host handling; excluded from partial-result artifacts. */
  readonly error: unknown;
}

/**
 * Defines the supported application node outcome values.
 */
export type ApplicationNodeOutcome<Value> =
  | ApplicationNodeSuccess<Value>
  | ApplicationNodeRecoverableFailure;

/**
 * Describes the result of application partial.
 */
export interface ApplicationPartialResult {
  readonly schema: 'pixiecore.application-partial-result/v1';
  readonly result: 'succeeded' | 'partial';
  readonly outputs: JsonObject;
  readonly failures: readonly ApplicationFailureRecord[];
}

/**
 * Supplies the input required to create create application partial result.
 */
export interface CreateApplicationPartialResultInput {
  readonly outputs: JsonObject;
  readonly failures?: readonly ApplicationFailureRecord[];
}

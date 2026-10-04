/**
 * Defines evaluation contracts shared across PixieCore boundaries.
 */

import type { TelemetryCostStatus, TelemetryPricingRule } from '../telemetry/index.js';
import type { JsonObject, JsonValue, RuntimeOptions } from '../types/index.js';

/**
 * Describes the exact evaluation comparison contract.
 */
export interface ExactEvaluationComparison { readonly mode: 'exact' }
/**
 * Describes the schema evaluation comparison contract.
 */
export interface SchemaEvaluationComparison { readonly mode: 'schema' }
/**
 * Describes the fields evaluation comparison contract.
 */
export interface FieldsEvaluationComparison {
  readonly mode: 'fields';
  readonly pointers: readonly string[];
}
/**
 * Describes the set evaluation comparison contract.
 */
export interface SetEvaluationComparison {
  readonly mode: 'set';
  readonly pointer: string;
}
/**
 * Describes the numeric tolerance evaluation comparison contract.
 */
export interface NumericToleranceEvaluationComparison {
  readonly mode: 'numeric_tolerance';
  readonly pointers: readonly string[];
  readonly absolute_tolerance?: number;
  readonly relative_tolerance?: number;
}
/**
 * Describes the custom evaluation comparison contract.
 */
export interface CustomEvaluationComparison {
  readonly mode: 'custom';
  readonly comparator: string;
  readonly config?: JsonObject;
}

/**
 * Defines the supported evaluation comparison policy.
 */
export type EvaluationComparisonPolicy =
  | ExactEvaluationComparison
  | SchemaEvaluationComparison
  | FieldsEvaluationComparison
  | SetEvaluationComparison
  | NumericToleranceEvaluationComparison
  | CustomEvaluationComparison;

/**
 * Describes the blueprint evaluation case contract.
 */
export interface BlueprintEvaluationCase {
  readonly id: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly inputs: JsonObject;
  readonly expected_output: JsonObject;
  readonly comparison: EvaluationComparisonPolicy;
}

/**
 * Describes the blueprint evaluation dataset contract.
 */
export interface BlueprintEvaluationDataset {
  readonly schema: 'pixiecore.blueprint-eval-dataset/v1';
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly blueprint: {
    readonly path: string;
    readonly version?: string;
  };
  readonly tags: readonly string[];
  readonly cases: readonly BlueprintEvaluationCase[];
}

/**
 * Defines the supported evaluation difference reason values.
 */
export type EvaluationDifferenceReason =
  | 'missing_actual'
  | 'missing_expected'
  | 'not_equal'
  | 'not_array'
  | 'not_number'
  | 'outside_tolerance'
  | 'schema_validation';

/**
 * Describes the evaluation difference contract.
 */
export interface EvaluationDifference {
  readonly pointer: string;
  readonly reason: EvaluationDifferenceReason;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly detail?: string;
}

/** Identifies a known limit of a comparison, not a failed assertion. */
export type EvaluationLimitation = 'factuality_not_evaluated';

/**
 * Describes the result of evaluation comparison.
 */
export interface EvaluationComparisonResult {
  readonly passed: boolean;
  readonly differences: readonly EvaluationDifference[];
  /** Absence does not establish factuality; consult the comparison policy. */
  readonly limitations?: readonly EvaluationLimitation[];
}

/**
 * Carries evaluation custom comparator state across a boundary.
 */
export interface EvaluationCustomComparatorContext {
  readonly actual: Readonly<JsonObject>;
  readonly expected: Readonly<JsonObject>;
  readonly config: Readonly<JsonObject>;
  /**
   * Carries the input that produced the output when the caller has it.
   *
   * This is optional so direct comparison callers can continue comparing
   * output values without retaining the originating input.
   */
  readonly inputs?: Readonly<JsonObject>;
}

/**
 * Defines the supported evaluation custom comparator values.
 */
export type EvaluationCustomComparator = (
  context: EvaluationCustomComparatorContext,
) => EvaluationComparisonResult | Promise<EvaluationComparisonResult>;

/**
 * Configures evaluation comparison behavior.
 */
export interface EvaluationComparisonOptions {
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly customComparators?: ReadonlyMap<string, EvaluationCustomComparator>;
  /** Supplies the case input to a comparator that evaluates output provenance. */
  readonly inputs?: Readonly<JsonObject>;
}

/**
 * Defines the supported blueprint evaluation case status values.
 */
export type BlueprintEvaluationCaseStatus = 'passed' | 'failed' | 'error';

/**
 * Describes the result of blueprint evaluation case.
 */
export interface BlueprintEvaluationCaseResult {
  readonly id: string;
  readonly tags: readonly string[];
  readonly status: BlueprintEvaluationCaseStatus;
  readonly duration_ms: number;
  readonly provider_usage?: readonly BlueprintProviderUsage[];
  readonly actual_output?: JsonObject;
  readonly differences?: readonly EvaluationDifference[];
  readonly limitations?: readonly EvaluationLimitation[];
  readonly error?: {
    readonly name: string;
    readonly message: string;
    readonly code?: string;
  };
}

/**
 * Describes the blueprint evaluation result artifact contract.
 */
export interface BlueprintEvaluationResultArtifact {
  readonly schema: 'pixiecore.blueprint-eval-result/v1';
  readonly dataset: {
    readonly name: string;
    readonly version: string;
    readonly path: string;
    readonly sha256: string;
  };
  readonly blueprint: {
    readonly path: string;
    readonly version: string;
    readonly sha256: string;
  };
  readonly run: {
    readonly id: string;
    readonly seed: string;
    readonly seed_scope: 'runner';
    readonly started_at: string;
    readonly completed_at: string;
    readonly provider: string;
    readonly model: string;
    readonly temperature: number | null;
  };
  readonly summary: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly errors: number;
  };
  readonly cases: readonly BlueprintEvaluationCaseResult[];
  readonly replay_command: string;
}

/**
 * Configures blueprint evaluation run behavior.
 */
export interface BlueprintEvaluationRunOptions {
  readonly datasetPath: string;
  readonly cwd?: string;
  readonly seed?: string;
  readonly runtimeOptions?: RuntimeOptions;
  /** Explicit rules override bundled estimates for the same provider/model. */
  readonly pricing?: readonly TelemetryPricingRule[];
  readonly customComparators?: ReadonlyMap<string, EvaluationCustomComparator>;
}

/**
 * Defines the supported blueprint playground mode values.
 */
export type BlueprintPlaygroundMode = 'mock' | 'real' | 'both';

/**
 * Configures blueprint playground run behavior.
 */
export interface BlueprintPlaygroundRunOptions {
  readonly datasetPath: string;
  readonly caseId: string;
  readonly mode?: BlueprintPlaygroundMode;
  readonly cwd?: string;
  readonly runtimeOptions?: RuntimeOptions;
  /** Explicit rules override bundled estimates for the same provider/model. */
  readonly pricing?: readonly TelemetryPricingRule[];
  readonly customComparators?: ReadonlyMap<string, EvaluationCustomComparator>;
}

/**
 * Describes the blueprint playground execution contract.
 */
export interface BlueprintPlaygroundExecution {
  readonly provider: string;
  readonly model: string;
  readonly output: JsonObject;
}

/**
 * Describes the blueprint provider pricing contract.
 */
export interface BlueprintProviderPricing {
  readonly currency: string;
  readonly input_per_million_tokens: number;
  readonly output_per_million_tokens: number;
  readonly source: string;
  readonly effective_at: string;
}

/**
 * Describes the blueprint provider usage contract.
 */
export interface BlueprintProviderUsage {
  readonly provider: string;
  readonly model: string;
  readonly calls: number;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly total_tokens: number | null;
  readonly estimated_cost: {
    readonly currency: string;
    readonly amount: number;
  } | null;
  readonly cost_status: TelemetryCostStatus;
  readonly pricing: BlueprintProviderPricing | null;
}

/**
 * Describes the blueprint playground artifact contract.
 */
export interface BlueprintPlaygroundArtifact {
  readonly schema: 'pixiecore.blueprint-playground/v1';
  readonly dataset: {
    readonly name: string;
    readonly version: string;
    readonly path: string;
  };
  readonly blueprint: {
    readonly path: string;
    readonly version: string;
  };
  readonly case: {
    readonly id: string;
    readonly tags: readonly string[];
  };
  readonly mode: BlueprintPlaygroundMode;
  readonly mock?: BlueprintPlaygroundExecution;
  readonly real?: BlueprintPlaygroundExecution & {
    /** Present on artifacts generated by PixieCore 0.1.0 and later. */
    readonly provider_usage?: readonly BlueprintProviderUsage[];
    readonly comparison: EvaluationComparisonResult;
  };
  readonly replay_command: string;
}

/**
 * Describes the blueprint benchmark pricing contract.
 */
export interface BlueprintBenchmarkPricing {
  readonly currency: string;
  readonly inputPerMillionTokens: number;
  readonly outputPerMillionTokens: number;
}

/**
 * Carries blueprint benchmark run state across a boundary.
 */
export interface BlueprintBenchmarkRunContext {
  readonly targetId: string;
  readonly run: number;
  readonly seed: string;
}

/**
 * Describes the blueprint benchmark target contract.
 */
export interface BlueprintBenchmarkTarget {
  readonly id: string;
  /** Creates isolated runtime options for one benchmark run and seed. */
  readonly createRuntimeOptions: (
    context: BlueprintBenchmarkRunContext,
  ) => RuntimeOptions | Promise<RuntimeOptions>;
  readonly pricing?: BlueprintBenchmarkPricing;
}

/**
 * Configures blueprint benchmark behavior.
 */
export interface BlueprintBenchmarkOptions {
  readonly datasetPath: string;
  readonly cwd?: string;
  readonly seed?: string;
  readonly runsPerTarget?: number;
  readonly targets: readonly BlueprintBenchmarkTarget[];
  readonly customComparators?: ReadonlyMap<string, EvaluationCustomComparator>;
}

/**
 * Describes the result of blueprint benchmark run.
 */
export interface BlueprintBenchmarkRunResult {
  readonly run: number;
  readonly seed: string;
  readonly summary: BlueprintEvaluationResultArtifact['summary'];
  readonly accuracy: number;
  readonly limitations?: readonly EvaluationLimitation[];
  readonly latency_ms: number;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly total_tokens: number | null;
  readonly cost: number | null;
}

/**
 * Describes the result of blueprint benchmark target.
 */
export interface BlueprintBenchmarkTargetResult {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly pricing: BlueprintBenchmarkPricing | null;
  readonly totals: BlueprintEvaluationResultArtifact['summary'];
  readonly accuracy: number;
  readonly limitations?: readonly EvaluationLimitation[];
  readonly accuracy_standard_deviation: number;
  readonly latency_ms: {
    readonly mean: number;
    readonly p50: number;
    readonly p95: number;
    readonly standard_deviation: number;
  };
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly total_tokens: number;
  } | null;
  readonly cost: {
    readonly currency: string;
    readonly total: number;
    readonly mean_per_case: number;
  } | null;
  readonly runs: readonly BlueprintBenchmarkRunResult[];
}

/**
 * Describes the blueprint benchmark artifact contract.
 */
export interface BlueprintBenchmarkArtifact {
  readonly schema: 'pixiecore.blueprint-benchmark/v1';
  readonly dataset: BlueprintEvaluationResultArtifact['dataset'];
  readonly blueprint: BlueprintEvaluationResultArtifact['blueprint'];
  readonly benchmark: {
    readonly id: string;
    readonly seed: string;
    readonly seed_scope: 'runner';
    readonly started_at: string;
    readonly completed_at: string;
    readonly runs_per_target: number;
  };
  readonly targets: readonly BlueprintBenchmarkTargetResult[];
}

/**
 * Configures blueprint benchmark scorecard behavior.
 */
export interface BlueprintBenchmarkScorecardOptions {
  readonly release: string;
  readonly generatedAt: string;
  readonly reproductionCommand: string;
  readonly methodology: string;
  readonly pricingSource?: string;
}

/**
 * Defines the supported evaluation property kind values.
 */
export type EvaluationPropertyKind =
  | 'date'
  | 'amount'
  | 'locale'
  | 'unicode'
  | 'whitespace'
  | 'boundary';

/**
 * Describes the evaluation property case contract.
 */
export interface EvaluationPropertyCase {
  readonly id: string;
  readonly kind: EvaluationPropertyKind;
  readonly ordinal: number;
  readonly value: JsonValue;
  readonly tags: readonly string[];
}

/**
 * Describes the evaluation property corpus contract.
 */
export interface EvaluationPropertyCorpus {
  readonly schema: 'pixiecore.evaluation-property-corpus/v1';
  readonly seed: string;
  readonly cases_per_kind: number;
  readonly cases: readonly EvaluationPropertyCase[];
}

/**
 * Configures create evaluation property corpus behavior.
 */
export interface CreateEvaluationPropertyCorpusOptions {
  readonly seed: string;
  readonly casesPerKind?: number;
}

/**
 * Defines jit contracts shared across PixieCore boundaries.
 */

import type {
  BlueprintEvaluationDataset,
  EvaluationComparisonOptions,
  EvaluationComparisonPolicy,
  EvaluationComparisonResult,
} from '../evaluation/index.js';
import type { Blueprint, JitExecutionEvent, JsonObject, JsonValue } from '../types/index.js';

export type { JitExecutionEvent, JitFallbackReason } from '../types/index.js';

/**
 * Defines the supported jit arithmetic operator values.
 */
export type JitArithmeticOperator = 'add' | 'subtract' | 'multiply' | 'divide';
/**
 * Defines the supported jit comparison operator values.
 */
export type JitComparisonOperator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq';
/**
 * Defines the supported jit rounding mode values.
 */
export type JitRoundingMode = 'ceil' | 'floor' | 'nearest';

/** Closed data vocabulary accepted by PixieCore's deterministic interpreter. */
export type JitExpression =
  | { readonly kind: 'input'; readonly name: string }
  | { readonly kind: 'const'; readonly value: JsonValue }
  | { readonly kind: 'field'; readonly of: JitExpression; readonly name: string }
  | {
      readonly kind: 'arithmetic';
      readonly op: JitArithmeticOperator;
      readonly left: JitExpression;
      readonly right: JitExpression;
    }
  | {
      readonly kind: 'round';
      readonly mode: JitRoundingMode;
      readonly of: JitExpression;
      readonly digits?: number;
    }
  | {
      readonly kind: 'compare';
      readonly op: JitComparisonOperator;
      readonly left: JitExpression;
      readonly right: JitExpression;
    }
  | {
      readonly kind: 'choose';
      readonly when: JitExpression;
      readonly then: JitExpression;
      readonly otherwise: JitExpression;
    }
  | {
      readonly kind: 'lookup';
      readonly table: Readonly<Record<string, JsonValue>>;
      readonly key: JitExpression;
      readonly fallback?: JsonValue;
    }
  | { readonly kind: 'concat'; readonly parts: readonly JitExpression[] }
  | { readonly kind: 'compact'; readonly parts: readonly JitExpression[] }
  | { readonly kind: 'toNumber'; readonly of: JitExpression }
  | { readonly kind: 'toText'; readonly of: JitExpression };

/**
 * Describes the jit program contract.
 */
export interface JitProgram {
  readonly outputs: Readonly<Record<string, JitExpression>>;
}

/**
 * Describes the jit program limits contract.
 */
export interface JitProgramLimits {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxOutputs?: number;
  readonly maxCollectionItems?: number;
}

/**
 * Describes the result of jit execution.
 */
export interface JitExecutionResult {
  readonly output: Readonly<Record<string, JsonValue>>;
  readonly artifact: string;
}

/**
 * Describes the jit promotion evidence contract.
 */
export interface JitPromotionEvidence {
  readonly dataset_digest: string;
  readonly seed: string;
  readonly case_count: number;
  readonly run_count: number;
  readonly correct: number;
  readonly agreed: number;
  readonly measured_at: string;
}

/**
 * Describes the jit promotion contract.
 */
export interface JitPromotion {
  readonly blueprint: string;
  readonly version: string;
  readonly model: string;
  readonly source_digest: string;
  readonly artifact_digest: string;
  readonly evidence: JitPromotionEvidence;
  readonly program: JitProgram;
}

/**
 * Describes the jit promotion file contract.
 */
export interface JitPromotionFile {
  readonly schema: 'pixiecore.jit-promotions/v1';
  readonly note: string;
  readonly promotions: readonly JitPromotion[];
}

/**
 * Defines the supported jit admission divergence against values.
 */
export type JitAdmissionDivergenceAgainst = 'expectation' | 'model';

/**
 * Describes the jit admission divergence contract.
 */
export interface JitAdmissionDivergence {
  readonly against: JitAdmissionDivergenceAgainst;
  readonly pointer: string;
  readonly reason: string;
}

/**
 * Describes the jit admission case report contract.
 */
export interface JitAdmissionCaseReport {
  readonly id: string;
  readonly runs: number;
  readonly correct: number;
  readonly agreed: number;
  readonly program_errors: number;
  readonly model_errors: number;
  readonly divergences: readonly JitAdmissionDivergence[];
}

/**
 * Defines the supported jit admission refusal reason values.
 */
export type JitAdmissionRefusalReason =
  | 'no_cases'
  | 'program_error'
  | 'model_error'
  | 'expectation_mismatch'
  | 'model_mismatch';

/**
 * Describes the jit admission report contract.
 */
export interface JitAdmissionReport {
  readonly schema: 'pixiecore.jit-admission-report/v1';
  readonly seed: string;
  readonly measured_at: string;
  readonly blueprint: {
    readonly name: string;
    readonly version: string;
    readonly source_digest: string;
  };
  readonly dataset: {
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly provider: string;
  readonly model: string;
  readonly program_digest: string;
  readonly promoted: boolean;
  readonly refusal_reason?: JitAdmissionRefusalReason;
  readonly summary: {
    readonly case_count: number;
    readonly run_count: number;
    readonly correct: number;
    readonly agreed: number;
    readonly program_errors: number;
    readonly model_errors: number;
  };
  readonly cases: readonly JitAdmissionCaseReport[];
}

/**
 * Defines the supported jit expected comparator values.
 */
export type JitExpectedComparator = (
  actual: Readonly<JsonObject>,
  expected: Readonly<JsonObject>,
  policy: EvaluationComparisonPolicy,
  options?: EvaluationComparisonOptions,
) => EvaluationComparisonResult | Promise<EvaluationComparisonResult>;

/**
 * Configures jit admission behavior.
 */
export interface JitAdmissionOptions {
  readonly blueprint: Readonly<Blueprint>;
  readonly dataset: Readonly<BlueprintEvaluationDataset>;
  readonly program: JitProgram;
  readonly provider: string;
  readonly model: string;
  /** Executes one evidence case through the model path under evaluation. */
  readonly executeModel: (
    inputs: Readonly<JsonObject>,
    context: {
      readonly caseId: string;
      readonly run: number;
      readonly seed: string;
      readonly signal?: AbortSignal;
    },
  ) => JsonObject | Promise<JsonObject>;
  readonly compareExpected: JitExpectedComparator;
  readonly comparisonOptions?: EvaluationComparisonOptions;
  readonly runs?: number;
  readonly seed?: string;
  readonly signal?: AbortSignal;
  /** Validates model output before it may count as promotion evidence. */
  readonly validateOutput?: (value: unknown) => JsonObject;
}

/**
 * Configures jit executor behavior.
 */
export interface JitExecutorOptions {
  readonly promotionsPath: string;
  /** Observes value-free JIT decisions without controlling execution. */
  readonly onEvent?: (event: JitExecutionEvent) => void;
}

/** Optional processor strategy. Returning undefined preserves the model path. */
export interface JitExecutionPort {
  /**
   * Executes the requested operation through its public boundary.
   */
  execute(
    blueprint: Readonly<Blueprint>,
    inputs: Readonly<Record<string, unknown>>,
    model: string,
  ): JitExecutionResult | undefined | Promise<JitExecutionResult | undefined>;
}

/**
 * Defines the jit service boundary implemented by adapters.
 */
export interface JitServicePort {
  /**
   * Validates program and rejects unsupported input.
   */
  validateProgram(value: unknown, limits?: JitProgramLimits): JitProgram;
  /**
   * Executes program through its public boundary.
   */
  runProgram(program: JitProgram, inputs: Readonly<Record<string, unknown>>): Readonly<Record<string, JsonValue>>;
  /**
   * Creates executor after validating the supplied contract.
   */
  createExecutor(options: JitExecutorOptions): JitExecutionPort;
  /**
   * Evaluates admission for for the owning PixieCore boundary.
   */
  admit(options: JitAdmissionOptions): Promise<JitAdmissionReport>;
}

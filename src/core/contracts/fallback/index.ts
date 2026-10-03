/**
 * Defines fallback contracts shared across PixieCore boundaries.
 */

/**
 * Describes the fallback quality evidence contract.
 */
export interface FallbackQualityEvidence {
  readonly score: number;
  readonly dataset_id: string;
  readonly dataset_version: string;
  readonly measured_at: string;
}

/**
 * Describes the provider fallback target contract.
 */
export interface ProviderFallbackTarget {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly quality: FallbackQualityEvidence;
}

/**
 * Defines the supported provider fallback policy.
 */
export interface ProviderFallbackPolicy {
  readonly policy_id: string;
  readonly policy_version: string;
  readonly fallback_error_codes: readonly string[];
  readonly minimum_quality_score: number;
  readonly maximum_quality_drop: number;
}

/**
 * Describes the provider fallback attempt contract.
 */
export interface ProviderFallbackAttempt {
  readonly target_id: string;
  readonly provider: string;
  readonly model: string;
  readonly quality_score: number;
  readonly dataset_id: string;
  readonly dataset_version: string;
  readonly result: 'succeeded' | 'failed';
  readonly error_code?: string;
}

/**
 * Describes the provider fallback receipt contract.
 */
export interface ProviderFallbackReceipt {
  readonly schema: 'pixiecore.provider-fallback-receipt/v1';
  readonly policy_id: string;
  readonly policy_version: string;
  readonly fallback_used: boolean;
  readonly selected_target_id: string | null;
  readonly quality_drop: number | null;
  readonly attempts: readonly ProviderFallbackAttempt[];
}

/**
 * Configures provider fallback execution behavior.
 */
export interface ProviderFallbackExecutionOptions {
  readonly targets: readonly ProviderFallbackTarget[];
  readonly policy: ProviderFallbackPolicy;
  readonly signal?: AbortSignal;
}

/**
 * Carries provider fallback execution state across a boundary.
 */
export interface ProviderFallbackExecutionContext {
  readonly target: Readonly<ProviderFallbackTarget>;
  readonly attempt: number;
  readonly signal?: AbortSignal;
}

/**
 * Describes the result of provider fallback execution.
 */
export interface ProviderFallbackExecutionResult<Value> {
  readonly value: Value;
  readonly receipt: ProviderFallbackReceipt;
}

/**
 * Defines control contracts shared across PixieCore boundaries.
 */

/**
 * Describes the application rate limit contract.
 */
export interface ApplicationRateLimit {
  readonly maxStarts: number;
  readonly intervalMs: number;
}

/**
 * Configures application execution control behavior.
 */
export interface ApplicationExecutionControlOptions {
  readonly maxBudgetUnits: number;
  readonly maxConcurrent: number;
  readonly rateLimit: ApplicationRateLimit;
  readonly deadlineAt: Date | string;
  readonly signal?: AbortSignal;
  /** Supplies the clock used for deterministic deadline and rate-limit checks. */
  readonly now?: () => Date;
}

/**
 * Configures application controlled task behavior.
 */
export interface ApplicationControlledTaskOptions {
  readonly unitId: string;
  readonly budgetUnits: number;
}

/**
 * Carries application controlled task state across a boundary.
 */
export interface ApplicationControlledTaskContext {
  readonly signal: AbortSignal;
}

/**
 * Describes the application execution control snapshot contract.
 */
export interface ApplicationExecutionControlSnapshot {
  readonly max_budget_units: number;
  readonly used_budget_units: number;
  readonly remaining_budget_units: number;
  readonly max_concurrent: number;
  readonly active: number;
  readonly rate_limit_max_starts: number;
  readonly rate_limit_interval_ms: number;
  readonly starts_in_window: number;
  readonly deadline_at: string;
  readonly cancelled: boolean;
}

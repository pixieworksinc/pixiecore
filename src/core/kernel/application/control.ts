/**
 * Coordinates control responsibilities inside the PixieCore kernel.
 */

import type {
  ApplicationControlledTaskContext,
  ApplicationControlledTaskOptions,
  ApplicationExecutionControlOptions,
  ApplicationExecutionControlSnapshot,
  ApplicationRateLimit,
} from '../../contracts/application/control.js';
import { PixieCoreError } from '../../contracts/errors/index.js';

export type {
  ApplicationControlledTaskContext,
  ApplicationControlledTaskOptions,
  ApplicationExecutionControlOptions,
  ApplicationExecutionControlSnapshot,
  ApplicationRateLimit,
} from '../../contracts/application/control.js';

/**
 * Reports application control contract failures.
 */
export class ApplicationControlContractError extends PixieCoreError {
  /**
   * Creates a ApplicationControlContractError with the supplied failure context.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'application_control_contract_error', options);
  }
}

/**
 * Reports application budget exceeded failures.
 */
export class ApplicationBudgetExceededError extends PixieCoreError {
  readonly requestedUnits: number;
  readonly remainingUnits: number;

  /**
   * Creates a ApplicationBudgetExceededError with the supplied failure context.
   */
  constructor(requestedUnits: number, remainingUnits: number) {
    super('Application budget would be exceeded', 'application_budget_exceeded');
    this.requestedUnits = requestedUnits;
    this.remainingUnits = remainingUnits;
  }
}

/**
 * Reports application deadline exceeded failures.
 */
export class ApplicationDeadlineExceededError extends PixieCoreError {
  readonly deadlineAt: string;

  /**
   * Creates a ApplicationDeadlineExceededError with the supplied failure context.
   */
  constructor(deadlineAt: string) {
    super('Application deadline has been exceeded', 'application_deadline_exceeded');
    this.deadlineAt = deadlineAt;
  }
}

/**
 * Reports application rate limit failures.
 */
export class ApplicationRateLimitError extends PixieCoreError {
  readonly retryAfterMs: number;

  /**
   * Creates a ApplicationRateLimitError with the supplied failure context.
   */
  constructor(retryAfterMs: number) {
    super('Application start rate limit has been exceeded', 'application_rate_limit_exceeded');
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Reports application concurrency limit failures.
 */
export class ApplicationConcurrencyLimitError extends PixieCoreError {
  /**
   * Creates a ApplicationConcurrencyLimitError with the supplied failure context.
   */
  constructor() {
    super('Application concurrency limit has been reached', 'application_concurrency_limit');
  }
}

/**
 * In-process admission control for one application execution boundary.
 * Distributed quotas and queues remain host responsibilities.
 */
export class ApplicationExecutionController {
  private readonly maxBudgetUnits: number;
  private readonly maxConcurrent: number;
  private readonly rateLimit: Readonly<ApplicationRateLimit>;
  private readonly deadlineAt: Date;
  private readonly externalSignal: AbortSignal | undefined;
  private readonly controller = new AbortController();
  private readonly now: () => Date;
  private usedBudgetUnits = 0;
  private active = 0;
  private starts: number[] = [];

  /**
   * Creates a ApplicationExecutionController and establishes its initial state.
   */
  constructor(options: ApplicationExecutionControlOptions) {
    if (!options || typeof options !== 'object') {
      throw new ApplicationControlContractError('options must be an object');
    }
    this.maxBudgetUnits = positiveNumber(options.maxBudgetUnits, 'maxBudgetUnits');
    this.maxConcurrent = positiveInteger(options.maxConcurrent, 'maxConcurrent');
    this.rateLimit = validateRateLimit(options.rateLimit);
    this.deadlineAt = canonicalDeadline(options.deadlineAt);
    if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
      throw new ApplicationControlContractError('signal must be an AbortSignal');
    }
    this.externalSignal = options.signal;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Executes the requested operation through the ApplicationExecutionController boundary.
   */
  async run<Value>(
    options: ApplicationControlledTaskOptions,
    task: (context: ApplicationControlledTaskContext) => Value | Promise<Value>,
  ): Promise<Value> {
    nonBlank(options?.unitId, 'unitId');
    const budgetUnits = positiveNumber(options?.budgetUnits, 'budgetUnits');
    if (typeof task !== 'function') throw new ApplicationControlContractError('task must be a function');
    this.throwIfCancelled();
    const now = validNow(this.now());
    this.throwIfDeadline(now);
    this.pruneStarts(now.getTime());

    const remaining = this.maxBudgetUnits - this.usedBudgetUnits;
    if (budgetUnits > remaining) throw new ApplicationBudgetExceededError(budgetUnits, remaining);
    if (this.active >= this.maxConcurrent) throw new ApplicationConcurrencyLimitError();
    if (this.starts.length >= this.rateLimit.maxStarts) {
      const retryAfter = Math.max(0, this.starts[0]! + this.rateLimit.intervalMs - now.getTime());
      throw new ApplicationRateLimitError(retryAfter);
    }

    this.usedBudgetUnits += budgetUnits;
    this.active++;
    this.starts.push(now.getTime());
    const taskController = new AbortController();
    const unlink = this.linkCancellation(taskController);
    const cancelDeadline = this.scheduleDeadline(taskController);
    const taskPromise = Promise.resolve().then(() => {
      taskController.signal.throwIfAborted();
      return task(Object.freeze({ signal: taskController.signal }));
    });
    const settledTask = taskPromise.finally(() => {
      cancelDeadline();
      unlink();
      this.active--;
    });
    return Promise.race([settledTask, abortPromise(taskController.signal)]);
  }

  /**
   * Handles cancel according to the ApplicationExecutionController contract.
   */
  cancel(reason: unknown = new DOMException('Application execution cancelled', 'AbortError')): void {
    this.controller.abort(reason);
  }

  /**
   * Returns an immutable snapshot of the current state.
   */
  snapshot(): ApplicationExecutionControlSnapshot {
    const now = validNow(this.now());
    this.pruneStarts(now.getTime());
    return Object.freeze({
      max_budget_units: this.maxBudgetUnits,
      used_budget_units: this.usedBudgetUnits,
      remaining_budget_units: this.maxBudgetUnits - this.usedBudgetUnits,
      max_concurrent: this.maxConcurrent,
      active: this.active,
      rate_limit_max_starts: this.rateLimit.maxStarts,
      rate_limit_interval_ms: this.rateLimit.intervalMs,
      starts_in_window: this.starts.length,
      deadline_at: this.deadlineAt.toISOString(),
      cancelled: this.controller.signal.aborted || Boolean(this.externalSignal?.aborted),
    });
  }

  /**
   * Links cancellation according to the ApplicationExecutionController contract.
   */
  private linkCancellation(target: AbortController): () => void {
    const sources = [this.controller.signal, this.externalSignal]
      .filter((signal): signal is AbortSignal => signal !== undefined);
    const abort = (signal: AbortSignal): void => target.abort(signal.reason);
    const listeners: Array<{ readonly signal: AbortSignal; readonly listener: () => void }> = [];
    for (const signal of sources) {
      if (signal.aborted) {
        abort(signal);
        break;
      }
      const listener = (): void => abort(signal);
      listeners.push({ signal, listener });
      signal.addEventListener('abort', listener, { once: true });
    }
    return () => {
      for (const { signal, listener } of listeners) signal.removeEventListener('abort', listener);
    };
  }

  /**
   * Throws when if cancelled according to the ApplicationExecutionController contract.
   */
  private throwIfCancelled(): void {
    this.externalSignal?.throwIfAborted();
    this.controller.signal.throwIfAborted();
  }

  /**
   * Throws when if deadline according to the ApplicationExecutionController contract.
   */
  private throwIfDeadline(now: Date): void {
    if (now.getTime() >= this.deadlineAt.getTime()) {
      throw new ApplicationDeadlineExceededError(this.deadlineAt.toISOString());
    }
  }

  /**
   * Schedules deadline according to the ApplicationExecutionController contract.
   */
  private scheduleDeadline(target: AbortController): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const schedule = (): void => {
      if (cancelled || target.signal.aborted) return;
      const remaining = this.deadlineAt.getTime() - validNow(this.now()).getTime();
      if (remaining <= 0) {
        target.abort(new ApplicationDeadlineExceededError(this.deadlineAt.toISOString()));
        return;
      }
      timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }

  /**
   * Prunes starts according to the ApplicationExecutionController contract.
   */
  private pruneStarts(now: number): void {
    const boundary = now - this.rateLimit.intervalMs;
    this.starts = this.starts.filter(started => started > boundary);
  }
}

function abortPromise(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

function validateRateLimit(value: ApplicationRateLimit): Readonly<ApplicationRateLimit> {
  if (!value || typeof value !== 'object') {
    throw new ApplicationControlContractError('rateLimit must be an object');
  }
  return Object.freeze({
    maxStarts: positiveInteger(value.maxStarts, 'rateLimit.maxStarts'),
    intervalMs: positiveInteger(value.intervalMs, 'rateLimit.intervalMs'),
  });
}

function canonicalDeadline(value: Date | string): Date {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApplicationControlContractError('deadlineAt must be a valid Date or timestamp');
  }
  return parsed;
}

function validNow(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ApplicationControlContractError('now() must return a valid Date');
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ApplicationControlContractError(`${label} must be a positive safe integer`);
  }
  return value;
}

function positiveNumber(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ApplicationControlContractError(`${label} must be a positive finite number`);
  }
  return value;
}

function nonBlank(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApplicationControlContractError(`${label} must be non-blank`);
  }
  return value;
}

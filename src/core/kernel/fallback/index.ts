/**
 * Coordinates fallback responsibilities inside the PixieCore kernel.
 */

import type {
  FallbackQualityEvidence,
  ProviderFallbackAttempt,
  ProviderFallbackExecutionContext,
  ProviderFallbackExecutionOptions,
  ProviderFallbackExecutionResult,
  ProviderFallbackPolicy,
  ProviderFallbackReceipt,
  ProviderFallbackTarget,
} from '../../contracts/fallback/index.js';
import { PixieCoreError } from '../../contracts/errors/index.js';

export type {
  FallbackQualityEvidence,
  ProviderFallbackAttempt,
  ProviderFallbackExecutionContext,
  ProviderFallbackExecutionOptions,
  ProviderFallbackExecutionResult,
  ProviderFallbackPolicy,
  ProviderFallbackReceipt,
  ProviderFallbackTarget,
} from '../../contracts/fallback/index.js';

export const PROVIDER_FALLBACK_RECEIPT_SCHEMA =
  'pixiecore.provider-fallback-receipt/v1' as const;

/**
 * Reports provider fallback contract failures.
 */
export class ProviderFallbackContractError extends PixieCoreError {
  /**
   * Creates a ProviderFallbackContractError with the supplied failure context.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'provider_fallback_contract_error', options);
  }
}

/**
 * Reports provider fallback exhausted failures.
 */
export class ProviderFallbackExhaustedError extends PixieCoreError {
  /**
   * Creates a ProviderFallbackExhaustedError with the supplied failure context.
   */
  constructor(readonly receipt: ProviderFallbackReceipt, options?: ErrorOptions) {
    super('Every eligible provider fallback target failed', 'provider_fallback_exhausted', options);
  }
}

/**
 * Executes with provider fallback through its public boundary.
 */
export async function executeWithProviderFallback<Value>(
  options: ProviderFallbackExecutionOptions,
  execute: (context: ProviderFallbackExecutionContext) => Value | Promise<Value>,
): Promise<ProviderFallbackExecutionResult<Value>> {
  const { targets, policy } = validateOptions(options);
  if (typeof execute !== 'function') {
    throw new ProviderFallbackContractError('execute must be a function');
  }
  const attempts: ProviderFallbackAttempt[] = [];
  let lastFailure: unknown;

  for (let index = 0; index < targets.length; index++) {
    options.signal?.throwIfAborted();
    const target = targets[index]!;
    try {
      const value = await execute(Object.freeze({
        target,
        attempt: index + 1,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }));
      attempts.push(freezeAttempt(target, 'succeeded'));
      const receipt = createReceipt(policy, targets[0]!, target, attempts);
      return Object.freeze({ value, receipt });
    } catch (error) {
      if (options.signal?.aborted || isAbortFailure(error)) throw error;
      const code = errorCode(error);
      attempts.push(freezeAttempt(target, 'failed', code));
      lastFailure = error;
      if (!policy.fallback_error_codes.includes(code)) throw error;
    }
  }

  throw new ProviderFallbackExhaustedError(
    createReceipt(policy, targets[0]!, null, attempts),
    lastFailure === undefined ? undefined : { cause: lastFailure },
  );
}

function validateOptions(options: ProviderFallbackExecutionOptions): {
  readonly targets: readonly Readonly<ProviderFallbackTarget>[];
  readonly policy: Readonly<ProviderFallbackPolicy>;
} {
  if (!options || typeof options !== 'object') {
    throw new ProviderFallbackContractError('options must be an object');
  }
  if (!Array.isArray(options.targets) || options.targets.length === 0) {
    throw new ProviderFallbackContractError('targets must contain at least one target');
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    throw new ProviderFallbackContractError('signal must be an AbortSignal');
  }
  const policy = validatePolicy(options.policy);
  const ids = new Set<string>();
  const targets = options.targets.map((target, index) => {
    const validated = validateTarget(target, index);
    if (ids.has(validated.id)) throw new ProviderFallbackContractError(`Duplicate target id: ${validated.id}`);
    ids.add(validated.id);
    return validated;
  });
  const primaryScore = targets[0]!.quality.score;
  for (const target of targets) {
    if (target.quality.score < policy.minimum_quality_score) {
      throw new ProviderFallbackContractError(`Target ${target.id} is below minimum_quality_score`);
    }
    const drop = roundedDrop(primaryScore, target.quality.score);
    if (drop > policy.maximum_quality_drop) {
      throw new ProviderFallbackContractError(`Target ${target.id} exceeds maximum_quality_drop`);
    }
  }
  return Object.freeze({ targets: Object.freeze(targets), policy });
}

function validatePolicy(policy: ProviderFallbackPolicy): Readonly<ProviderFallbackPolicy> {
  if (!policy || typeof policy !== 'object') {
    throw new ProviderFallbackContractError('policy must be an object');
  }
  if (!Array.isArray(policy.fallback_error_codes) || policy.fallback_error_codes.length === 0) {
    throw new ProviderFallbackContractError('fallback_error_codes must not be empty');
  }
  const codes = policy.fallback_error_codes.map((code, index) => (
    nonBlank(code, `fallback_error_codes[${index}]`)
  ));
  if (new Set(codes).size !== codes.length) {
    throw new ProviderFallbackContractError('fallback_error_codes must not contain duplicates');
  }
  return Object.freeze({
    policy_id: nonBlank(policy.policy_id, 'policy_id'),
    policy_version: nonBlank(policy.policy_version, 'policy_version'),
    fallback_error_codes: Object.freeze([...codes].sort()),
    minimum_quality_score: score(policy.minimum_quality_score, 'minimum_quality_score'),
    maximum_quality_drop: score(policy.maximum_quality_drop, 'maximum_quality_drop'),
  });
}

function validateTarget(target: ProviderFallbackTarget, index: number): Readonly<ProviderFallbackTarget> {
  if (!target || typeof target !== 'object') {
    throw new ProviderFallbackContractError(`targets[${index}] must be an object`);
  }
  const quality = target.quality;
  if (!quality || typeof quality !== 'object') {
    throw new ProviderFallbackContractError(`targets[${index}].quality must be an object`);
  }
  return Object.freeze({
    id: nonBlank(target.id, `targets[${index}].id`),
    provider: nonBlank(target.provider, `targets[${index}].provider`),
    model: nonBlank(target.model, `targets[${index}].model`),
    quality: Object.freeze({
      score: score(quality.score, `targets[${index}].quality.score`),
      dataset_id: nonBlank(quality.dataset_id, `targets[${index}].quality.dataset_id`),
      dataset_version: nonBlank(quality.dataset_version, `targets[${index}].quality.dataset_version`),
      measured_at: timestamp(quality.measured_at, `targets[${index}].quality.measured_at`),
    }),
  });
}

function createReceipt(
  policy: Readonly<ProviderFallbackPolicy>,
  primary: Readonly<ProviderFallbackTarget>,
  selected: Readonly<ProviderFallbackTarget> | null,
  attempts: readonly ProviderFallbackAttempt[],
): ProviderFallbackReceipt {
  return Object.freeze({
    schema: PROVIDER_FALLBACK_RECEIPT_SCHEMA,
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    fallback_used: attempts.length > 1,
    selected_target_id: selected?.id ?? null,
    quality_drop: selected === null ? null : roundedDrop(primary.quality.score, selected.quality.score),
    attempts: Object.freeze([...attempts]),
  });
}

function freezeAttempt(
  target: Readonly<ProviderFallbackTarget>,
  result: 'succeeded' | 'failed',
  code?: string,
): ProviderFallbackAttempt {
  return Object.freeze({
    target_id: target.id,
    provider: target.provider,
    model: target.model,
    quality_score: target.quality.score,
    dataset_id: target.quality.dataset_id,
    dataset_version: target.quality.dataset_version,
    result,
    ...(code === undefined ? {} : { error_code: code }),
  });
}

function errorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === 'string' && error.code.trim()) return error.code;
  if (error instanceof Error && error.name.trim()) return error.name;
  return 'unknown_error';
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

function roundedDrop(primary: number, selected: number): number {
  return Math.max(0, Math.round((primary - selected) * 1_000_000) / 1_000_000);
}

function score(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ProviderFallbackContractError(`${label} must be between 0 and 1`);
  }
  return value;
}

function timestamp(value: string, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new ProviderFallbackContractError(`${label} must be a canonical UTC timestamp`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new ProviderFallbackContractError(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function nonBlank(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProviderFallbackContractError(`${label} must be non-blank`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

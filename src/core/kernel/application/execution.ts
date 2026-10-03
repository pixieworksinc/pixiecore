/**
 * Executes bounded application nodes and creates partial-result artifacts.
 */

import { cloneFrozenJsonObject } from '../../component/json-artifact/index.js';
import type {
  ApplicationFailureMode,
  ApplicationFailureRecord,
  ApplicationNodeExecutionContext,
  ApplicationNodeExecutionOptions,
  ApplicationNodeOutcome,
  ApplicationPartialResult,
  ApplicationRetryOwner,
  CreateApplicationPartialResultInput,
} from '../../contracts/application/index.js';
import { ApplicationContractError } from './errors.js';

export const APPLICATION_PARTIAL_RESULT_SCHEMA =
  'pixiecore.application-partial-result/v1' as const;

const FAILURE_MODES = new Set<ApplicationFailureMode>(['fail-fast', 'recoverable']);
const RETRY_OWNERS = new Set<ApplicationRetryOwner>(['runtime', 'application', 'host']);

/** Executes one application node under explicit failure and retry ownership. */
export async function executeApplicationNode<Value>(
  options: ApplicationNodeExecutionOptions,
  task: (context: ApplicationNodeExecutionContext) => Promise<Value>,
): Promise<ApplicationNodeOutcome<Value>> {
  const maxAttempts = validateExecutionOptions(options);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    options.signal?.throwIfAborted();
    try {
      const value = await task(Object.freeze({
        attempt,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }));
      return Object.freeze({ status: 'succeeded', value, attempts: attempt });
    } catch (error) {
      if (options.signal?.aborted || isAbortFailure(error)) throw error;
      const retry = attempt < maxAttempts
        && options.shouldRetry !== undefined
        && await options.shouldRetry(error, attempt);
      if (retry) continue;
      if (options.policy.failureMode === 'fail-fast') throw error;
      return Object.freeze({
        status: 'failed',
        error,
        failure: freezeFailureRecord({
          node_id: options.node.id,
          blueprint_version: options.node.blueprintVersion,
          error_code: errorCode(error),
          attempts: attempt,
          retry_owner: options.policy.retryOwner,
        }),
      });
    }
  }

  throw new ApplicationContractError('Application node execution exhausted invalid attempt state');
}

/** Creates an immutable partial-result artifact after validating failures. */
export function createApplicationPartialResult(
  input: CreateApplicationPartialResultInput,
): ApplicationPartialResult {
  const outputs = cloneFrozenJsonObject(
    input.outputs,
    'outputs',
    message => new ApplicationContractError(message),
  );
  const failures = (input.failures ?? []).map((failure, index) => (
    validateFailureRecord(failure, index)
  ));
  return Object.freeze({
    schema: APPLICATION_PARTIAL_RESULT_SCHEMA,
    result: failures.length === 0 ? 'succeeded' : 'partial',
    outputs,
    failures: Object.freeze(failures),
  });
}

function validateExecutionOptions(options: ApplicationNodeExecutionOptions): number {
  if (!FAILURE_MODES.has(options.policy.failureMode)) {
    throw new ApplicationContractError('failureMode must be fail-fast or recoverable');
  }
  if (!RETRY_OWNERS.has(options.policy.retryOwner)) {
    throw new ApplicationContractError('retryOwner must be runtime, application, or host');
  }
  if (!options.node.id.trim() || !options.node.blueprintVersion.trim()) {
    throw new ApplicationContractError('node id and Blueprint version must be non-blank');
  }
  if (options.policy.retryOwner !== 'application') {
    if (options.policy.maxAttempts !== undefined || options.shouldRetry !== undefined) {
      throw new ApplicationContractError(
        'maxAttempts and shouldRetry belong only to application-owned retries',
      );
    }
    return 1;
  }
  const maxAttempts = options.policy.maxAttempts ?? 1;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new ApplicationContractError('maxAttempts must be a positive safe integer');
  }
  if (maxAttempts > 1 && options.shouldRetry === undefined) {
    throw new ApplicationContractError(
      'application-owned retries above one attempt require shouldRetry',
    );
  }
  return maxAttempts;
}

function validateFailureRecord(
  failure: ApplicationFailureRecord,
  index: number,
): ApplicationFailureRecord {
  if (
    !failure.node_id.trim()
    || !failure.blueprint_version.trim()
    || !failure.error_code.trim()
  ) {
    throw new ApplicationContractError(`failures[${index}] identifiers must be non-blank`);
  }
  if (!Number.isSafeInteger(failure.attempts) || failure.attempts < 1) {
    throw new ApplicationContractError(`failures[${index}].attempts must be a positive integer`);
  }
  if (!RETRY_OWNERS.has(failure.retry_owner)) {
    throw new ApplicationContractError(`failures[${index}].retry_owner is invalid`);
  }
  return freezeFailureRecord(failure);
}

function freezeFailureRecord(failure: ApplicationFailureRecord): ApplicationFailureRecord {
  return Object.freeze({ ...failure });
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

function errorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === 'string' && error.code.trim()) return error.code;
  if (error instanceof Error && error.name.trim()) return error.name;
  return 'unknown_error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

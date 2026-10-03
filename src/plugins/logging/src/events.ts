/**
 * Implements events behavior for the logging plugin.
 */

import { getLogger, type PixieCoreLogger } from './logger.js';
import { clonePayload, sanitizePayload, truncatePayload } from './sanitize.js';

/**
 * Records the start of one Blueprint execution using the stable audit vocabulary.
 */
export function logExecutionStart(
  blueprint: string,
  inputs: unknown,
  logger: PixieCoreLogger = getLogger(),
): void {
  logger.audit('Execution started', {
    step: 'execution_start',
    event: 'started',
    blueprint,
    inputs: loggedPayload(inputs, logger),
  });
}

/**
 * Records LLM request for the owning PixieCore boundary.
 */
export function logLlmRequest(
  provider: string,
  model: string,
  request: unknown,
  logger: PixieCoreLogger = getLogger(),
): void {
  logger.audit('LLM request', {
    step: 'llm_call',
    event: 'request',
    provider,
    model,
    request: loggedPayload(request, logger),
  });
}

/**
 * Records LLM response for the owning PixieCore boundary.
 */
export function logLlmResponse(
  provider: string,
  model: string,
  response: unknown,
  durationMs: number,
  logger: PixieCoreLogger = getLogger(),
): void {
  const usage = generationUsage(response);
  logger.audit('LLM response', {
    step: 'llm_call',
    event: 'response',
    provider,
    model,
    duration_ms: durationMs,
    ...(usage === undefined ? {} : { usage }),
    response: loggedPayload(response, logger),
  });
}

function generationUsage(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = (value as Record<string, unknown>).usage;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const usage = raw as Record<string, unknown>;
  const fields = [
    ['input_tokens', usage.inputTokens],
    ['output_tokens', usage.outputTokens],
    ['total_tokens', usage.totalTokens],
  ] as const;
  const normalized: Record<string, number> = {};
  for (const [name, amount] of fields) {
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) continue;
    normalized[name] = amount;
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

/**
 * Records validation result for the owning PixieCore boundary.
 */
export function logValidationResult(
  kind: string,
  passed: boolean,
  error?: string,
  logger: PixieCoreLogger = getLogger(),
): void {
  logger.audit('Validation result', {
    step: 'validation',
    event: passed ? 'passed' : 'failed',
    validation: kind,
    ...(error ? { error } : {}),
  }, passed ? 'INFO' : 'ERROR');
}

/**
 * Records tool execution for the owning PixieCore boundary.
 */
export function logToolExecution(
  tool: string,
  args: unknown,
  result: unknown,
  durationMs: number,
  error?: string | null,
  logger: PixieCoreLogger = getLogger(),
): void {
  logger.audit('Tool execution', {
    step: 'tool_execution',
    event: error ? 'failed' : 'completed',
    tool,
    duration_ms: durationMs,
    args: loggedPayload(args, logger),
    ...(error ? { error } : { result: loggedPayload(result, logger) }),
  }, error ? 'ERROR' : 'INFO');
}

/**
 * Records execution complete for the owning PixieCore boundary.
 */
export function logExecutionComplete(
  status: string,
  output: unknown,
  durationMs: number,
  errorCount = 0,
  logger: PixieCoreLogger = getLogger(),
): void {
  logger.audit('Execution completed', {
    step: 'execution_complete',
    event: status,
    duration_ms: durationMs,
    error_count: errorCount,
    output: loggedPayload(output, logger),
  }, status === 'success' ? 'INFO' : 'ERROR');
}

/**
 * Records execution retry for the owning PixieCore boundary.
 */
export function logExecutionRetry(
  owner: 'runtime' | 'application' | 'host',
  reason: string,
  attempt: number,
  logger: PixieCoreLogger = getLogger(),
): void {
  logger.audit('Execution retry scheduled', {
    step: 'execution_retry',
    event: 'scheduled',
    retry_owner: owner,
    reason,
    attempt,
  }, 'WARNING');
}

function loggedPayload(value: unknown, logger: PixieCoreLogger): unknown {
  if (!logger.config.logFullPayloads) {
    return { _logged: false, _summary: summarize(value) };
  }
  const sanitized = logger.config.sanitizeCredentials
    ? sanitizePayload(value, {
      sensitiveFields: logger.config.sensitiveFields,
      customValuePatterns: logger.config.customValuePatterns,
    })
    : clonePayload(value);
  return truncatePayload(sanitized, logger.config.maxPayloadSize);
}

function summarize(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value && typeof value === 'object') return `object(${Object.keys(value).length})`;
  return typeof value;
}

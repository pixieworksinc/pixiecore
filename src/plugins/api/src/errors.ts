/**
 * Implements errors behavior for the api plugin.
 */

import { PixieCoreError } from '../../../core/contracts/errors/index.js';
import type { LoggerPort } from '../../../core/contracts/logging/index.js';

const STATUS_BY_ERROR_CODE: Readonly<Record<string, number>> = {
  blueprint_validation_error: 400,
  input_validation_error: 422,
  input_type_error: 422,
  schema_validation_error: 502,
  llm_api_error: 502,
  max_retry_exceeded: 504,
  role_permission_error: 403,
  user_permission_error: 403,
  scope_permission_error: 403,
};

/**
 * Reports api failures.
 */
export class ApiError extends Error {
  /**
   * Creates a ApiError with the supplied failure context.
   */
  constructor(readonly type: string, message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Maps api error for the owning PixieCore boundary.
 */
export function mapApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (!(error instanceof PixieCoreError)) {
    return new ApiError('internal_error', 'An internal error occurred', 500);
  }
  const status = STATUS_BY_ERROR_CODE[error.code] ?? 500;
  const message = status === 500 ? 'An internal error occurred' : error.message;
  return new ApiError(error.code, message, status);
}

/**
 * Records api error for the owning PixieCore boundary.
 */
export function logApiError(logger: LoggerPort, mapped: ApiError, error: unknown): void {
  ignoreApiLoggerFailure(() => {
    if (mapped.status === 500) {
      logger.error('Unexpected API error', { error });
      return;
    }
    logger.warning('API request rejected', {
      type: mapped.type,
      status: mapped.status,
      message: mapped.message,
    });
  });
}

/** Logging is observational and cannot change an API response contract. */
export function ignoreApiLoggerFailure(write: () => void): void {
  try {
    write();
  } catch {
    // The request and cleanup paths remain authoritative when a logger fails.
  }
}

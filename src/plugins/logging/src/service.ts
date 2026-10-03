/**
 * Implements service behavior for the logging plugin.
 */

import type {
  LoggerPort,
  LoggingServicePort,
  LoggingOptions,
} from '../../../core/contracts/logging/index.js';
import { LoggingConfig } from './config.js';
import {
  logExecutionComplete,
  logExecutionRetry,
  logExecutionStart,
  logLlmRequest,
  logLlmResponse,
  logToolExecution,
  logValidationResult,
} from './events.js';
import { PixieCoreLogger, adaptLoggerPort } from './logger.js';
import { sanitizeLogMessage } from './sanitize.js';
import { generateTraceId, getTraceId, runWithTraceId } from './trace.js';

/** Creates one immutable capability set without constructing operational resources. */
export function createLoggingService(): LoggingServicePort {
  const service: LoggingServicePort = {
    /**
     * Creates logger according to the containing class contract.
     */
    createLogger(options: LoggingOptions = {}, name = 'pixiecore'): LoggerPort {
      return new PixieCoreLogger(new LoggingConfig(options).validate(), name);
    },
    /**
     * Implements the adapt logger operation for the enclosing service contract.
     */
    adaptLogger(logger, name): LoggerPort {
      return adaptLoggerPort(logger, name);
    },
    sanitizeLogMessage,
    generateTraceId,
    getTraceId,
    runWithTraceId,
    /**
     * Implements the log execution start operation for the enclosing service contract.
     */
    logExecutionStart(blueprint, inputs, logger): void {
      logExecutionStart(blueprint, inputs, adaptLoggerPort(logger));
    },
    /**
     * Implements the log llm request operation for the enclosing service contract.
     */
    logLlmRequest(provider, model, request, logger): void {
      logLlmRequest(provider, model, request, adaptLoggerPort(logger));
    },
    /**
     * Implements the log llm response operation for the enclosing service contract.
     */
    logLlmResponse(provider, model, response, durationMs, logger): void {
      logLlmResponse(
        provider,
        model,
        response,
        durationMs,
        adaptLoggerPort(logger),
      );
    },
    /**
     * Implements the log validation result operation for the enclosing service contract.
     */
    logValidationResult(kind, passed, error, logger): void {
      logValidationResult(kind, passed, error, adaptLoggerPort(logger));
    },
    /**
     * Implements the log tool execution operation for the enclosing service contract.
     */
    logToolExecution(tool, args, result, durationMs, error, logger): void {
      logToolExecution(
        tool,
        args,
        result,
        durationMs,
        error,
        adaptLoggerPort(logger),
      );
    },
    /**
     * Implements the log execution complete operation for the enclosing service contract.
     */
    logExecutionComplete(status, output, durationMs, errorCount, logger): void {
      logExecutionComplete(
        status,
        output,
        durationMs,
        errorCount,
        adaptLoggerPort(logger),
      );
    },
    /**
     * Implements the log execution retry operation for the enclosing service contract.
     */
    logExecutionRetry(owner, reason, attempt, logger): void {
      logExecutionRetry(owner, reason, attempt, adaptLoggerPort(logger));
    },
  };
  return Object.freeze(service);
}

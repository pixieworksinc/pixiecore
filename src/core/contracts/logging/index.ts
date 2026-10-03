/**
 * Defines logging contracts shared across PixieCore boundaries.
 */

/**
 * Defines the supported log level values.
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

/**
 * Configures logging behavior.
 */
export interface LoggingOptions {
  logLevel?: LogLevel;
  logToFile?: boolean;
  logDir?: string;
  logFile?: string;
  logMaxBytes?: number;
  logBackupCount?: number;
  auditFile?: string;
  auditMaxBytes?: number;
  auditBackupCount?: number;
  sanitizeCredentials?: boolean;
  sensitiveFields?: readonly string[];
  customValuePatterns?: readonly string[];
  logFullPayloads?: boolean;
  maxPayloadSize?: number;
  /** TypeScript-only control useful for embedding and tests. */
  logToConsole?: boolean;
}

/**
 * Configures sanitization behavior.
 */
export interface SanitizationOptions {
  sensitiveFields?: readonly string[];
  customValuePatterns?: readonly (string | RegExp)[];
}

/**
 * Describes the truncated payload contract.
 */
export interface TruncatedPayload {
  _truncated: true;
  _original_size: number;
  _content: string;
}

/**
 * Records log evidence.
 */
export interface LogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly name: string;
  readonly message: string;
  readonly trace_id: string;
  readonly kind: 'log' | 'audit';
  readonly [key: string]: unknown;
}

/** Implementation-independent logger contract accepted at runtime boundaries. */
export interface LoggerPort {
  readonly config: LoggingOptions;
  readonly name: string;
  /**
   * Writes a debug-level log record.
   */
  debug(message: string, fields?: Record<string, unknown>): void;
  /**
   * Writes an informational log record.
   */
  info(message: string, fields?: Record<string, unknown>): void;
  /**
   * Writes a warning-level log record.
   */
  warning(message: string, fields?: Record<string, unknown>): void;
  /**
   * Writes an error-level log record.
   */
  error(message: string, fields?: Record<string, unknown>): void;
  /**
   * Writes a critical log record.
   */
  critical(message: string, fields?: Record<string, unknown>): void;
  /**
   * Writes a structured audit record.
   */
  audit(message: string, fields: Record<string, unknown>, level?: LogLevel): void;
  /**
   * Registers a log subscriber and returns its unsubscribe callback.
   */
  subscribe(listener: (record: LogRecord) => void): () => void;
  /**
   * Creates a child logger with inherited configuration and additional context.
   */
  child(name: string): LoggerPort;
  /**
   * Releases resources owned by the implementation.
   */
  close(): void | Promise<void>;
}

/** Scope-local logging capabilities supplied by the logging core plugin. */
export interface LoggingServicePort {
  /**
   * Creates logger after validating the supplied contract.
   */
  createLogger(options?: LoggingOptions, name?: string): LoggerPort;
  /**
   * Adapts logger for the owning PixieCore boundary.
   */
  adaptLogger(logger: LoggerPort, name?: string): LoggerPort;
  /**
   * Normalizes log message while preserving caller-owned input.
   */
  sanitizeLogMessage(message: string, options?: SanitizationOptions): string;
  /**
   * Creates trace id after validating the supplied contract.
   */
  generateTraceId(): string;
  /**
   * Returns trace id without exposing mutable internal state.
   */
  getTraceId(): string;
  /**
   * Executes with trace id through its public boundary.
   */
  runWithTraceId<Value>(traceId: string, task: () => Value): Value;
  /**
   * Records execution start for the owning PixieCore boundary.
   */
  logExecutionStart(
    blueprint: string,
    inputs: unknown,
    logger: LoggerPort,
  ): void;
  /**
   * Records LLM request for the owning PixieCore boundary.
   */
  logLlmRequest(
    provider: string,
    model: string,
    request: unknown,
    logger: LoggerPort,
  ): void;
  /**
   * Records LLM response for the owning PixieCore boundary.
   */
  logLlmResponse(
    provider: string,
    model: string,
    response: unknown,
    durationMs: number,
    logger: LoggerPort,
  ): void;
  /**
   * Records validation result for the owning PixieCore boundary.
   */
  logValidationResult(
    kind: string,
    passed: boolean,
    error: string | undefined,
    logger: LoggerPort,
  ): void;
  /**
   * Records tool execution for the owning PixieCore boundary.
   */
  logToolExecution(
    tool: string,
    args: unknown,
    result: unknown,
    durationMs: number,
    error: string | null | undefined,
    logger: LoggerPort,
  ): void;
  /**
   * Records execution complete for the owning PixieCore boundary.
   */
  logExecutionComplete(
    status: string,
    output: unknown,
    durationMs: number,
    errorCount: number,
    logger: LoggerPort,
  ): void;
  /**
   * Records execution retry for the owning PixieCore boundary.
   */
  logExecutionRetry(
    owner: 'runtime' | 'application' | 'host',
    reason: string,
    attempt: number,
    logger: LoggerPort,
  ): void;
}

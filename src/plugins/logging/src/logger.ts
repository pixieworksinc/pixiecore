/**
 * Implements logger behavior for the logging plugin.
 */

import { LoggingConfig, LOG_LEVEL_WEIGHT } from './config.js';
import { appendRotating, touchLogFile, writeConsole } from './persistence.js';
import {
  asRecord,
  safeSerialize,
  sanitizeLoggerFields,
  sanitizeLoggerMessage,
} from './sanitize.js';
import { getTraceId } from './trace.js';
import type { LoggerPort } from '../../../core/contracts/logging/index.js';
import type { LogLevel, LoggingOptions, LogRecord } from './types.js';

interface LoggerState {
  readonly listeners: Set<(record: LogRecord) => void>;
}

const persistenceDisabledStates = new WeakSet<LoggerState>();

/**
 * Emits sanitized structured records to configured console, rotating-file,
 * audit, and subscriber destinations while preserving trace context.
 */
export class PixieCoreLogger {
  private readonly state: LoggerState;

  /** Initializes logger configuration, persistence destinations, and shared listeners. */
  constructor(
    readonly config = new LoggingConfig().validate(),
    readonly name = 'pixiecore',
    state?: LoggerState,
    private readonly delegate?: LoggerPort,
  ) {
    this.state = state ?? { listeners: new Set() };
    if (config.logToFile && !persistenceDisabledStates.has(this.state)) {
      touchLogFile(config.logPath);
      touchLogFile(config.auditPath);
    }
  }

  /**
   * Creates a child logger with inherited configuration and additional context.
   */
  child(name: string): PixieCoreLogger {
    if (this.delegate) return adaptLoggerPort(this.delegate.child(name), name);
    return new PixieCoreLogger(this.config, name, this.state);
  }

  /**
   * Writes a debug-level log record.
   */
  debug(message: string, fields: Record<string, unknown> = {}): void {
    if (this.delegate) return this.delegate.debug(message, fields);
    this.write('DEBUG', message, fields);
  }

  /**
   * Writes an informational log record.
   */
  info(message: string, fields: Record<string, unknown> = {}): void {
    if (this.delegate) return this.delegate.info(message, fields);
    this.write('INFO', message, fields);
  }

  /**
   * Writes a warning-level log record.
   */
  warning(message: string, fields: Record<string, unknown> = {}): void {
    if (this.delegate) return this.delegate.warning(message, fields);
    this.write('WARNING', message, fields);
  }

  /**
   * Writes an error-level log record.
   */
  error(message: string, fields: Record<string, unknown> = {}): void {
    if (this.delegate) return this.delegate.error(message, fields);
    this.write('ERROR', message, fields);
  }

  /**
   * Writes a critical log record.
   */
  critical(message: string, fields: Record<string, unknown> = {}): void {
    if (this.delegate) return this.delegate.critical(message, fields);
    this.write('CRITICAL', message, fields);
  }

  /**
   * Writes a structured audit record.
   */
  audit(message: string, fields: Record<string, unknown>, level: LogLevel = 'INFO'): void {
    if (this.delegate) return this.delegate.audit(message, fields, level);
    if (!this.enabled(level)) return;
    const safeFields = sanitizeLoggerFields(fields, this.config);
    const record: LogRecord = {
      ...asRecord(safeFields),
      timestamp: new Date().toISOString(),
      level,
      name: this.name.endsWith('.audit') ? this.name : `${this.name}.audit`,
      message: sanitizeLoggerMessage(message, this.config),
      trace_id: getTraceId(),
      kind: 'audit',
    };
    this.emit(record);
    if (this.config.logToFile) {
      appendRotating(
        this.config.auditPath,
        `${JSON.stringify(record)}\n`,
        this.config.auditMaxBytes,
        this.config.auditBackupCount,
      );
    }
  }

  /**
   * Registers a log subscriber and returns its unsubscribe callback.
   */
  subscribe(listener: (record: LogRecord) => void): () => void {
    if (this.delegate) return this.delegate.subscribe(listener);
    this.state.listeners.add(listener);
    return () => this.state.listeners.delete(listener);
  }

  /**
   * Releases resources owned by the PixieCoreLogger.
   */
  close(): void | Promise<void> {
    if (this.delegate) return this.delegate.close();
    // Synchronous file writes require no flush.
  }

  /**
   * Writes a sanitized record to the configured destination.
   */
  private write(level: LogLevel, message: string, fields: Record<string, unknown>): void {
    if (!this.enabled(level)) return;
    const safeFields = sanitizeLoggerFields(fields, this.config);
    const record: LogRecord = {
      ...asRecord(safeFields),
      timestamp: new Date().toISOString(),
      level,
      name: this.name,
      message: sanitizeLoggerMessage(message, this.config),
      trace_id: getTraceId(),
      kind: 'log',
    };
    this.emit(record);
    const suffix = Object.keys(fields).length ? ` ${safeSerialize(safeFields)}` : '';
    const line = `${record.timestamp} - ${record.name} - ${record.level} - ${record.message}${suffix} [trace_id=${record.trace_id}]`;
    if (this.config.logToConsole) writeConsole(level, line);
    if (this.config.logToFile) {
      appendRotating(
        this.config.logPath,
        `${line}\n`,
        this.config.logMaxBytes,
        this.config.logBackupCount,
      );
    }
  }

  /**
   * Reports whether the requested log level is enabled.
   */
  private enabled(level: LogLevel): boolean {
    return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[this.config.logLevel];
  }

  /**
   * Delivers a sanitized record to active subscribers.
   */
  private emit(record: LogRecord): void {
    for (const listener of this.state.listeners) listener(record);
  }
}

/** Preserve the concrete public logger API while accepting structural logger ports. */
export function adaptLoggerPort(logger: LoggerPort, name = logger.name): PixieCoreLogger {
  if (logger instanceof PixieCoreLogger && logger.name === name) return logger;
  return new PixieCoreLogger(
    normalizeLoggerPortConfig(logger.config),
    name,
    persistenceDisabledState(),
    logger,
  );
}

function persistenceDisabledState(): LoggerState {
  const state: LoggerState = { listeners: new Set() };
  persistenceDisabledStates.add(state);
  return state;
}

function normalizeLoggerPortConfig(options: LoggingOptions): LoggingConfig {
  const config = new LoggingConfig(options);
  new LoggingConfig({ ...options, logToFile: false }).validate();
  return config;
}

let defaultLogger = new PixieCoreLogger(
  new LoggingConfig({ logToConsole: false }).validate(),
);

/**
 * Replaces the process-default logger configuration.
 */
export function configureLogging(options: LoggingOptions | LoggingConfig = {}): LoggingConfig {
  const config = options instanceof LoggingConfig
    ? options.validate()
    : new LoggingConfig(options).validate();
  defaultLogger = new PixieCoreLogger(config);
  return config;
}

/**
 * Returns logger without exposing mutable internal state.
 */
export function getLogger(name = 'pixiecore'): PixieCoreLogger {
  return name === defaultLogger.name ? defaultLogger : defaultLogger.child(name);
}

/**
 * Captures log records until the returned scope is closed.
 */
export function captureLogs(logger: PixieCoreLogger = defaultLogger): {
  readonly records: LogRecord[];
  /**
   * Releases resources owned by the implementation.
   */
  close(): void;
  /**
   * Releases resources through the asynchronous disposal hook.
   */
  [Symbol.dispose](): void;
} {
  const records: LogRecord[] = [];
  const unsubscribe = logger.subscribe(record => records.push(record));
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    unsubscribe();
  };
  return { records, close, [Symbol.dispose]: close };
}

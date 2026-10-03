import type {
  LoggerPort,
  LoggingOptions,
  LogLevel,
  LogRecord,
} from '../../src/index.js';
import { setTimeout as delay } from 'node:timers/promises';

interface RecordingLoggerState {
  readonly records: LogRecord[];
  readonly listeners: Set<(record: LogRecord) => void>;
  readonly childNames: string[];
  readonly closedNames: string[];
}

/** A structural logger implementation that has no dependency on PixieCoreLogger. */
export class RecordingLoggerPort implements LoggerPort {
  readonly config: LoggingOptions;
  private readonly state: RecordingLoggerState;

  constructor(
    readonly name = 'independent',
    config: LoggingOptions = {
      logToConsole: false,
      logFullPayloads: true,
      sanitizeCredentials: false,
      maxPayloadSize: 100_000,
    },
    state?: RecordingLoggerState,
  ) {
    this.config = config;
    this.state = state ?? {
      records: [],
      listeners: new Set(),
      childNames: [],
      closedNames: [],
    };
  }

  get records(): readonly LogRecord[] { return this.state.records; }
  get childNames(): readonly string[] { return this.state.childNames; }
  get closedNames(): readonly string[] { return this.state.closedNames; }

  child(name: string): RecordingLoggerPort {
    this.state.childNames.push(name);
    return new RecordingLoggerPort(name, this.config, this.state);
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.write('log', 'DEBUG', message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.write('log', 'INFO', message, fields);
  }

  warning(message: string, fields?: Record<string, unknown>): void {
    this.write('log', 'WARNING', message, fields);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.write('log', 'ERROR', message, fields);
  }

  critical(message: string, fields?: Record<string, unknown>): void {
    this.write('log', 'CRITICAL', message, fields);
  }

  audit(
    message: string,
    fields: Record<string, unknown>,
    level: LogLevel = 'INFO',
  ): void {
    this.write('audit', level, message, fields);
  }

  subscribe(listener: (record: LogRecord) => void): () => void {
    this.state.listeners.add(listener);
    return () => this.state.listeners.delete(listener);
  }

  async close(): Promise<void> {
    await delay(5);
    this.state.closedNames.push(this.name);
  }

  private write(
    kind: LogRecord['kind'],
    level: LogLevel,
    message: string,
    fields: Record<string, unknown> = {},
  ): void {
    const record: LogRecord = {
      ...fields,
      timestamp: new Date().toISOString(),
      level,
      name: kind === 'audit' ? `${this.name}.audit` : this.name,
      message,
      trace_id: 'recording-trace',
      kind,
    };
    this.state.records.push(record);
    for (const listener of this.state.listeners) listener(record);
  }
}

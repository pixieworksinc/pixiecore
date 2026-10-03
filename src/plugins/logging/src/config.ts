/**
 * Implements config behavior for the logging plugin.
 */

import { isAbsolute, resolve } from 'node:path';
import { ConfigurationError } from '../../../core/contracts/errors/index.js';
import { ensureLogDirectories } from './persistence.js';
import { compilePatterns } from './sanitize.js';
import type { LogLevel, LoggingOptions } from './types.js';

export const LOG_LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
  CRITICAL: 50,
};

/**
 * Encapsulates logging config behavior and lifecycle.
 */
export class LoggingConfig {
  readonly logLevel: LogLevel;
  readonly logToFile: boolean;
  readonly logDir: string;
  readonly logFile: string;
  readonly logMaxBytes: number;
  readonly logBackupCount: number;
  readonly auditFile: string;
  readonly auditMaxBytes: number;
  readonly auditBackupCount: number;
  readonly sanitizeCredentials: boolean;
  readonly sensitiveFields: readonly string[];
  readonly customValuePatterns: readonly string[];
  readonly logFullPayloads: boolean;
  readonly maxPayloadSize: number;
  readonly logToConsole: boolean;

  /**
   * Creates a LoggingConfig and establishes its initial state.
   */
  constructor(options: LoggingOptions = {}) {
    this.logLevel = options.logLevel ?? 'INFO';
    this.logToFile = options.logToFile ?? false;
    this.logDir = options.logDir ?? './logs';
    this.logFile = options.logFile ?? 'pixiecore.log';
    this.logMaxBytes = options.logMaxBytes ?? 10 * 1024 * 1024;
    this.logBackupCount = options.logBackupCount ?? 5;
    this.auditFile = options.auditFile ?? 'pixiecore_audit.jsonl';
    this.auditMaxBytes = options.auditMaxBytes ?? 50 * 1024 * 1024;
    this.auditBackupCount = options.auditBackupCount ?? 10;
    this.sanitizeCredentials = options.sanitizeCredentials ?? true;
    this.sensitiveFields = uniqueStrings([...(options.sensitiveFields ?? [])]);
    this.customValuePatterns = [...(options.customValuePatterns ?? [])];
    this.logFullPayloads = options.logFullPayloads ?? false;
    this.maxPayloadSize = options.maxPayloadSize ?? 100 * 1024;
    this.logToConsole = options.logToConsole ?? true;
  }

  /**
   * Handles from environment according to the LoggingConfig contract.
   */
  static fromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
    overrides: LoggingOptions = {},
  ): LoggingConfig {
    const value = (primary: string, alias?: string): string | undefined =>
      environment[primary] ?? (alias ? environment[alias] : undefined);
    const levelValue = overrides.logLevel
      ?? normalizeLogLevel(value('PIXIECORE_LOG_LEVEL', 'PROMPT_RUNTIME_LOG_LEVEL'));
    return new LoggingConfig({
      ...(levelValue ? { logLevel: levelValue } : {}),
      logToFile: overrides.logToFile ?? parseBoolean(
        'PIXIECORE_LOG_TO_FILE',
        value('PIXIECORE_LOG_TO_FILE', 'PROMPT_RUNTIME_LOG_TO_FILE'),
        false,
      ),
      logDir: overrides.logDir
        ?? value('PIXIECORE_LOG_DIR', 'PROMPT_RUNTIME_LOG_DIR')
        ?? './logs',
      logFile: overrides.logFile
        ?? value('PIXIECORE_LOG_FILE', 'PROMPT_RUNTIME_LOG_FILE')
        ?? 'pixiecore.log',
      logMaxBytes: overrides.logMaxBytes ?? parseInteger(
        'PIXIECORE_LOG_MAX_BYTES',
        value('PIXIECORE_LOG_MAX_BYTES', 'PROMPT_RUNTIME_LOG_MAX_BYTES'),
        10 * 1024 * 1024,
        1,
      ),
      logBackupCount: overrides.logBackupCount ?? parseInteger(
        'PIXIECORE_LOG_BACKUP_COUNT',
        value('PIXIECORE_LOG_BACKUP_COUNT', 'PROMPT_RUNTIME_LOG_BACKUP_COUNT'),
        5,
        0,
      ),
      auditFile: overrides.auditFile
        ?? value('PIXIECORE_AUDIT_FILE', 'PROMPT_RUNTIME_AUDIT_FILE')
        ?? 'pixiecore_audit.jsonl',
      auditMaxBytes: overrides.auditMaxBytes ?? parseInteger(
        'PIXIECORE_AUDIT_MAX_BYTES',
        value('PIXIECORE_AUDIT_MAX_BYTES', 'PROMPT_RUNTIME_AUDIT_MAX_BYTES'),
        50 * 1024 * 1024,
        1,
      ),
      auditBackupCount: overrides.auditBackupCount ?? parseInteger(
        'PIXIECORE_AUDIT_BACKUP_COUNT',
        value('PIXIECORE_AUDIT_BACKUP_COUNT', 'PROMPT_RUNTIME_AUDIT_BACKUP_COUNT'),
        10,
        0,
      ),
      sanitizeCredentials: overrides.sanitizeCredentials ?? parseBoolean(
        'PIXIECORE_SANITIZE_CREDENTIALS',
        value('PIXIECORE_SANITIZE_CREDENTIALS', 'PROMPT_RUNTIME_SANITIZE_CREDENTIALS'),
        true,
      ),
      sensitiveFields: overrides.sensitiveFields
        ?? splitList(value('PIXIECORE_SENSITIVE_FIELDS', 'PROMPT_RUNTIME_SENSITIVE_FIELDS')),
      customValuePatterns: overrides.customValuePatterns
        ?? splitList(value('PIXIECORE_CUSTOM_VALUE_PATTERNS', 'PROMPT_RUNTIME_CUSTOM_VALUE_PATTERNS')),
      logFullPayloads: overrides.logFullPayloads ?? parseBoolean(
        'PIXIECORE_LOG_FULL_PAYLOADS',
        value('PIXIECORE_LOG_FULL_PAYLOADS', 'PROMPT_RUNTIME_LOG_FULL_PAYLOADS'),
        false,
      ),
      maxPayloadSize: overrides.maxPayloadSize ?? parseInteger(
        'PIXIECORE_MAX_PAYLOAD_SIZE',
        value('PIXIECORE_MAX_PAYLOAD_SIZE', 'PROMPT_RUNTIME_MAX_PAYLOAD_SIZE'),
        100 * 1024,
        1,
      ),
      logToConsole: overrides.logToConsole ?? true,
    }).validate();
  }

  /**
   * Validates the requested operation and rejects unsupported state.
   */
  validate(): this {
    if (!(this.logLevel in LOG_LEVEL_WEIGHT)) {
      throw new ConfigurationError(`Invalid log level: ${this.logLevel}`);
    }
    for (const [name, value, minimum] of numericSettings(this)) {
      if (!Number.isSafeInteger(value) || value < minimum) {
        throw new ConfigurationError(`${name} must be an integer of at least ${minimum}`);
      }
    }
    if (!this.logDir.trim()) throw new ConfigurationError('logDir must not be empty');
    if (!this.logFile.trim()) throw new ConfigurationError('logFile must not be empty');
    if (!this.auditFile.trim()) throw new ConfigurationError('auditFile must not be empty');
    compilePatterns(this.customValuePatterns);
    if (this.logToFile) ensureLogDirectories([this.logPath, this.auditPath]);
    return this;
  }

  /**
   * Returns path from the LoggingConfig state.
   */
  get logPath(): string {
    return resolveOutputPath(this.logDir, this.logFile);
  }

  /**
   * Returns audit path from the LoggingConfig state.
   */
  get auditPath(): string {
    return resolveOutputPath(this.logDir, this.auditFile);
  }
}

function numericSettings(config: LoggingConfig): ReadonlyArray<readonly [string, number, number]> {
  return [
    ['logMaxBytes', config.logMaxBytes, 1],
    ['logBackupCount', config.logBackupCount, 0],
    ['auditMaxBytes', config.auditMaxBytes, 1],
    ['auditBackupCount', config.auditBackupCount, 0],
    ['maxPayloadSize', config.maxPayloadSize, 1],
  ];
}

function resolveOutputPath(logDir: string, file: string): string {
  return isAbsolute(file) ? resolve(file) : resolve(logDir, file);
}

function normalizeLogLevel(value: string | undefined): LogLevel | undefined {
  if (value === undefined || !value.trim()) return undefined;
  const upper = value.trim().toUpperCase();
  const level = upper === 'WARN' ? 'WARNING' : upper;
  if (!(level in LOG_LEVEL_WEIGHT)) {
    throw new ConfigurationError(`Invalid log level: ${value}`);
  }
  return level as LogLevel;
}

function parseBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (/^(1|true|yes|on)$/i.test(value.trim())) return true;
  if (/^(0|false|no|off)$/i.test(value.trim())) return false;
  throw new ConfigurationError(`${name} must be a boolean`);
}

function parseInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new ConfigurationError(`${name} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new ConfigurationError(`${name} must be at least ${minimum}`);
  }
  return parsed;
}

function splitList(value: string | undefined): string[] {
  return value?.split(',').map(item => item.trim()).filter(Boolean) ?? [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

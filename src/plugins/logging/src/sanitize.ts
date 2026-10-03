/**
 * Implements sanitize behavior for the logging plugin.
 */

import { ConfigurationError } from '../../../core/contracts/errors/index.js';
import type { SanitizationOptions, TruncatedPayload } from './types.js';

const DEFAULT_SENSITIVE_FIELDS = [
  'api_key', 'apikey', 'authorization', 'x-api-key', 'token', 'access_token',
  'refresh_token', 'password', 'passwd', 'pwd', 'secret', 'client_secret',
  'private_key', 'credential', 'credentials',
] as const;
const REDACTED = '***REDACTED***';

/**
 * Defines the supported logger sanitization policy.
 */
export interface LoggerSanitizationPolicy {
  readonly sanitizeCredentials: boolean;
  readonly sensitiveFields: readonly string[];
  readonly customValuePatterns: readonly string[];
  readonly maxPayloadSize: number;
}

/**
 * Normalizes log message while preserving caller-owned input.
 */
export function sanitizeLogMessage(message: string, options: SanitizationOptions = {}): string {
  const fields = sensitiveFieldSet(options.sensitiveFields);
  const fieldPattern = [...fields].map(escapeRegExp).join('|');
  let sanitized = message.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED);
  if (fieldPattern) {
    const keyed = new RegExp(
      `((?:${fieldPattern})\\s*[=:]\\s*["']?)(?:Bearer\\s+)?([^\\s,"'}\\]]+)`,
      'gi',
    );
    sanitized = sanitized.replace(keyed, `$1${REDACTED}`);
  }
  sanitized = sanitized.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`);
  for (const pattern of compilePatterns(options.customValuePatterns ?? [])) {
    sanitized = sanitized.replace(pattern, REDACTED);
  }
  return sanitized.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

/**
 * Normalizes payload while preserving caller-owned input.
 */
export function sanitizePayload<T>(payload: T, options: SanitizationOptions = {}): T {
  const fields = sensitiveFieldSet(options.sensitiveFields);
  const patterns = compilePatterns(options.customValuePatterns ?? []);
  const seen = new WeakSet<object>();
  const visit = (value: unknown, key?: string): unknown => {
    if (key && fields.has(key.toLowerCase())) return REDACTED;
    if (typeof value === 'string') {
      return sanitizeStringWithPatterns(sanitizeLogMessage(value, options), patterns);
    }
    if (typeof value === 'bigint') return value.toString();
    if (value === null || typeof value !== 'object') return value;
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
      return `[Binary: ${(value as ArrayBufferView).byteLength} bytes]`;
    }
    if (value instanceof Error) {
      return { name: value.name, message: sanitizeLogMessage(value.message, options) };
    }
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map(item => visit(item));
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, visit(item, name)]),
    );
  };
  return visit(payload) as T;
}

/**
 * Truncates payload for the owning PixieCore boundary.
 */
export function truncatePayload<T>(payload: T, maxSize = 100 * 1024): T | TruncatedPayload {
  if (!Number.isSafeInteger(maxSize) || maxSize < 1) {
    throw new ConfigurationError('maxSize must be a positive integer');
  }
  const serialized = safeSerialize(payload);
  const originalSize = Buffer.byteLength(serialized);
  if (originalSize <= maxSize) return payload;
  const suffix = '[TRUNCATED]';
  const previewSize = Math.max(0, maxSize - Buffer.byteLength(suffix));
  const preview = decodeUtf8Prefix(Buffer.from(serialized).subarray(0, previewSize));
  return {
    _truncated: true,
    _original_size: originalSize,
    _content: `${preview}${suffix}`,
  };
}

function decodeUtf8Prefix(bytes: Uint8Array): string {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let end = bytes.byteLength; end >= 0; end--) {
    try {
      return decoder.decode(bytes.subarray(0, end));
    } catch {
      // A UTF-8 code point uses at most four bytes, so this loop normally
      // retries no more than three times at a truncation boundary.
    }
  }
  return '';
}

/**
 * Normalizes logger message while preserving caller-owned input.
 */
export function sanitizeLoggerMessage(message: string, policy: LoggerSanitizationPolicy): string {
  if (!policy.sanitizeCredentials) return message;
  return sanitizeLogMessage(message, {
    sensitiveFields: policy.sensitiveFields,
    customValuePatterns: policy.customValuePatterns,
  });
}

/**
 * Normalizes logger fields while preserving caller-owned input.
 */
export function sanitizeLoggerFields(
  value: unknown,
  policy: LoggerSanitizationPolicy,
): unknown {
  const sanitized = policy.sanitizeCredentials
    ? sanitizePayload(value, {
      sensitiveFields: policy.sensitiveFields,
      customValuePatterns: policy.customValuePatterns,
    })
    : clonePayload(value);
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
    return truncatePayload(sanitized, policy.maxPayloadSize);
  }
  return Object.fromEntries(Object.entries(sanitized).map(([key, field]) => [
    key,
    isTruncatedPayload(field) ? field : truncatePayload(field, policy.maxPayloadSize),
  ]));
}

/**
 * Compiles patterns for the owning PixieCore boundary.
 */
export function compilePatterns(patterns: readonly (string | RegExp)[]): RegExp[] {
  return patterns.map(pattern => {
    try {
      if (pattern instanceof RegExp) {
        const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
        return new RegExp(pattern.source, flags);
      }
      return new RegExp(pattern, 'g');
    } catch (cause) {
      throw new ConfigurationError(
        `Invalid credential sanitization pattern: ${String(pattern)}`,
        { cause },
      );
    }
  });
}

/**
 * Produces a safe serialize for the owning PixieCore boundary.
 */
export function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Clones payload for the owning PixieCore boundary.
 */
export function clonePayload<T>(value: T): T {
  const seen = new WeakSet<object>();
  const visit = (item: unknown): unknown => {
    if (typeof item === 'bigint') return item.toString();
    if (item === null || typeof item !== 'object') return item;
    if (Buffer.isBuffer(item) || ArrayBuffer.isView(item)) {
      return `[Binary: ${(item as ArrayBufferView).byteLength} bytes]`;
    }
    if (item instanceof Error) return { name: item.name, message: item.message };
    if (seen.has(item)) return '[Circular]';
    seen.add(item);
    if (Array.isArray(item)) return item.map(visit);
    return Object.fromEntries(
      Object.entries(item).map(([name, nested]) => [name, visit(nested)]),
    );
  };
  return visit(value) as T;
}

/**
 * Returns the value as a record when it has an object shape.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { fields: value };
}

function sensitiveFieldSet(custom: readonly string[] = []): Set<string> {
  return new Set(
    [...DEFAULT_SENSITIVE_FIELDS, ...custom]
      .map(field => field.trim().toLowerCase())
      .filter(Boolean),
  );
}

function sanitizeStringWithPatterns(value: string, patterns: readonly RegExp[]): string {
  let result = value;
  for (const pattern of patterns) {
    result = result.replace(new RegExp(pattern.source, pattern.flags), REDACTED);
  }
  return result;
}

function isTruncatedPayload(value: unknown): value is TruncatedPayload {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as { _truncated?: unknown })._truncated === true,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

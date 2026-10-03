/**
 * Coordinates cache responsibilities inside the PixieCore kernel.
 */

import { createHash } from 'node:crypto';
import {
  canonicalJson,
  cloneFrozenJsonValue,
} from '../../component/json-artifact/index.js';
import type {
  BlueprintExecutionCacheInput,
  CacheResolutionStatus,
  CacheSensitivity,
  CacheVersionedIdentity,
  SafeCacheInput,
  SafeCacheInvalidation,
  SafeCachePort,
  SafeCacheRecord,
  SafeCacheResolution,
  SafeContentCacheOptions,
} from '../../contracts/cache/index.js';
import { PixieCoreError } from '../../contracts/errors/index.js';
import type { JsonValue } from '../../contracts/types/index.js';

export type {
  BlueprintExecutionCacheInput,
  CacheResolutionStatus,
  CacheSensitivity,
  CacheVersionedIdentity,
  SafeCacheInput,
  SafeCacheInvalidation,
  SafeCachePort,
  SafeCacheRecord,
  SafeCacheResolution,
  SafeContentCacheOptions,
} from '../../contracts/cache/index.js';

export const SAFE_CACHE_RECORD_SCHEMA = 'pixiecore.safe-cache-record/v1' as const;
export const BLUEPRINT_EXECUTION_CACHE_KEY_SCHEMA = 'pixiecore.blueprint-execution-cache-key/v1' as const;
const CACHE_KEY_SCHEMA = 'pixiecore.safe-cache-key/v1';
const BLUEPRINT_EXECUTION_CACHE_NAMESPACE = 'blueprint-execution';
const SHA256 = /^[0-9a-f]{64}$/u;
const CACHE_KEY = /^pixiecore:v1:[0-9a-f]{64}$/u;

/**
 * Reports safe cache contract failures.
 */
export class SafeCacheContractError extends PixieCoreError {
  /**
   * Creates a SafeCacheContractError with the supplied failure context.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'safe_cache_contract_error', options);
  }
}

/**
 * Caches safe content state for reuse within its owner.
 */
export class SafeContentCache {
  private readonly tenantFingerprint: string;
  private readonly port: SafeCachePort;
  private readonly now: () => Date;

  /**
   * Creates a SafeContentCache and establishes its initial state.
   */
  constructor(options: SafeContentCacheOptions) {
    const tenantId = nonBlank(options.tenantId, 'tenantId');
    if (!options.port
      || typeof options.port.read !== 'function'
      || typeof options.port.write !== 'function'
      || typeof options.port.delete !== 'function'
      || typeof options.port.invalidate !== 'function') {
      throw new SafeCacheContractError('port must implement read, write, delete, and invalidate');
    }
    this.tenantFingerprint = sha256(tenantId);
    this.port = options.port;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Returns or compute from the SafeContentCache state.
   */
  async getOrCompute(
    input: SafeCacheInput,
    compute: () => JsonValue | Promise<JsonValue>,
  ): Promise<SafeCacheResolution> {
    const validated = validateInput(input);
    if (typeof compute !== 'function') throw new SafeCacheContractError('compute must be a function');
    if (validated.sensitivity === 'sensitive') {
      return resolution('bypass', null, null, await compute());
    }

    const contentHash = contentSha256(validated.content);
    const cacheKey = createCacheKey({
      tenant_fingerprint: this.tenantFingerprint,
      namespace: validated.namespace,
      resource_id: validated.resourceId,
      resource_version: validated.resourceVersion,
      invalidation_version: validated.invalidationVersion,
      content_sha256: contentHash,
    });
    const now = validNow(this.now());
    const cached = await this.port.read(cacheKey);
    if (cached !== null) {
      validateRecord(cached, cacheKey, this.tenantFingerprint);
      if (Date.parse(cached.expires_at) > now.getTime()) {
        return resolution('hit', cacheKey, contentHash, cached.value);
      }
      await this.port.delete(cacheKey);
    }

    const value = cloneJson(await compute(), 'computed value');
    const record = createRecord(validated, {
      cacheKey,
      contentHash,
      tenantFingerprint: this.tenantFingerprint,
      now,
      value,
    });
    await this.port.write(record);
    return resolution('miss', cacheKey, contentHash, value);
  }

  /**
   * Invalidates according to the SafeContentCache contract.
   */
  async invalidate(namespace: string, resourceId: string): Promise<number> {
    const selector = Object.freeze({
      tenant_fingerprint: this.tenantFingerprint,
      namespace: nonBlank(namespace, 'namespace'),
      resource_id: nonBlank(resourceId, 'resourceId'),
    });
    const count = await this.port.invalidate(selector);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new SafeCacheContractError('invalidate must return a non-negative safe integer');
    }
    return count;
  }
}

/**
 * Caches blueprint execution state for reuse within its owner.
 */
export class BlueprintExecutionCache {
  private readonly cache: SafeContentCache;

  /**
   * Creates a BlueprintExecutionCache and establishes its initial state.
   */
  constructor(options: SafeContentCacheOptions) {
    this.cache = new SafeContentCache(options);
  }

  /**
   * Returns or compute from the BlueprintExecutionCache state.
   */
  async getOrCompute(
    input: BlueprintExecutionCacheInput,
    compute: () => JsonValue | Promise<JsonValue>,
  ): Promise<SafeCacheResolution> {
    const validated = validateBlueprintExecutionInput(input);
    return await this.cache.getOrCompute({
      namespace: BLUEPRINT_EXECUTION_CACHE_NAMESPACE,
      resourceId: validated.blueprint.id,
      resourceVersion: validated.blueprint.version,
      invalidationVersion: validated.invalidationVersion,
      sensitivity: validated.sensitivity,
      ttlSeconds: validated.ttlSeconds,
      content: {
        schema: BLUEPRINT_EXECUTION_CACHE_KEY_SCHEMA,
        blueprint: { id: validated.blueprint.id, version: validated.blueprint.version },
        provider: { id: validated.provider.id, version: validated.provider.version },
        model: { id: validated.model.id, version: validated.model.version },
        tools: validated.tools.map(tool => ({ id: tool.id, version: tool.version })),
        policy: { id: validated.policy.id, version: validated.policy.version },
        input: validated.input,
      },
    }, compute);
  }

  /**
   * Invalidates according to the BlueprintExecutionCache contract.
   */
  invalidate(blueprintId: string): Promise<number> {
    return this.cache.invalidate(BLUEPRINT_EXECUTION_CACHE_NAMESPACE, blueprintId);
  }
}

interface ValidatedInput {
  readonly namespace: string;
  readonly resourceId: string;
  readonly resourceVersion: string;
  readonly invalidationVersion: string;
  readonly sensitivity: CacheSensitivity;
  readonly ttlSeconds: number;
  readonly content: JsonValue;
}

interface CacheIdentity {
  readonly tenant_fingerprint: string;
  readonly namespace: string;
  readonly resource_id: string;
  readonly resource_version: string;
  readonly invalidation_version: string;
  readonly content_sha256: string;
}

interface ValidatedBlueprintExecutionInput {
  readonly blueprint: CacheVersionedIdentity;
  readonly provider: CacheVersionedIdentity;
  readonly model: CacheVersionedIdentity;
  readonly tools: readonly CacheVersionedIdentity[];
  readonly policy: CacheVersionedIdentity;
  readonly invalidationVersion: string;
  readonly sensitivity: CacheSensitivity;
  readonly ttlSeconds: number;
  readonly input: JsonValue;
}

function validateBlueprintExecutionInput(input: BlueprintExecutionCacheInput): ValidatedBlueprintExecutionInput {
  if (!input || typeof input !== 'object') {
    throw new SafeCacheContractError('Blueprint execution cache input must be an object');
  }
  if (!Array.isArray(input.tools)) {
    throw new SafeCacheContractError('tools must be an array');
  }
  const tools = input.tools.map((tool, index) => versionedIdentity(tool, `tools[${index}]`));
  tools.sort(compareVersionedIdentity);
  const toolIds = new Set<string>();
  for (const tool of tools) {
    if (toolIds.has(tool.id)) {
      throw new SafeCacheContractError(`tools contains duplicate id ${tool.id}`);
    }
    toolIds.add(tool.id);
  }
  return Object.freeze({
    blueprint: versionedIdentity(input.blueprint, 'blueprint'),
    provider: versionedIdentity(input.provider, 'provider'),
    model: versionedIdentity(input.model, 'model'),
    tools: Object.freeze(tools),
    policy: versionedIdentity(input.policy, 'policy'),
    invalidationVersion: nonBlank(input.invalidationVersion, 'invalidationVersion'),
    sensitivity: input.sensitivity ?? 'sensitive',
    ttlSeconds: input.ttlSeconds,
    input: cloneJson(input.input, 'input'),
  });
}

function versionedIdentity(value: CacheVersionedIdentity, label: string): CacheVersionedIdentity {
  if (!value || typeof value !== 'object') {
    throw new SafeCacheContractError(`${label} must be an object`);
  }
  return Object.freeze({
    id: nonBlank(value.id, `${label}.id`),
    version: nonBlank(value.version, `${label}.version`),
  });
}

function compareVersionedIdentity(left: CacheVersionedIdentity, right: CacheVersionedIdentity): number {
  if (left.id === right.id) return 0;
  if (left.id < right.id) return -1;
  return 1;
}

function validateInput(input: SafeCacheInput): ValidatedInput {
  if (!input || typeof input !== 'object') throw new SafeCacheContractError('input must be an object');
  if (input.sensitivity !== 'non-sensitive' && input.sensitivity !== 'sensitive') {
    throw new SafeCacheContractError('sensitivity must be non-sensitive or sensitive');
  }
  if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new SafeCacheContractError('ttlSeconds must be a positive safe integer');
  }
  return Object.freeze({
    namespace: nonBlank(input.namespace, 'namespace'),
    resourceId: nonBlank(input.resourceId, 'resourceId'),
    resourceVersion: nonBlank(input.resourceVersion, 'resourceVersion'),
    invalidationVersion: nonBlank(input.invalidationVersion, 'invalidationVersion'),
    sensitivity: input.sensitivity,
    ttlSeconds: input.ttlSeconds,
    content: cloneJson(input.content, 'content'),
  });
}

function createCacheKey(identity: CacheIdentity): string {
  return `pixiecore:v1:${sha256(canonicalJson({ schema: CACHE_KEY_SCHEMA, ...identity }))}`;
}

function createRecord(
  input: ValidatedInput,
  context: {
    readonly cacheKey: string;
    readonly contentHash: string;
    readonly tenantFingerprint: string;
    readonly now: Date;
    readonly value: JsonValue;
  },
): SafeCacheRecord {
  const expiresAt = context.now.getTime() + input.ttlSeconds * 1000;
  if (!Number.isSafeInteger(expiresAt)) {
    throw new SafeCacheContractError('Cache expiry exceeds the safe timestamp range');
  }
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) throw new SafeCacheContractError('Cache expiry is invalid');
  return Object.freeze({
    schema: SAFE_CACHE_RECORD_SCHEMA,
    cache_key: context.cacheKey,
    tenant_fingerprint: context.tenantFingerprint,
    namespace: input.namespace,
    resource_id: input.resourceId,
    resource_version: input.resourceVersion,
    invalidation_version: input.invalidationVersion,
    content_sha256: context.contentHash,
    created_at: context.now.toISOString(),
    expires_at: expires.toISOString(),
    value: context.value,
  });
}

function validateRecord(record: SafeCacheRecord, expectedKey: string, tenantFingerprint: string): void {
  if (!record || typeof record !== 'object' || record.schema !== SAFE_CACHE_RECORD_SCHEMA) {
    throw new SafeCacheContractError('Cache port returned an unsupported record');
  }
  if (record.cache_key !== expectedKey || !CACHE_KEY.test(record.cache_key)) {
    throw new SafeCacheContractError('Cache port returned a record for another key');
  }
  if (record.tenant_fingerprint !== tenantFingerprint || !SHA256.test(record.tenant_fingerprint)) {
    throw new SafeCacheContractError('Cache port returned a record for another tenant');
  }
  nonBlank(record.namespace, 'record.namespace');
  nonBlank(record.resource_id, 'record.resource_id');
  nonBlank(record.resource_version, 'record.resource_version');
  nonBlank(record.invalidation_version, 'record.invalidation_version');
  if (!SHA256.test(record.content_sha256)) throw new SafeCacheContractError('record.content_sha256 is invalid');
  const derivedKey = createCacheKey({
    tenant_fingerprint: record.tenant_fingerprint,
    namespace: record.namespace,
    resource_id: record.resource_id,
    resource_version: record.resource_version,
    invalidation_version: record.invalidation_version,
    content_sha256: record.content_sha256,
  });
  if (derivedKey !== expectedKey) {
    throw new SafeCacheContractError('Cache record identity does not match its key');
  }
  const created = timestamp(record.created_at, 'record.created_at');
  const expires = timestamp(record.expires_at, 'record.expires_at');
  if (expires.getTime() <= created.getTime()) {
    throw new SafeCacheContractError('record.expires_at must be after record.created_at');
  }
  cloneJson(record.value, 'record.value');
}

function resolution(
  status: CacheResolutionStatus,
  cacheKey: string | null,
  contentHash: string | null,
  value: unknown,
): SafeCacheResolution {
  return Object.freeze({
    status,
    cache_key: cacheKey,
    content_sha256: contentHash,
    value: cloneJson(value, 'value'),
  });
}

function contentSha256(value: JsonValue): string {
  return sha256(canonicalJson(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function cloneJson(value: unknown, label: string): JsonValue {
  return cloneFrozenJsonValue(
    value,
    label,
    message => new SafeCacheContractError(message),
  ) as JsonValue;
}

function timestamp(value: string, label: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new SafeCacheContractError(`${label} must be an RFC 3339 UTC timestamp`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new SafeCacheContractError(`${label} must be an RFC 3339 UTC timestamp`);
  }
  return parsed;
}

function validNow(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new SafeCacheContractError('now() must return a valid Date');
  }
  return value;
}

function nonBlank(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SafeCacheContractError(`${label} must be non-blank`);
  }
  return value;
}

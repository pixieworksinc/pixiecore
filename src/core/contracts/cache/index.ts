/**
 * Defines cache contracts shared across PixieCore boundaries.
 */

import type { JsonValue } from '../types/index.js';

/**
 * Defines the supported cache sensitivity values.
 */
export type CacheSensitivity = 'non-sensitive' | 'sensitive';
/**
 * Defines the supported cache resolution status values.
 */
export type CacheResolutionStatus = 'hit' | 'miss' | 'bypass';

/**
 * Supplies the input required to create safe cache.
 */
export interface SafeCacheInput {
  readonly namespace: string;
  readonly resourceId: string;
  readonly resourceVersion: string;
  readonly invalidationVersion: string;
  readonly sensitivity: CacheSensitivity;
  readonly ttlSeconds: number;
  readonly content: JsonValue;
}

/**
 * Records safe cache evidence.
 */
export interface SafeCacheRecord {
  readonly schema: 'pixiecore.safe-cache-record/v1';
  readonly cache_key: string;
  readonly tenant_fingerprint: string;
  readonly namespace: string;
  readonly resource_id: string;
  readonly resource_version: string;
  readonly invalidation_version: string;
  readonly content_sha256: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly value: JsonValue;
}

/**
 * Describes the safe cache resolution contract.
 */
export interface SafeCacheResolution {
  readonly status: CacheResolutionStatus;
  readonly cache_key: string | null;
  readonly content_sha256: string | null;
  readonly value: JsonValue;
}

/**
 * Describes the safe cache invalidation contract.
 */
export interface SafeCacheInvalidation {
  readonly tenant_fingerprint: string;
  readonly namespace: string;
  readonly resource_id: string;
}

/**
 * Defines the safe cache boundary implemented by adapters.
 */
export interface SafeCachePort {
  /**
   * Returns the requested operation without exposing mutable internal state.
   */
  read(cacheKey: string): SafeCacheRecord | null | Promise<SafeCacheRecord | null>;
  /**
   * Writes a sanitized record to the configured destination.
   */
  write(record: SafeCacheRecord): void | Promise<void>;
  /**
   * Deletes the addressed entry from the owning store.
   */
  delete(cacheKey: string): void | Promise<void>;
  /**
   * Invalidates matching entries in the owning cache.
   */
  invalidate(selector: SafeCacheInvalidation): number | Promise<number>;
}

/**
 * Configures safe content cache behavior.
 */
export interface SafeContentCacheOptions {
  readonly tenantId: string;
  readonly port: SafeCachePort;
  /** Supplies the clock used to evaluate cache expiry deterministically. */
  readonly now?: () => Date;
}

/**
 * Describes the cache versioned identity contract.
 */
export interface CacheVersionedIdentity {
  readonly id: string;
  readonly version: string;
}

/**
 * Supplies the input required to create blueprint execution cache.
 */
export interface BlueprintExecutionCacheInput {
  readonly blueprint: CacheVersionedIdentity;
  readonly provider: CacheVersionedIdentity;
  readonly model: CacheVersionedIdentity;
  readonly tools: readonly CacheVersionedIdentity[];
  readonly policy: CacheVersionedIdentity;
  readonly invalidationVersion: string;
  /** Omission fails closed to `sensitive`, which bypasses hashing and storage. */
  readonly sensitivity?: CacheSensitivity;
  readonly ttlSeconds: number;
  readonly input: JsonValue;
}

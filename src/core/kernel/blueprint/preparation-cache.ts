/**
 * Coordinates preparation cache responsibilities inside the PixieCore kernel.
 */

import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Blueprint } from '../../contracts/types/index.js';
import type { BlueprintValidatorPort } from '../../contracts/validation/index.js';

/**
 * Describes the blueprint preparation cache snapshot contract.
 */
export interface BlueprintPreparationCacheSnapshot {
  readonly capacity: number;
  readonly entries: number;
  readonly hits: number;
  readonly misses: number;
  readonly coalesced: number;
  readonly evictions: number;
}

interface CacheEntry {
  readonly identity: string;
  readonly blueprint: Blueprint;
}

const DEFAULT_CAPACITY = 64;

/** Runtime-scoped, bounded cache for validated Blueprint source. */
export class BlueprintPreparationCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<Blueprint>>();
  private hits = 0;
  private misses = 0;
  private coalesced = 0;
  private evictions = 0;

  /**
   * Creates a BlueprintPreparationCache and establishes its initial state.
   */
  constructor(readonly capacity = DEFAULT_CAPACITY) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError('Blueprint preparation cache capacity must be a positive integer');
    }
  }

  /**
   * Loads yaml and normalizes it for the BlueprintPreparationCache.
   */
  loadYaml(source: string, validator: BlueprintValidatorPort): Blueprint {
    const identity = digest(source);
    const key = `yaml:${identity}`;
    const cached = this.read(key, identity);
    if (cached) return cloneBlueprint(cached);
    this.misses++;
    const blueprint = validator.validateYaml(source);
    this.write(key, identity, blueprint);
    return blueprint;
  }

  /**
   * Loads file and normalizes it for the BlueprintPreparationCache.
   */
  async loadFile(path: string, validator: BlueprintValidatorPort): Promise<Blueprint> {
    const key = `file:${resolve(path)}`;
    let identity: string;
    try {
      identity = await fileIdentity(path);
    } catch {
      // Preserve the validator's public file-not-found and read-error mapping.
      return validator.validateFile(path);
    }
    const cached = this.read(key, identity);
    if (cached) return cloneBlueprint(cached);

    const pendingKey = `${key}\0${identity}`;
    const current = this.pending.get(pendingKey);
    if (current) {
      this.coalesced++;
      return cloneBlueprint(await current);
    }

    this.misses++;
    const loading = validator.validateFile(path).then(blueprint => {
      this.write(key, identity, blueprint);
      return blueprint;
    });
    this.pending.set(pendingKey, loading);
    try {
      return await loading;
    } finally {
      this.pending.delete(pendingKey);
    }
  }

  /**
   * Returns an immutable snapshot of the current state.
   */
  snapshot(): BlueprintPreparationCacheSnapshot {
    return Object.freeze({
      capacity: this.capacity,
      entries: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      coalesced: this.coalesced,
      evictions: this.evictions,
    });
  }

  /**
   * Removes every cached Blueprint and in-flight load from this runtime.
   */
  clear(): void {
    this.entries.clear();
    this.pending.clear();
  }

  /**
   * Returns a matching cached Blueprint and refreshes its recency.
   */
  private read(key: string, identity: string): Blueprint | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.identity !== identity) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return entry.blueprint;
  }

  /**
   * Stores a defensive Blueprint copy and evicts the least-recent entry when full.
   */
  private write(key: string, identity: string, blueprint: Blueprint): void {
    this.entries.delete(key);
    this.entries.set(key, { identity, blueprint: cloneBlueprint(blueprint) });
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.evictions++;
    }
  }
}

async function fileIdentity(path: string): Promise<string> {
  const value = await stat(path, { bigint: true });
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs]
    .map(item => item.toString())
    .join(':');
}

function digest(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function cloneBlueprint(blueprint: Blueprint): Blueprint {
  return structuredClone(blueprint);
}

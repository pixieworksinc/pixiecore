import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  BLUEPRINT_EXECUTION_CACHE_KEY_SCHEMA,
  BlueprintExecutionCache,
  SAFE_CACHE_RECORD_SCHEMA,
  SafeCacheContractError,
  SafeContentCache,
  type BlueprintExecutionCacheInput,
  type SafeCacheInvalidation,
  type SafeCachePort,
  type SafeCacheRecord,
} from '../../src/core/kernel/cache/index.js';
import { testData } from '../helpers/test-data.js';

const data = testData('safe content cache');
const schema = JSON.parse(await readFile(fileURLToPath(new URL(
  '../../schemas/pixiecore.safe-cache-record-v1.schema.json',
  import.meta.url,
)), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const startedAt = new Date('2026-08-25T16:00:00.000Z');

test('non-sensitive content produces a deterministic tenant key and reusable frozen record', async () => {
  const port = new MemoryPort();
  const cache = createCache(port);
  let computations = 0;
  const first = await cache.getOrCompute(input({ city: 'Paris', policy: { level: 1, active: true } }), () => {
    computations++;
    return { level: 'A', note: data.text('cached result') };
  });
  const second = await cache.getOrCompute(input({ policy: { active: true, level: 1 }, city: 'Paris' }), () => {
    computations++;
    return { level: 'unexpected' };
  });

  assert.equal(first.status, 'miss');
  assert.equal(second.status, 'hit');
  assert.equal(first.cache_key, second.cache_key);
  assert.equal(first.content_sha256, second.content_sha256);
  assert.deepEqual(second.value, first.value);
  assert.notEqual(second.value, first.value);
  assert.equal(Object.isFrozen(second), true);
  assert.equal(Object.isFrozen(second.value), true);
  assert.equal(computations, 1);
  assert.equal(port.reads, 2);
  assert.equal(port.writes.length, 1);
  assert.equal(port.writes[0]?.schema, SAFE_CACHE_RECORD_SCHEMA);
  assert.equal(validate(port.writes[0]), true, JSON.stringify(validate.errors));
});

test('content, resource, invalidation, and tenant changes produce distinct cache keys', async () => {
  const port = new MemoryPort();
  const first = createCache(port, 'tenant-one');
  const second = createCache(port, 'tenant-two');
  const base = input({ value: 1 });
  const cases = [
    await first.getOrCompute(base, () => 'base'),
    await first.getOrCompute({ ...base, content: { value: 2 } }, () => 'content'),
    await first.getOrCompute({ ...base, resourceVersion: '2.0.0' }, () => 'resource'),
    await first.getOrCompute({ ...base, invalidationVersion: 'generation-2' }, () => 'invalidation'),
    await second.getOrCompute(base, () => 'tenant'),
  ];
  assert.equal(new Set(cases.map(item => item.cache_key)).size, cases.length);
  assert.equal(new Set(cases.map(item => item.content_sha256)).size, 2);
  assert.equal(port.writes.length, cases.length);
});

test('sensitive content bypasses every cache operation and is never hashed', async () => {
  const port = new MemoryPort();
  const secret = data.text('secret input', 'secret');
  const cache = createCache(port);
  const result = await cache.getOrCompute({
    ...input({ secret }),
    sensitivity: 'sensitive',
  }, () => ({ secret, result: data.text('secret result') }));

  assert.equal(result.status, 'bypass');
  assert.equal(result.cache_key, null);
  assert.equal(result.content_sha256, null);
  assert.equal(port.reads, 0);
  assert.equal(port.deletes.length, 0);
  assert.equal(port.writes.length, 0);
  assert.equal(port.invalidations.length, 0);
});

test('Blueprint execution cache canonicalizes tool order and every required version dimension', async () => {
  const port = new MemoryPort();
  const cache = new BlueprintExecutionCache({
    tenantId: data.text('execution tenant'),
    port,
    now: () => new Date(startedAt),
  });
  const city = data.text('execution city');
  const policyLevel = data.integer('execution policy level', 1, 100);
  const base = executionInput({ city, policy: { active: true, level: policyLevel } });
  const first = await cache.getOrCompute(base, () => ({ level: data.text('execution result') }));
  const reordered = await cache.getOrCompute({
    ...base,
    input: { value: { policy: { level: policyLevel, active: true }, city } },
    tools: [...base.tools].reverse(),
  }, () => ({ level: data.text('unexpected execution result') }));

  assert.equal(BLUEPRINT_EXECUTION_CACHE_KEY_SCHEMA, 'pixiecore.blueprint-execution-cache-key/v1');
  assert.equal(first.status, 'miss');
  assert.equal(reordered.status, 'hit');
  assert.equal(first.cache_key, reordered.cache_key);
  assert.equal(port.writes.length, 1);
  assert.equal(port.writes[0]?.namespace, 'blueprint-execution');
  assert.equal(port.writes[0]?.resource_id, base.blueprint.id);

  const versionChanges: readonly BlueprintExecutionCacheInput[] = [
    { ...base, blueprint: { ...base.blueprint, version: data.text('next blueprint version') } },
    { ...base, provider: { ...base.provider, version: data.text('next provider version') } },
    { ...base, model: { ...base.model, version: data.text('next model version') } },
    { ...base, tools: [{ ...base.tools[0]!, version: data.text('next first tool version') }, base.tools[1]!] },
    { ...base, policy: { ...base.policy, version: data.text('next policy version') } },
    { ...base, invalidationVersion: data.text('next execution invalidation version') },
  ];
  const changed = await Promise.all(versionChanges.map((item, index) => (
    cache.getOrCompute(item, () => ({ index }))
  )));
  assert.equal(new Set([first, ...changed].map(item => item.cache_key)).size, changed.length + 1);
  assert.equal(changed.every(item => item.status === 'miss'), true);
});

test('Blueprint execution cache defaults to sensitive bypass before key construction or port access', async () => {
  const port = new MemoryPort();
  const cache = new BlueprintExecutionCache({ tenantId: data.text('default sensitive tenant'), port });
  const secret = data.text('default sensitive input', 'secret');
  const { sensitivity: _sensitivity, ...defaultSensitive } = executionInput({ secret });
  const result = await cache.getOrCompute(defaultSensitive, () => ({ accepted: true }));

  assert.equal(result.status, 'bypass');
  assert.equal(result.cache_key, null);
  assert.equal(result.content_sha256, null);
  assert.equal(port.reads, 0);
  assert.equal(port.writes.length, 0);
  assert.equal(port.deletes.length, 0);
});

test('Blueprint execution cache validates identities, duplicate tools, and scoped invalidation', async () => {
  const port = new MemoryPort();
  const cache = new BlueprintExecutionCache({ tenantId: data.text('validation tenant'), port });
  const valid = executionInput({ value: true });
  const invalidInputs: readonly BlueprintExecutionCacheInput[] = [
    null as never,
    { ...valid, blueprint: undefined as never },
    { ...valid, provider: { ...valid.provider, version: '' } },
    { ...valid, model: { id: '', version: valid.model.version } },
    { ...valid, policy: null as never },
    { ...valid, tools: null as never },
    { ...valid, tools: [null as never] },
    { ...valid, tools: [valid.tools[0]!, valid.tools[0]!] },
    { ...valid, sensitivity: 'unknown' as never },
    { ...valid, ttlSeconds: 0 },
    { ...valid, input: Number.NaN as never },
  ];
  for (const invalid of invalidInputs) {
    await assert.rejects(cache.getOrCompute(invalid, () => null), SafeCacheContractError);
  }

  await cache.getOrCompute(valid, () => ({ cached: true }));
  assert.equal(await cache.invalidate(valid.blueprint.id), 1);
  assert.equal(port.invalidations[0]?.namespace, 'blueprint-execution');
  assert.equal(port.invalidations[0]?.resource_id, valid.blueprint.id);
});

test('expired records are deleted at the exact boundary before recomputation', async () => {
  let now = new Date(startedAt);
  const port = new MemoryPort();
  const cache = new SafeContentCache({
    tenantId: 'tenant-expiry',
    port,
    now: () => new Date(now),
  });
  const request = { ...input({ value: true }), ttlSeconds: 60 };
  const first = await cache.getOrCompute(request, () => 'first');
  now = new Date('2026-08-25T16:01:00.000Z');
  const second = await cache.getOrCompute(request, () => 'second');

  assert.equal(first.status, 'miss');
  assert.equal(second.status, 'miss');
  assert.equal(second.value, 'second');
  assert.deepEqual(port.deletes, [first.cache_key]);
  assert.equal(port.writes.length, 2);
});

test('explicit invalidation is tenant-scoped and validates the port count', async () => {
  const port = new MemoryPort();
  const cache = createCache(port, 'tenant-invalidation');
  await cache.getOrCompute(input({ value: true }), () => ({ cached: true }));
  const count = await cache.invalidate('example-policy', 'city-classifier');

  assert.equal(count, 1);
  assert.equal(port.invalidations.length, 1);
  assert.match(port.invalidations[0]?.tenant_fingerprint ?? '', /^[0-9a-f]{64}$/u);
  assert.equal(port.invalidations[0]?.namespace, 'example-policy');
  assert.equal(port.invalidations[0]?.resource_id, 'city-classifier');

  port.invalidationResult = -1;
  await assert.rejects(cache.invalidate('example-policy', 'city-classifier'), /non-negative/u);
});

test('cache failures and poisoned records fail closed without storing failed computations', async () => {
  const port = new MemoryPort();
  const cache = createCache(port);
  const failure = new Error(data.text('compute failure'));
  await assert.rejects(cache.getOrCompute(input({ value: 'failure' }), async () => {
    throw failure;
  }), error => error === failure);
  assert.equal(port.writes.length, 0);

  const good = await cache.getOrCompute(input({ value: 'poison' }), () => ({ safe: true }));
  const record = port.records.get(good.cache_key!)!;
  port.records.set(good.cache_key!, { ...record, resource_version: 'unexpected' });
  await assert.rejects(
    cache.getOrCompute(input({ value: 'poison' }), () => ({ safe: false })),
    /identity does not match/u,
  );

  port.records.set(good.cache_key!, { ...record, tenant_fingerprint: '0'.repeat(64) });
  await assert.rejects(
    cache.getOrCompute(input({ value: 'poison' }), () => ({ safe: false })),
    /another tenant/u,
  );
});

test('constructor and input contracts reject ambiguous or unsafe values', async () => {
  assert.throws(() => new SafeContentCache({ tenantId: '', port: new MemoryPort() }), /tenantId/u);
  assert.throws(() => new SafeContentCache({ tenantId: 'tenant', port: {} as SafeCachePort }), /port/u);
  const cache = createCache(new MemoryPort());
  const valid = input({ value: true });
  for (const invalid of [
    { ...valid, namespace: '' },
    { ...valid, resourceId: '' },
    { ...valid, resourceVersion: '' },
    { ...valid, invalidationVersion: '' },
    { ...valid, sensitivity: 'unknown' as never },
    { ...valid, ttlSeconds: 0 },
    { ...valid, ttlSeconds: Number.MAX_VALUE },
    { ...valid, content: Number.NaN as never },
  ]) {
    await assert.rejects(cache.getOrCompute(invalid, () => null), SafeCacheContractError);
  }
  await assert.rejects(cache.getOrCompute(valid, null as never), /compute/u);
  await assert.rejects(cache.invalidate('', 'resource'), /namespace/u);

  const invalidClock = new SafeContentCache({
    tenantId: 'tenant', port: new MemoryPort(), now: () => new Date(Number.NaN),
  });
  await assert.rejects(invalidClock.getOrCompute(valid, () => null), /valid Date/u);
});

function input(content: SafeCacheRecord['value']) {
  return {
    namespace: 'example-policy',
    resourceId: 'city-classifier',
    resourceVersion: '1.0.0',
    invalidationVersion: 'generation-1',
    sensitivity: 'non-sensitive' as const,
    ttlSeconds: 3_600,
    content,
  };
}

function createCache(port: SafeCachePort, tenantId = 'tenant-default'): SafeContentCache {
  return new SafeContentCache({
    tenantId,
    port,
    now: () => new Date(startedAt),
  });
}

function executionInput(value: SafeCacheRecord['value']): BlueprintExecutionCacheInput {
  return {
    blueprint: { id: data.text('blueprint id', 'blueprint'), version: data.text('blueprint version', 'version') },
    provider: { id: data.text('provider id', 'provider'), version: data.text('provider version', 'version') },
    model: { id: data.text('model id', 'model'), version: data.text('model version', 'version') },
    tools: [
      { id: data.text('first tool id', 'tool'), version: data.text('first tool version', 'version') },
      { id: data.text('second tool id', 'tool'), version: data.text('second tool version', 'version') },
    ],
    policy: { id: data.text('policy id', 'policy'), version: data.text('policy version', 'version') },
    invalidationVersion: data.text('execution invalidation version', 'generation'),
    sensitivity: 'non-sensitive',
    ttlSeconds: data.integer('execution ttl seconds', 60, 7_200),
    input: { value },
  };
}

class MemoryPort implements SafeCachePort {
  readonly records = new Map<string, SafeCacheRecord>();
  readonly writes: SafeCacheRecord[] = [];
  readonly deletes: string[] = [];
  readonly invalidations: SafeCacheInvalidation[] = [];
  reads = 0;
  invalidationResult: number | undefined;

  read(cacheKey: string): SafeCacheRecord | null {
    this.reads++;
    return this.records.get(cacheKey) ?? null;
  }

  write(record: SafeCacheRecord): void {
    this.writes.push(record);
    this.records.set(record.cache_key, record);
  }

  delete(cacheKey: string): void {
    this.deletes.push(cacheKey);
    this.records.delete(cacheKey);
  }

  invalidate(selector: SafeCacheInvalidation): number {
    this.invalidations.push(selector);
    if (this.invalidationResult !== undefined) return this.invalidationResult;
    let removed = 0;
    for (const [key, record] of this.records) {
      if (record.tenant_fingerprint === selector.tenant_fingerprint
        && record.namespace === selector.namespace
        && record.resource_id === selector.resource_id) {
        this.records.delete(key);
        removed++;
      }
    }
    return removed;
  }
}

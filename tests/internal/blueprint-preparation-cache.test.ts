import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { BlueprintPreparationCache } from '../../src/core/kernel/blueprint/preparation-cache.js';
import type { Blueprint } from '../../src/core/contracts/types/index.js';
import type { BlueprintValidatorPort } from '../../src/core/contracts/validation/index.js';
import { BlueprintValidator } from '../../src/plugins/validation/validation.js';
import { withTempDirectory } from '../helpers/temp.js';

test('YAML preparation is bounded, LRU, and isolated between executions', () => {
  const cache = new BlueprintPreparationCache(2);
  const validator = new BlueprintValidator({ warn: () => undefined });
  const first = cache.loadYaml(blueprintSource('First'), validator);
  first.prompt = 'mutated by one execution';
  const cached = cache.loadYaml(blueprintSource('First'), validator);
  assert.equal(cached.prompt, 'Return the input.');

  cache.loadYaml(blueprintSource('Second'), validator);
  cache.loadYaml(blueprintSource('Third'), validator);
  cache.loadYaml(blueprintSource('First'), validator);
  assert.deepEqual(cache.snapshot(), {
    capacity: 2,
    entries: 2,
    hits: 1,
    misses: 4,
    coalesced: 0,
    evictions: 2,
  });

  cache.clear();
  assert.equal(cache.snapshot().entries, 0);
});

test('file preparation invalidates when source metadata changes', async () => {
  await withTempDirectory(async directory => {
    const path = join(directory, 'unit.yaml');
    const cache = new BlueprintPreparationCache();
    const validator = new BlueprintValidator({ warn: () => undefined });
    await writeFile(path, blueprintSource('Before'), 'utf8');
    const before = await cache.loadFile(path, validator);
    const cached = await cache.loadFile(path, validator);
    assert.equal(cached.name, before.name);

    await writeFile(path, blueprintSource('After with a different size'), 'utf8');
    const after = await cache.loadFile(path, validator);
    assert.equal(after.name, 'After with a different size');
    assert.deepEqual(cache.snapshot(), {
      capacity: 64,
      entries: 1,
      hits: 1,
      misses: 2,
      coalesced: 0,
      evictions: 0,
    });
  });
});

test('concurrent file preparation coalesces validation and returns separate values', { timeout: 10_000 }, async context => {
  await withTempDirectory(async directory => {
    const path = join(directory, 'unit.yaml');
    await writeFile(path, blueprintSource('Concurrent'), 'utf8');
    let validations = 0;
    let releaseValidation: () => void = () => undefined;
    const validationGate = new Promise<void>(resolve => { releaseValidation = resolve; });
    const validator = blockedValidator(() => { validations++; }, validationGate);
    const cache = new BlueprintPreparationCache();
    const requests = Promise.all([
      cache.loadFile(path, validator),
      cache.loadFile(path, validator),
    ]);
    try {
      // Metadata reads can finish in different event-loop turns. Keep the
      // validator pending until the second caller observably joins it; one
      // arbitrary delay cannot guarantee overlap on a loaded coverage runner.
      while (cache.snapshot().coalesced === 0) {
        assert.ok(validations <= 1, 'Concurrent requests must share validation');
        await setImmediate(undefined, { signal: context.signal });
      }
      assert.equal(validations, 1);
      releaseValidation();
      const [first, second] = await requests;
      first.name = 'changed';
      assert.equal(second.name, 'Concurrent');
      assert.equal(cache.snapshot().coalesced, 1);
    } finally {
      releaseValidation();
      await requests;
    }
  });
});

test('a completed file preparation is a cache hit rather than an in-flight coalescing event', async () => {
  await withTempDirectory(async directory => {
    const path = join(directory, 'unit.yaml');
    await writeFile(path, blueprintSource('Completed'), 'utf8');
    let validations = 0;
    const cache = new BlueprintPreparationCache();
    const validator = blockedValidator(() => { validations++; }, Promise.resolve());
    const first = await cache.loadFile(path, validator);
    const second = await cache.loadFile(path, validator);
    assert.notEqual(first, second);
    assert.equal(validations, 1);
    assert.equal(cache.snapshot().hits, 1);
    assert.equal(cache.snapshot().coalesced, 0);
  });
});

test('validation failures are never cached', () => {
  let validations = 0;
  const validator: BlueprintValidatorPort = {
    validateDict(): Blueprint { throw new Error('unused'); },
    validateFile(): Promise<Blueprint> { return Promise.reject(new Error('unused')); },
    validateYaml(): Blueprint {
      validations++;
      throw new Error('invalid');
    },
  };
  const cache = new BlueprintPreparationCache();
  assert.throws(() => cache.loadYaml('invalid', validator), /invalid/u);
  assert.throws(() => cache.loadYaml('invalid', validator), /invalid/u);
  assert.equal(validations, 2);
  assert.equal(cache.snapshot().entries, 0);
  assert.equal(cache.snapshot().misses, 2);
});

test('cache capacity rejects unsafe values', () => {
  for (const capacity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new BlueprintPreparationCache(capacity), RangeError);
  }
});

/** Holds validation at an explicit gate rather than assuming filesystem timing. */
function blockedValidator(onValidate: () => void, gate: Promise<void>): BlueprintValidatorPort {
  const validator = new BlueprintValidator({ warn: () => undefined });
  return {
    validateDict: value => validator.validateDict(value),
    validateYaml: source => validator.validateYaml(source),
    async validateFile(path): Promise<Blueprint> {
      onValidate();
      await gate;
      return validator.validateFile(path);
    },
  };
}

function blueprintSource(name: string): string {
  return [
    `name: ${JSON.stringify(name)}`,
    "version: '1.0.0'",
    'role: assistant',
    'prompt: Return the input.',
    'output_schema:',
    '  type: object',
    '  additionalProperties: true',
    '',
  ].join('\n');
}

import assert from 'node:assert/strict';
import { globSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  createTestShardArguments,
  createTestShardEstimateWarning,
  createTestShardProfile,
  createTestShards,
  resolveTestShardConcurrency,
  resolveTestShardProfilePath,
  scheduleTestShards,
  summarizeTapOutputs,
} from '../../scripts/run-test-shards.mjs';

test('every shard fixes TAP output independently of the Node.js default reporter', () => {
  assert.deepEqual(createTestShardArguments({
    files: ['shared.test.ts'],
    isolated: false,
  }), [
    '--experimental-test-isolation=none',
    '--test',
    '--test-reporter=tap',
    '--import',
    'tsx',
    'shared.test.ts',
  ]);
  assert.deepEqual(createTestShardArguments({
    files: ['isolated.test.ts'],
    isolated: true,
  }), [
    '--test',
    '--test-reporter=tap',
    '--import',
    'tsx',
    'isolated.test.ts',
  ]);
});

test('full test shards own every test file exactly once', () => {
  const root = resolve('.');
  const expected = [
    ...globSync('tests/*.test.ts', { cwd: root }),
    ...globSync('tests/**/*.test.ts', { cwd: root }),
    ...globSync('src/plugins/**/tests/**/*.test.ts', { cwd: root }),
    ...globSync('examples/blueprints/**/tests/**/*.test.ts', { cwd: root }),
    ...globSync('examples/plugin-project/custom/plugins/*/*/tests/**/*.test.ts', { cwd: root }),
    ...globSync('examples/plugin-authoring/*/tests/**/*.test.js', { cwd: root }),
  ];
  const actual = createTestShards(root).flatMap(shard => shard.files);

  assert.deepEqual([...new Set(actual)].sort(), [...new Set(expected)].sort());
  assert.equal(actual.length, new Set(actual).size);
});

test('only the package self-resolution telemetry contract keeps file isolation', () => {
  const shards = createTestShards(resolve('.'));
  const isolated = shards.filter(shard => shard.isolated);

  assert.deepEqual(isolated.map(shard => shard.id), ['execution-telemetry']);
  assert.deepEqual(isolated[0]?.files, [
    'tests/contract/execution-telemetry.contract.test.ts',
  ]);
});

test('full suite starts expensive shards first without changing catalog order', () => {
  const catalog = createTestShards(resolve('.'));
  const scheduled = scheduleTestShards(catalog);

  assert.equal(catalog[0]?.id, 'architecture-checker');
  assert.deepEqual(scheduled.slice(0, 4).map(shard => shard.id), [
    'repository-integration',
    'owned-plugins-and-examples',
    'contracts',
    'repository-internal-and-smoke',
  ]);
  assert.deepEqual([...scheduled].sort((left, right) => left.id.localeCompare(right.id)),
    [...catalog].sort((left, right) => left.id.localeCompare(right.id)));
});

test('shard profiles mark stale scheduling estimates without preserving test output', () => {
  const shards = [
    { id: 'stable', files: ['stable.test.ts'], isolated: false, estimatedDurationMs: 1_000 },
    { id: 'stale', files: ['stale.test.ts'], isolated: false, estimatedDurationMs: 1_000 },
  ];
  const results = [
    { id: 'stable', code: 0, signal: null, durationMs: 1_200, stdout: 'raw output', stderr: '' },
    { id: 'stale', code: 0, signal: null, durationMs: 1_400, stdout: 'sensitive output', stderr: '' },
  ];

  const profile = createTestShardProfile(shards, results, 4);

  assert.equal(profile.schema, 'pixiecore.test-shard-profile/v1');
  assert.equal(profile.shard_concurrency, 4);
  assert.equal(profile.shards[0]?.estimate_needs_review, false);
  assert.equal(profile.shards[1]?.estimate_needs_review, true);
  assert.deepEqual(Object.keys(profile.shards[1] ?? {}).sort(), [
    'estimate_difference_ratio',
    'estimate_needs_review',
    'estimated_duration_ms',
    'file_count',
    'id',
    'observed_duration_ms',
  ]);
  assert.equal(
    createTestShardEstimateWarning(profile),
    'PixieCore shard scheduling warning: stale differ from scheduling estimates by at least 35%; review estimates without treating timing as a CI failure.\n',
  );
});

test('shard estimate review stays quiet when all scheduling estimates are current', () => {
  const profile = createTestShardProfile([
    { id: 'current', files: ['current.test.ts'], isolated: false, estimatedDurationMs: 1_000 },
  ], [
    { id: 'current', code: 0, signal: null, durationMs: 1_200, stdout: '', stderr: '' },
  ], 4);

  assert.equal(createTestShardEstimateWarning(profile), undefined);
});

test('shard concurrency defaults to four and rejects unsafe overrides', () => {
  assert.equal(resolveTestShardConcurrency(undefined), 4);
  assert.equal(resolveTestShardConcurrency('1'), 1);
  assert.equal(resolveTestShardConcurrency('8'), 8);

  for (const value of ['', '0', '-1', '1.5', 'many', '9']) {
    assert.throws(() => resolveTestShardConcurrency(value), /PIXIECORE_TEST_SHARD_CONCURRENCY/u);
  }
});

test('shard profile paths fail closed outside the repository', () => {
  assert.equal(
    resolveTestShardProfilePath('/workspace/pixiecore', '.pixiecore/profile.json'),
    '/workspace/pixiecore/.pixiecore/profile.json',
  );
  assert.throws(
    () => resolveTestShardProfilePath('/workspace/pixiecore', '../profile.json'),
    /PIXIECORE_TEST_SHARD_PROFILE_PATH must resolve inside the repository root/u,
  );
});

test('shard summaries use final counters instead of nested child TAP counters', () => {
  const output = [
    'TAP version 13',
    '# tests 1',
    '# pass 1',
    '# fail 0',
    '# skipped 0',
    '1..2',
    '# tests 3',
    '# pass 2',
    '# fail 0',
    '# skipped 1',
    '',
  ].join('\n');

  assert.deepEqual(summarizeTapOutputs([output, output]), {
    tests: 6,
    pass: 4,
    fail: 0,
    skipped: 2,
  });
});

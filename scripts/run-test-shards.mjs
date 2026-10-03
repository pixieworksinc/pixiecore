#!/usr/bin/env node

import { globSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const SCRIPT_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const DEFAULT_MAX_CONCURRENT_SHARDS = 4;
const MAX_CONFIGURED_CONCURRENT_SHARDS = 8;
const SHARD_CONCURRENCY_VARIABLE = 'PIXIECORE_TEST_SHARD_CONCURRENCY';
const SHARD_PROFILE_PATH_VARIABLE = 'PIXIECORE_TEST_SHARD_PROFILE_PATH';
const SHARD_PROFILE_SCHEMA = 'pixiecore.test-shard-profile/v1';
const STALE_ESTIMATE_THRESHOLD = 0.35;

if (isMainModule()) {
  const result = await runTestShards(DEFAULT_REPOSITORY_ROOT);
  process.exitCode = result.exitCode;
}

/**
 * Creates the complete, non-overlapping full-suite shard catalog.
 *
 * Most shards share one Node.js process internally to avoid repeated tsx and
 * module startup. The telemetry contract retains file isolation because it
 * intentionally verifies package self-resolution against source modules.
 */
export function createTestShards(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const architectureFiles = files(repositoryRoot, 'tests/architecture/**/*.test.ts');
  const architectureGeneratorFiles = architectureFiles.filter(path =>
    /\/core-(?:plugin|recipe)-generator\.test\.ts$/u.test(path));
  const architectureRestFiles = architectureFiles.filter(path =>
    !path.endsWith('/checker.test.ts') && !architectureGeneratorFiles.includes(path));
  const telemetryPath = 'tests/contract/execution-telemetry.contract.test.ts';
  const contractFiles = files(repositoryRoot, 'tests/contract/**/*.test.ts')
    .filter(path => path !== telemetryPath);

  return Object.freeze([
    shard('architecture-checker', ['tests/architecture/checker.test.ts'], false, 750),
    shard('architecture-generators', architectureGeneratorFiles, false, 250),
    shard('architecture-policy', [
      ...files(repositoryRoot, 'tests/*.test.ts'),
      ...architectureRestFiles,
    ], false, 2_400),
    shard('contracts', contractFiles, false, 5_400),
    shard('repository-integration', [
      ...files(repositoryRoot, 'tests/integration/**/*.test.ts'),
    ], false, 8_300),
    shard('repository-internal-and-smoke', [
      ...files(repositoryRoot, 'tests/internal/**/*.test.ts'),
      ...files(repositoryRoot, 'tests/smoke/**/*.test.ts'),
    ], false, 4_200),
    shard('owned-plugins-and-examples', [
      ...files(repositoryRoot, 'src/plugins/**/tests/**/*.test.ts'),
      ...files(repositoryRoot, 'examples/blueprints/**/tests/**/*.test.ts'),
      ...files(
        repositoryRoot,
        'examples/plugin-project/custom/plugins/*/*/tests/**/*.test.ts',
      ),
      ...files(repositoryRoot, 'examples/plugin-authoring/*/tests/**/*.test.js'),
    ], false, 6_800),
    shard('execution-telemetry', [telemetryPath], true, 550),
  ]);
}

/** Creates version-stable Node.js test-runner arguments for one shard. */
export function createTestShardArguments(descriptor) {
  const isolation = descriptor.isolated ? [] : ['--experimental-test-isolation=none'];
  return [
    ...isolation,
    '--test',
    '--test-reporter=tap',
    '--import',
    'tsx',
    ...descriptor.files,
  ];
}

/** Runs every shard concurrently and prints deterministic, grouped TAP output. */
export async function runTestShards(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const root = resolve(repositoryRoot);
  const shards = createTestShards(root);
  const concurrency = resolveTestShardConcurrency();
  const results = await runShardPool(root, shards, concurrency);

  for (const result of results) {
    process.stdout.write(`# PixieCore test shard: ${result.id}\n`);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  }

  const failed = results.filter(result => result.code !== 0 || result.signal !== null);
  const totals = summarizeTapOutputs(results.map(result => result.stdout));
  process.stdout.write(
    `PixieCore shard summary: ${totals.tests} tests, ${totals.pass} passed, `
      + `${totals.fail} failed, ${totals.skipped} skipped across ${results.length} shards.\n`,
  );

  const profile = createTestShardProfile(shards, results, concurrency);
  const profilePath = resolveTestShardProfilePath(root);
  if (profilePath) {
    writeTestShardProfile(profilePath, profile);
  }
  printShardProfileDiagnostics(profile, profilePath);

  return Object.freeze({
    exitCode: failed.length === 0 ? 0 : 1,
    results: Object.freeze(results),
    totals,
  });
}

/**
 * Resolves a bounded local shard concurrency override.
 *
 * The default deliberately remains conservative because multiple shards create
 * CLI children and loopback HTTP servers. A malformed override fails before
 * test execution instead of silently changing the test topology.
 */
export function resolveTestShardConcurrency(value = process.env[SHARD_CONCURRENCY_VARIABLE]) {
  if (value === undefined) return DEFAULT_MAX_CONCURRENT_SHARDS;

  const normalized = value.trim();
  if (!/^[1-9]\d*$/u.test(normalized)) {
    throw new Error(`${SHARD_CONCURRENCY_VARIABLE} must be an integer from 1 to ${MAX_CONFIGURED_CONCURRENT_SHARDS}`);
  }

  const concurrency = Number(normalized);
  if (concurrency > MAX_CONFIGURED_CONCURRENT_SHARDS) {
    throw new Error(`${SHARD_CONCURRENCY_VARIABLE} must be an integer from 1 to ${MAX_CONFIGURED_CONCURRENT_SHARDS}`);
  }

  return concurrency;
}

/**
 * Orders pending shards longest-first while leaving the catalog order intact.
 *
 * Results are stored and printed from the original catalog so diagnostics stay
 * deterministic even though the worker pool starts expensive work first.
 */
export function scheduleTestShards(shards) {
  return [...shards]
    .map((descriptor, index) => ({ descriptor, index }))
    .sort((left, right) => right.descriptor.estimatedDurationMs - left.descriptor.estimatedDurationMs
      || left.index - right.index)
    .map(item => item.descriptor);
}

/** Creates a value-free snapshot of observed shard durations for local tuning. */
export function createTestShardProfile(shards, results, concurrency) {
  const resultsById = new Map(results.map(result => [result.id, result]));
  const profileShards = shards.map(descriptor => {
    const result = resultsById.get(descriptor.id);
    if (!result) throw new Error(`Test shard profile is missing result: ${descriptor.id}`);

    const estimateDifference = Math.abs(result.durationMs - descriptor.estimatedDurationMs)
      / Math.max(descriptor.estimatedDurationMs, 1);
    return Object.freeze({
      id: descriptor.id,
      file_count: descriptor.files.length,
      estimated_duration_ms: descriptor.estimatedDurationMs,
      observed_duration_ms: Math.round(result.durationMs),
      estimate_difference_ratio: Number(estimateDifference.toFixed(4)),
      estimate_needs_review: estimateDifference >= STALE_ESTIMATE_THRESHOLD,
    });
  });

  return Object.freeze({
    schema: SHARD_PROFILE_SCHEMA,
    node_version: process.version,
    platform: process.platform,
    architecture: process.arch,
    shard_concurrency: concurrency,
    test_seed: process.env.TEST_SEED ?? null,
    shards: Object.freeze(profileShards),
  });
}

/** Writes a profile atomically after confirming its output remains inside the repository. */
export function writeTestShardProfile(profilePath, profile) {
  const directory = resolve(profilePath, '..');
  mkdirSync(directory, { recursive: true });
  const temporaryPath = `${profilePath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, profilePath);
}

/** Runs a bounded worker pool so CPU-heavy fixtures do not starve CLI children. */
async function runShardPool(repositoryRoot, shards, concurrency) {
  const results = Array(shards.length);
  const resultIndexes = new Map(shards.map((shard, index) => [shard, index]));
  const scheduledShards = scheduleTestShards(shards);
  let nextIndex = 0;
  const takeNext = async () => {
    while (nextIndex < scheduledShards.length) {
      const descriptor = scheduledShards[nextIndex++];
      const resultIndex = resultIndexes.get(descriptor);
      results[resultIndex] = await runShard(repositoryRoot, descriptor);
    }
  };
  const workerCount = Math.min(concurrency, shards.length);
  await Promise.all(Array.from({ length: workerCount }, takeNext));
  return results;
}

/** Aggregates final TAP counters while ignoring nested child TAP summaries. */
export function summarizeTapOutputs(outputs) {
  return Object.freeze(outputs.reduce((summary, output) => addTapTotals(summary, output), {
    tests: 0,
    pass: 0,
    fail: 0,
    skipped: 0,
  }));
}

/** Creates one immutable shard descriptor. */
function shard(id, paths, isolated = false, estimatedDurationMs = 1) {
  const uniquePaths = [...new Set(paths)].sort();
  if (uniquePaths.length === 0) throw new Error(`Test shard ${id} must not be empty`);
  return Object.freeze({
    id,
    files: Object.freeze(uniquePaths),
    isolated,
    estimatedDurationMs,
  });
}

/** Expands one repository-relative test glob deterministically. */
function files(repositoryRoot, pattern) {
  return globSync(pattern, { cwd: repositoryRoot }).sort();
}

/** Runs one shard in its own process while optionally isolating each file. */
function runShard(repositoryRoot, descriptor) {
  return new Promise((resolvePromise, reject) => {
    const startedAt = performance.now();
    const child = spawn(process.execPath, createTestShardArguments(descriptor), {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: process.env.TSX_TSCONFIG_PATH
          ?? join(repositoryRoot, 'tsconfig.test.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolvePromise(Object.freeze({
        id: descriptor.id,
        code,
        signal,
        durationMs: performance.now() - startedAt,
        stdout,
        stderr,
      }));
    });
  });
}

/** Resolves an optional profile output path without allowing writes outside the repository. */
export function resolveTestShardProfilePath(
  repositoryRoot,
  configuredPath = process.env[SHARD_PROFILE_PATH_VARIABLE],
) {
  const normalizedPath = configuredPath?.trim();
  if (!normalizedPath) return undefined;

  const root = resolve(repositoryRoot);
  const resolvedPath = resolve(root, normalizedPath);
  const relativePath = relative(root, resolvedPath);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`${SHARD_PROFILE_PATH_VARIABLE} must resolve inside the repository root`);
  }
  return resolvedPath;
}

/**
 * Creates a warning for estimates that no longer describe observed shard cost.
 *
 * The result deliberately names only shard IDs and the review threshold. It
 * does not expose test output or turn host-dependent timing into a failure.
 */
export function createTestShardEstimateWarning(profile) {
  const staleShardIds = profile.shards
    .filter(shard => shard.estimate_needs_review)
    .map(shard => shard.id);
  if (staleShardIds.length === 0) return undefined;
  return (
    `PixieCore shard scheduling warning: ${staleShardIds.join(', ')} differ from scheduling estimates by at least ${Math.round(STALE_ESTIMATE_THRESHOLD * 100)}%; review estimates without treating timing as a CI failure.\n`
  );
}

/** Prints optional profile storage and default-on estimate review diagnostics. */
function printShardProfileDiagnostics(profile, profilePath) {
  if (profilePath) process.stdout.write(`PixieCore shard profile: ${profilePath}\n`);
  const warning = createTestShardEstimateWarning(profile);
  if (warning) process.stderr.write(warning);
}

/** Adds the final TAP counters from one shard to the aggregate summary. */
function addTapTotals(summary, output) {
  const value = { ...summary };
  for (const key of ['tests', 'pass', 'fail', 'skipped']) {
    const matches = [...output.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gmu'))];
    const finalMatch = matches.at(-1);
    if (finalMatch) value[key] += Number(finalMatch[1]);
  }
  return value;
}

/** Determines whether this module is the invoked runner entry point. */
function isMainModule() {
  return process.argv[1] !== undefined
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

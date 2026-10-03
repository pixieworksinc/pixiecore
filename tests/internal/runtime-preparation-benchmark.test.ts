import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL(
  '../../scripts/benchmark-runtime-preparation.mjs',
  import.meta.url,
));

test('runtime preparation benchmark emits value-free cache and timing measurements', async () => {
  const result = await runBenchmark('--iterations=4');
  assert.equal(result.code, 0, result.stderr);
  const artifact = JSON.parse(result.stdout) as {
    schema: string;
    iterations: number;
    cold_ms: number;
    warm_total_ms: number;
    warm_average_ms: number;
    blueprint_cache: {
      capacity: number;
      entries: number;
      hits: number;
      misses: number;
      coalesced: number;
      evictions: number;
    };
  };
  assert.equal(artifact.schema, 'pixiecore.runtime-preparation-benchmark/v1');
  assert.equal(artifact.iterations, 4);
  assert.ok(artifact.cold_ms >= 0);
  assert.ok(artifact.warm_total_ms >= 0);
  assert.equal(artifact.warm_average_ms, artifact.warm_total_ms / 4);
  assert.deepEqual(artifact.blueprint_cache, {
    capacity: 64,
    entries: 1,
    hits: 4,
    misses: 1,
    coalesced: 0,
    evictions: 0,
  });
  assert.doesNotMatch(result.stdout, /greeting|fixture|warm-/u);
});

test('runtime preparation benchmark rejects unsafe iteration counts', async () => {
  const result = await runBenchmark('--iterations=0');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /iterations must be an integer/u);
});

function runBenchmark(argument: string): Promise<{
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--import',
      'tsx',
      script,
      argument,
    ], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => resolve({ code, stdout, stderr }));
  });
}

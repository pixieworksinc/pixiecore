import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const RUNNER_PATH = fileURLToPath(new URL('../../scripts/run-stability.mjs', import.meta.url));
const PROBE_PATH = fileURLToPath(new URL('../fixtures/stability-probe.mjs', import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROBE_PREFIX = 'PIXIECORE_STABILITY_PROBE ';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const data = testData('stability runner');

test('stability runner generates one fresh seed for every successful run', async () => {
  const result = await runStability(2, ['--mode=success']);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  const records = probeRecords(result.stdout);
  assert.equal(records.length, 2);
  assert.match(records[0]!.seed, UUID_PATTERN);
  assert.match(records[1]!.seed, UUID_PATTERN);
  assert.notEqual(records[0]!.seed, records[1]!.seed);
  assert.match(result.stdout, /PixieCore stability check passed \(2 independent runs\)/);
});

test('stability runner classifies a same-seed failure as reproducible', async () => {
  const result = await runStability(1, ['--mode=reproducible']);

  assert.equal(result.code, 1);
  const records = probeRecords(result.stdout);
  assert.equal(records.length, 2);
  assert.equal(records[0]!.seed, records[1]!.seed);
  assert.match(result.stderr, /PixieCore stability classification: seed-reproducible failure/);
  assert.match(result.stderr, new RegExp(`TEST_SEED=${records[0]!.seed}`));
});

test('stability runner classifies a passing same-seed replay as non-seed nondeterminism', async () => {
  await withTempDirectory(async directory => {
    const state = `${directory}/${data.text('transient state', 'state')}`;
    const result = await runStability(1, ['--mode=transient', `--state=${state}`]);

    assert.equal(result.code, 1);
    const records = probeRecords(result.stdout);
    assert.equal(records.length, 2);
    assert.equal(records[0]!.seed, records[1]!.seed);
    assert.match(result.stderr, /PixieCore stability classification: non-seed nondeterminism/);
  }, 'pixiecore-stability-test-');
});

interface StabilityResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function runStability(
  runs: number,
  probeArguments: readonly string[],
): Promise<StabilityResult> {
  const environment = { ...process.env };
  delete environment.TEST_SEED;
  delete environment.TEST_STABILITY_RUNS;
  return await new Promise<StabilityResult>((resolve, reject) => {
    const child = spawn(process.execPath, [
      RUNNER_PATH,
      `--runs=${runs}`,
      '--',
      process.execPath,
      PROBE_PATH,
      ...probeArguments,
    ], {
      cwd: REPOSITORY_ROOT,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

function probeRecords(stdout: string): Array<{ mode: string; seed: string }> {
  return stdout.split(/\r?\n/)
    .filter(line => line.startsWith(PROBE_PREFIX))
    .map(line => JSON.parse(line.slice(PROBE_PREFIX.length)) as { mode: string; seed: string });
}

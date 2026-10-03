import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { testData } from '../helpers/test-data.js';

const RUNNER_PATH = fileURLToPath(new URL('../../scripts/run-tests.mjs', import.meta.url));
const PROBE_PATH = fileURLToPath(new URL('../fixtures/test-seed-probe.mjs', import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROBE_PREFIX = 'PIXIECORE_TEST_SEED_PROBE ';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const data = testData('internal test runner');

interface RunnerResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface ProbeRecord {
  readonly seed: string | null;
  readonly arguments: readonly string[];
}

test('runner generates a fresh seed per invocation and propagates it to the child', async () => {
  const first = await runRunner();
  const second = await runRunner();

  assertSuccessful(first);
  assertSuccessful(second);
  const firstSeed = generatedSeed(first.stdout);
  const secondSeed = generatedSeed(second.stdout);
  assert.match(firstSeed, UUID_PATTERN);
  assert.match(secondSeed, UUID_PATTERN);
  assert.notEqual(firstSeed, secondSeed);
  assert.deepEqual(probeRecord(first.stdout), { seed: firstSeed, arguments: [] });
  assert.deepEqual(probeRecord(second.stdout), { seed: secondSeed, arguments: [] });
});

test('runner preserves an explicit seed and all child arguments', async () => {
  const seed = data.text('explicit child seed', 'seed');
  const label = `${data.text('forwarded argument', 'argument')} with spaces`;
  const childArguments = ['--label', label];

  const result = await runRunner(seed, childArguments);

  assertSuccessful(result);
  assert.match(result.stdout, new RegExp(
    `^PixieCore test seed: ${escapeRegExp(seed)} \\(from TEST_SEED\\)$`,
    'm',
  ));
  assert.deepEqual(probeRecord(result.stdout), {
    seed,
    arguments: childArguments,
  });
});

test('runner preserves a failing exit code and prints the exact scoped replay command', async () => {
  const seed = data.text('failing child seed', 'seed');
  const exitCode = data.integer('failing child exit code', 2, 125);
  const label = `${data.text('failing forwarded argument', 'argument')} with spaces`;
  const childArguments = ['--exit-code', String(exitCode), '--label', label];

  const result = await runRunner(seed, childArguments);

  assert.equal(result.code, exitCode);
  assert.equal(result.signal, null);
  assert.deepEqual(probeRecord(result.stdout), {
    seed,
    arguments: childArguments,
  });
  assert.equal(
    result.stderr,
    `Test run failed. Reproduce with ${replayCommand(seed, [PROBE_PATH, ...childArguments])}\n`,
  );
});

async function runRunner(
  seed?: string,
  childArguments: readonly string[] = [],
): Promise<RunnerResult> {
  const environment = { ...process.env };
  if (seed === undefined) delete environment.TEST_SEED;
  else environment.TEST_SEED = seed;

  return await new Promise<RunnerResult>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [RUNNER_PATH, PROBE_PATH, ...childArguments],
      {
        cwd: REPOSITORY_ROOT,
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function assertSuccessful(result: RunnerResult): void {
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
}

function generatedSeed(stdout: string): string {
  const match = stdout.match(
    /^PixieCore test seed: (.+) \(generated; rerun with TEST_SEED=<seed>\)$/m,
  );
  assert.ok(match, `Generated seed line was missing from stdout:\n${stdout}`);
  return match[1]!;
}

function probeRecord(stdout: string): ProbeRecord {
  const line = stdout.split(/\r?\n/).find(candidate => candidate.startsWith(PROBE_PREFIX));
  assert.ok(line, `Seed probe line was missing from stdout:\n${stdout}`);
  const parsed: unknown = JSON.parse(line.slice(PROBE_PREFIX.length));
  assert.ok(parsed && typeof parsed === 'object');
  const record = parsed as { seed?: unknown; arguments?: unknown };
  assert.ok(record.seed === null || typeof record.seed === 'string');
  assert.ok(Array.isArray(record.arguments));
  assert.ok(record.arguments.every(argument => typeof argument === 'string'));
  return record as ProbeRecord;
}

function replayCommand(seed: string, childArguments: readonly string[]): string {
  return [
    `TEST_SEED=${shellToken(seed)}`,
    shellToken(process.execPath),
    shellToken(RUNNER_PATH),
    ...childArguments.map(shellToken),
  ].join(' ');
}

function shellToken(value: string): string {
  if (/^[A-Za-z0-9_./:=+,@%-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

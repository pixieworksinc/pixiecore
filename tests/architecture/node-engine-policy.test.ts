/** Prevents development engines from silently replacing the consumer runtime floor. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';
import { nodeEngineErrors, type LockedEngines, type NodePolicy } from '../../scripts/ci/node-engines.mjs';

const policy = await json<NodePolicy>('scripts/ci/node-policy.json');
const lockfile = await json<LockedEngines>('package-lock.json');
const manifest = await json<{ engines: { node: string }; scripts: { prepack: string } }>('package.json');
const ci = parse(await readFile('.github/workflows/ci.yml', 'utf8')) as Workflow;

test('lockfile engines support both documented development minima and the unchanged runtime floor', () => {
  assert.equal(policy.runtimeMinimum, '22.13.0');
  assert.equal(manifest.engines.node, `>=${policy.runtimeMinimum}`);
  assert.match(manifest.scripts.prepack, /^npm run check:node-engines &&/u);
  for (const version of policy.developmentMinimums) {
    assert.deepEqual(nodeEngineErrors(policy, lockfile, version), []);
  }
  assert.ok(nodeEngineErrors(policy, lockfile, policy.runtimeMinimum).some(error =>
    error.includes('Development Node')));
});

test('engine validation catches newly incompatible development and production dependencies', () => {
  const fixture: LockedEngines = {
    packages: {
      '': { engines: { node: manifest.engines.node } },
      'node_modules/development-fixture': { dev: true, engines: { node: '>=26' } },
      'node_modules/production-fixture': { engines: { node: '>=24' } },
    },
  };
  const errors = nodeEngineErrors(policy, fixture, '24.15.0');
  assert.ok(errors.some(error => error.includes('development-fixture')));
  assert.ok(errors.some(error => error.includes('production-fixture') && error.includes('22.13.0')));
  assert.ok(nodeEngineErrors(policy, { packages: { '': { engines: { node: '>=24' } } } }, '24.15.0')
    .includes('Locked package runtime floor does not match Node policy'));
});

test('CI installs and documents on development Node before running both complete runtime lanes', () => {
  assert.deepEqual(ci.jobs.verify.strategy?.matrix?.['node-version'], [policy.runtimeMinimum, '24']);
  assert.equal(ci.jobs.verify.env?.npm_config_engine_strict, 'true');
  assertRuntimeSteps(ci.jobs.verify.steps);
  assert.equal(namedStep(ci.jobs.verify.steps, 'Run offline test suite').run, 'npm test');
  assert.equal(namedStep(ci.jobs.verify.steps, 'Enforce coverage floor').if, "matrix.node-version == '24'");
});

test('runtime separation rejects unsupported installs and repacking after the Node switch', () => {
  const steps = structuredClone(ci.jobs.verify.steps);
  namedStep(steps, 'Set up development Node.js').with!['node-version'] = policy.runtimeMinimum;
  assert.throws(() => assertRuntimeSteps(steps));
  const repack = structuredClone(ci.jobs.verify.steps);
  namedStep(repack, 'Verify packed artifact').run = 'npm run verify:package';
  assert.throws(() => assertRuntimeSteps(repack));
  const lateLint = structuredClone(ci.jobs.verify.steps);
  lateLint.push({ name: 'Unsupported late lint', run: 'npm run check:source-docs' });
  assert.throws(() => assertRuntimeSteps(lateLint));
});

test('release and stability installations enforce development engines without suppressing errors', async () => {
  const candidate = parse(await readFile('.github/workflows/release-candidate.yml', 'utf8')) as Workflow;
  for (const job of [ci.jobs.stability, candidate.jobs.build]) {
    assert.equal(job.env?.npm_config_engine_strict, 'true');
    assert.equal(namedStep(job.steps, 'Set up Node.js').with?.['node-version'], '24');
    assert.equal(namedStep(job.steps, 'Install locked dependencies').run, 'npm ci');
  }
  assert.equal(namedStep(candidate.jobs.build.steps, 'Check Node engine policy').run, 'npm run check:node-engines');
  const verifier = await readFile('scripts/verify-package.mjs', 'utf8');
  assert.match(verifier, /'install',\s*'--engine-strict'/u);
});

test('entry-point documentation matches the machine-readable Node policy', async () => {
  for (const path of ['README.md', 'CONTRIBUTING.md', 'docs/guides/node-compatibility.md']) {
    const source = await readFile(path, 'utf8');
    assert.ok(source.includes(policy.developmentRange), `${path}: development range drift`);
    assert.ok(source.includes(policy.runtimeMinimum), `${path}: runtime floor drift`);
    assert.match(source, /npm ci --engine-strict/u);
  }
});

/** Validates the tooling/runtime boundary rather than only checking job labels. */
function assertRuntimeSteps(steps: Step[]): void {
  const setup = steps.indexOf(namedStep(steps, 'Set up development Node.js'));
  const install = steps.indexOf(namedStep(steps, 'Install locked dependencies'));
  const engines = steps.indexOf(namedStep(steps, 'Check Node engine policy'));
  const lint = steps.indexOf(namedStep(steps, 'Check source and API documentation'));
  const pack = steps.indexOf(namedStep(steps, 'Build and pack runtime candidate'));
  const runtime = steps.indexOf(namedStep(steps, 'Select tested runtime Node.js'));
  assert.equal(namedStep(steps, 'Set up development Node.js').with?.['node-version'], '24');
  assert.equal(namedStep(steps, 'Install locked dependencies').run, 'npm ci');
  assert.equal(namedStep(steps, 'Check Node engine policy').run, 'npm run check:node-engines');
  assert.ok(setup < install && install < engines && engines < lint && lint < pack && pack < runtime);
  assert.equal(namedStep(steps, 'Select tested runtime Node.js').with?.['node-version'], '${{ matrix.node-version }}');
  assert.match(namedStep(steps, 'Build and pack runtime candidate').run ?? '', /npm run prepack &&.*prepare:release-artifact/u);
  const laterCommands = steps.slice(runtime + 1).map(step => step.run ?? '').join('\n');
  assert.doesNotMatch(laterCommands, /npm ci|npm pack|npm run (?:prepack|check:source-docs|check:api-docs)/u);
  const verify = namedStep(steps, 'Verify packed artifact').run ?? '';
  assert.match(verify, /--artifact-directory=runtime-candidate/u);
  assert.match(verify, /--source-revision="\$GITHUB_SHA"/u);
  assert.match(verify, /--version=/u);
}

/** Returns a required step so a deleted gate cannot pass by omission. */
function namedStep(steps: Step[], name: string): Step {
  const step = steps.find(candidate => candidate.name === name);
  assert.ok(step, `Missing workflow step: ${name}`);
  return step;
}

/** Reads policy fixtures without invoking installation scripts. */
async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

interface Workflow {
  jobs: Record<'verify' | 'stability' | 'build', {
    steps: Step[];
    env?: Record<string, string>;
    strategy?: { matrix?: Record<string, string[]> };
  }>;
}

interface Step {
  name: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
}

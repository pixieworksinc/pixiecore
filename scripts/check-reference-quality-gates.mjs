import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const libraryRoot = join(repositoryRoot, 'examples', 'blueprints');
const catalogPath = join(libraryRoot, 'catalog.yaml');
const gatesPath = join(libraryRoot, 'quality-gates.yaml');

const [catalog, policy] = await Promise.all([
  readYaml(catalogPath),
  readYaml(gatesPath),
]);
if (policy.schema !== 'pixiecore.reference-quality-gates/v1') {
  throw new TypeError('Reference quality gate schema must be pixiecore.reference-quality-gates/v1');
}
if (!Array.isArray(policy.gates) || policy.gates.length === 0) {
  throw new TypeError('Reference quality gates must contain at least one gate');
}
if (!Array.isArray(catalog.units)) throw new TypeError('Blueprint catalog units must be an array');

const activeIds = catalog.units
  .filter(unit => record(unit).status === 'active')
  .map(unit => nonBlank(record(unit).id, 'catalog unit id'))
  .sort();
const gateIds = policy.gates.map(gate => nonBlank(record(gate).id, 'gate id')).sort();
if (new Set(gateIds).size !== gateIds.length) throw new TypeError('Quality gate IDs must be unique');
if (JSON.stringify(gateIds) !== JSON.stringify(activeIds)) {
  throw new TypeError('Reference quality gates must cover every active Blueprint exactly once');
}

const tests = [];
for (const rawGate of policy.gates) {
  const gate = record(rawGate);
  const id = nonBlank(gate.id, 'gate id');
  assertThreshold(gate.minimum_accuracy, 1, `${id} minimum_accuracy`);
  assertThreshold(gate.maximum_failures, 0, `${id} maximum_failures`);
  assertThreshold(gate.maximum_errors, 0, `${id} maximum_errors`);
  const minimumCases = positiveInteger(gate.minimum_cases, `${id} minimum_cases`);
  const datasetPath = await containedPath(nonBlank(gate.dataset, `${id} dataset`));
  const testPath = await containedPath(nonBlank(gate.test, `${id} test`));
  const dataset = await readYaml(datasetPath);
  if (!Array.isArray(dataset.cases) || dataset.cases.length < minimumCases) {
    throw new TypeError(`${id} dataset must contain at least ${minimumCases} cases`);
  }
  const unit = catalog.units.map(record).find(candidate => candidate.id === id);
  if (!unit) throw new TypeError(`Unknown quality gate Blueprint: ${id}`);
  if (record(dataset.blueprint).version !== unit.version) {
    throw new TypeError(`${id} dataset Blueprint version must match the catalog pin`);
  }
  tests.push(testPath);
}

const seed = process.env.TEST_SEED?.trim() || randomUUID();
console.log(`PixieCore quality gate seed: ${seed} (rerun with TEST_SEED=${seed})`);
await runTests(tests, seed);
console.log(`Reference quality gates passed: ${tests.length} Blueprints at 100% canonical accuracy.`);

async function runTests(paths, seed) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--test', '--import', 'tsx', ...paths], {
      cwd: repositoryRoot,
      env: { ...process.env, TEST_SEED: seed },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Reference quality gates terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`Reference quality gates failed with exit code ${code}`));
      else resolvePromise();
    });
  });
}

async function containedPath(declaredPath) {
  if (isAbsolute(declaredPath)) throw new TypeError('Quality gate paths must be relative');
  const candidate = resolve(libraryRoot, declaredPath);
  const path = relative(libraryRoot, candidate);
  if (path === '..' || path.startsWith('../') || isAbsolute(path)) {
    throw new TypeError(`Quality gate path escapes the Blueprint library: ${declaredPath}`);
  }
  await access(candidate);
  const resolved = await realpath(candidate);
  const resolvedPath = relative(await realpath(libraryRoot), resolved);
  if (resolvedPath === '..' || resolvedPath.startsWith('../') || isAbsolute(resolvedPath)) {
    throw new TypeError(`Quality gate path resolves outside the Blueprint library: ${declaredPath}`);
  }
  return resolved;
}

async function readYaml(path) {
  return record(YAML.parse(await readFile(path, 'utf8')));
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Quality gate data must contain objects');
  }
  return value;
}

function nonBlank(value, name) {
  if (typeof value === 'string' && value.trim()) return value;
  throw new TypeError(`${name} must be non-blank`);
}

function positiveInteger(value, name) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  throw new TypeError(`${name} must be a positive safe integer`);
}

function assertThreshold(actual, expected, name) {
  if (actual === expected) return;
  throw new TypeError(`${name} must be ${expected}`);
}

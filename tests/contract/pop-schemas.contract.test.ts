import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';

const schemaFiles = {
  blueprint: '../../schemas/pop.blueprint-0.1.schema.json',
  dataset: '../../schemas/pop.evaluation-dataset-0.1.schema.json',
  result: '../../schemas/pop.evaluation-result-0.1.schema.json',
  package: '../../schemas/pop.blueprint-package-0.1.schema.json',
} as const;

const schemas = Object.fromEntries(await Promise.all(
  Object.entries(schemaFiles).map(async ([name, path]) => [
    name,
    JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')) as object,
  ]),
));

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateBlueprint = ajv.compile(schemas.blueprint);
const validateDataset = ajv.compile(schemas.dataset);
const validateResult = ajv.compile(schemas.result);
const validatePackage = ajv.compile(schemas.package);

const blueprint = {
  schema: 'pop.blueprint/0.1',
  id: 'example.date_converter',
  name: 'Convert a written date',
  version: '1.0.0',
  role: 'converter',
  instructions: 'Convert the supplied date to the requested representation.',
  inputs: [
    {
      name: 'date',
      required: true,
      schema: { type: 'string' },
    },
  ],
  input_schema: {
    type: 'object',
    required: ['date'],
    properties: { date: { type: 'string' } },
  },
  output_schema: {
    type: 'object',
    required: ['date'],
    properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
  },
};

const dataset = {
  schema: 'pop.evaluation-dataset/0.1',
  name: 'example.date_converter.cases',
  version: '1.0.0',
  blueprint: { id: 'example.date_converter', version: '1.0.0' },
  tags: ['converter', 'date'],
  cases: [
    {
      id: 'written-date',
      inputs: { date: '4 February 2026' },
      expected_output: { date: '2026-02-04' },
      comparison: { mode: 'fields', pointers: ['/date'] },
    },
  ],
};

const digest = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const result = {
  schema: 'pop.evaluation-result/0.1',
  dataset: { name: 'example.date_converter.cases', version: '1.0.0', sha256: digest },
  blueprint: { id: 'example.date_converter', version: '1.0.0', sha256: digest },
  run: {
    id: 'portable-run-1',
    seed: 'replay-seed',
    started_at: '2026-02-04T01:02:03Z',
    completed_at: '2026-02-04T01:02:04.125Z',
    executor: 'example.runtime/1.0.0',
  },
  summary: {
    total: 1,
    schema_passed: 1,
    semantic_passed: 1,
    failed: 0,
    errors: 0,
  },
  cases: [
    {
      id: 'written-date',
      status: 'passed',
      schema_valid: true,
      semantic_valid: true,
      duration_ms: 12.5,
      diagnostics: [],
    },
  ],
  reproduction: { seed: 'replay-seed', parameters: { mode: 'offline' } },
};

const packageMetadata = {
  schema: 'pop.blueprint-package/0.1',
  package: {
    name: 'example.date_blueprints',
    namespace: 'example.date',
    version: '1.0.0',
    license: 'Apache-2.0',
  },
  compatibility: { pop: '^0.1.0' },
  blueprints: [
    { id: 'example.date_converter', version: '1.0.0', path: 'blueprints/date.json' },
  ],
  files: {
    'blueprints/date.json': 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  },
};

test('POP 0.1 schemas compile and accept canonical portable artifacts', () => {
  assert.equal(validateBlueprint(blueprint), true, formatErrors(validateBlueprint.errors));
  assert.equal(validateDataset(dataset), true, formatErrors(validateDataset.errors));
  assert.equal(validateResult(result), true, formatErrors(validateResult.errors));
  assert.equal(validatePackage(packageMetadata), true, formatErrors(validatePackage.errors));
});

test('POP Blueprint schema requires a stable ID and object output contract', () => {
  const localOnly = structuredClone(blueprint) as Record<string, unknown>;
  delete localOnly.id;
  assert.equal(validateBlueprint(localOnly), false);

  const scalarOutput = structuredClone(blueprint);
  scalarOutput.output_schema.type = 'string';
  assert.equal(validateBlueprint(scalarOutput), false);

  const reservedId = structuredClone(blueprint);
  reservedId.id = 'pop.internal';
  assert.equal(validateBlueprint(reservedId), false);
});

test('POP dataset references Blueprint identity instead of a local path', () => {
  const localPath = structuredClone(dataset) as Record<string, unknown>;
  localPath.blueprint = { path: './date.yaml', version: '1.0.0' };
  assert.equal(validateDataset(localPath), false);

  const incompleteTolerance = structuredClone(dataset);
  incompleteTolerance.cases[0]!.comparison = {
    mode: 'numeric_tolerance',
    pointers: ['/date'],
  } as never;
  assert.equal(validateDataset(incompleteTolerance), false);
});

test('POP result separates structural and semantic outcomes without output values', () => {
  const mergedOutcome = structuredClone(result) as Record<string, unknown>;
  mergedOutcome.summary = { total: 1, passed: 1, failed: 0, errors: 0 };
  assert.equal(validateResult(mergedOutcome), false);

  const leakedValue = structuredClone(result) as Record<string, unknown>;
  const cases = leakedValue.cases as Array<Record<string, unknown>>;
  cases[0]!.actual_output = { date: '2026-02-04' };
  assert.equal(validateResult(leakedValue), false);
});

test('POP package schema rejects executable entries and escaping paths', () => {
  const executable = structuredClone(packageMetadata) as Record<string, unknown>;
  executable.entry = './index.js';
  assert.equal(validatePackage(executable), false);

  const escaping = structuredClone(packageMetadata);
  escaping.blueprints[0]!.path = '../date.json';
  assert.equal(validatePackage(escaping), false);
});

test('POP 0.1 schemas are implementation and local-filesystem independent', () => {
  for (const schema of Object.values(schemas)) {
    const serialized = JSON.stringify(schema);
    assert.doesNotMatch(serialized, /PixieCore|TypeScript|PromptRuntime|node_modules|src\//u);
    assert.doesNotMatch(serialized, /"path"\s*:\s*\{[^}]*"const"/u);
  }
});

function formatErrors(errors: unknown): string {
  return JSON.stringify(errors, null, 2);
}

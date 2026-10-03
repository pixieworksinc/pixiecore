import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { testData } from '../helpers/test-data.js';

const schemaPath = fileURLToPath(new URL(
  '../../schemas/pixiecore.blueprint-eval-result-v1.schema.json',
  import.meta.url,
));
const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const data = testData('evaluation result schema');

test('published evaluation result schema accepts passed, failed, and error cases', () => {
  const artifact = resultArtifact();
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors));
});

test('published evaluation result schema rejects missing evidence and unversioned results', () => {
  const artifact = resultArtifact();
  const invalid = [
    { ...artifact, schema: 'pixiecore.blueprint-eval-result/v2' },
    { ...artifact, unexpected: true },
    { ...artifact, replay_command: '   ' },
    { ...artifact, dataset: { ...artifact.dataset, sha256: 'not-a-hash' } },
    { ...artifact, run: { ...artifact.run, seed: '' } },
    { ...artifact, cases: [{ ...artifact.cases[0], provider_usage: [{
      ...artifact.cases[0]!.provider_usage[0], input_tokens: -1,
    }] }] },
    { ...artifact, cases: [{ ...artifact.cases[0], actual_output: undefined }] },
    { ...artifact, cases: [{ ...artifact.cases[2], error: undefined }] },
  ];
  for (const candidate of invalid) {
    assert.equal(validate(candidate), false, JSON.stringify(candidate));
  }
});

function resultArtifact() {
  const seed = data.text('seed', 'seed');
  return {
    schema: 'pixiecore.blueprint-eval-result/v1',
    dataset: {
      name: data.text('dataset name', 'dataset'),
      version: '1.0.0',
      path: 'evaluations/dataset.yaml',
      sha256: 'a'.repeat(64),
    },
    blueprint: {
      path: 'blueprints/fixture.yaml',
      version: '1.0',
      sha256: 'b'.repeat(64),
    },
    run: {
      id: '00000000-0000-4000-8000-000000000000',
      seed,
      seed_scope: 'runner',
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T00:00:01.000Z',
      provider: data.text('provider', 'provider'),
      model: data.text('model', 'model'),
      temperature: 0,
    },
    summary: { total: 3, passed: 1, failed: 1, errors: 1 },
    cases: [
      {
        id: 'passed', tags: ['ordinary'], status: 'passed', duration_ms: 1,
        provider_usage: [providerUsage()],
        actual_output: { value: 'expected' }, differences: [],
      },
      {
        id: 'failed', tags: ['boundary'], status: 'failed', duration_ms: 2,
        provider_usage: [providerUsage()],
        actual_output: { value: 'actual' },
        differences: [{
          pointer: '/value', reason: 'not_equal', expected: 'expected', actual: 'actual',
        }],
      },
      {
        id: 'error', tags: ['failure'], status: 'error', duration_ms: 3,
        provider_usage: [],
        error: { name: 'Error', message: data.text('error message', 'failure') },
      },
    ],
    replay_command: `pixiecore blueprint eval evaluations/dataset.yaml --seed=${seed}`,
  };
}

function providerUsage() {
  return {
    provider: data.text('usage provider', 'provider'),
    model: data.text('usage model', 'model'),
    calls: 1,
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15,
    estimated_cost: { currency: 'USD', amount: 0.000012 },
    cost_status: 'calculated',
    pricing: {
      currency: 'USD',
      input_per_million_tokens: 0.4,
      output_per_million_tokens: 1.6,
      source: 'https://pricing.example/evaluation',
      effective_at: '2026-08-26T00:00:00.000Z',
    },
  };
}

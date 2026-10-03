import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';

const manifestPath = resolve('examples/benchmarks/openai-blueprint-run-manifest.json');
const schemaPath = resolve('examples/benchmarks/openai-blueprint-run-manifest-v1.schema.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RunManifest;
const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

test('OpenAI Blueprint run manifest fixes the 8-role 71-case matrix', () => {
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  assert.equal(manifest.datasets.length, 8);
  assert.equal(new Set(manifest.datasets.map(dataset => dataset.role)).size, 8);
  assert.equal(sum(manifest.datasets.map(dataset => dataset.case_count)), 71);
  assert.deepEqual(manifest.phases.map(phase => [phase.id, phase.max_calls]), [
    ['canary', 1],
    ['baseline', 71],
    ['repeated', 213],
  ]);
});

test('manifest dataset counts, comparison modes, and attachments match repository fixtures', async () => {
  for (const dataset of manifest.datasets) {
    const document = parse(await readFile(resolve(dataset.path), 'utf8')) as EvaluationDataset;
    assert.equal(document.cases.length, dataset.case_count, `${dataset.id}: case count drift`);
    assert.deepEqual(
      [...new Set(document.cases.map(item => item.comparison.mode))].sort(),
      [...dataset.comparison_modes].sort(),
      `${dataset.id}: comparison mode drift`,
    );
    const caseIds = new Set(document.cases.map(item => item.id));
    for (const attachment of dataset.attachments) {
      assert.equal(caseIds.has(attachment.case_id), true, `${attachment.case_id}: missing case`);
      await access(resolve(attachment.path));
    }
  }
});

test('manifest keeps credentials out and requires explicit remote authorization', () => {
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /api[_-]?key|bearer|sk-proj/iu);
  assert.equal(manifest.endpoint, 'https://api.openai.com/v1');
  assert.equal(manifest.data_policy.sensitivity, 'synthetic');
  assert.equal(manifest.data_policy.remote_transmission, 'allowed-after-explicit-confirmation');
  for (const phase of manifest.phases) {
    assert.ok(phase.budget_usd > 0, `${phase.id}: missing budget`);
    assert.ok(phase.artifact_directory, `${phase.id}: missing artifact directory`);
  }
});

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

interface RunManifest {
  readonly endpoint: string;
  readonly data_policy: Readonly<{
    sensitivity: string;
    remote_transmission: string;
  }>;
  readonly datasets: readonly Readonly<{
    id: string;
    role: string;
    path: string;
    case_count: number;
    comparison_modes: readonly string[];
    attachments: readonly Readonly<{ case_id: string; path: string }>[];
  }>[];
  readonly phases: readonly Readonly<{
    id: string;
    max_calls: number;
    budget_usd: number;
    artifact_directory: string;
  }>[];
}

interface EvaluationDataset {
  readonly cases: readonly Readonly<{
    id: string;
    comparison: Readonly<{ mode: string }>;
  }>[];
}

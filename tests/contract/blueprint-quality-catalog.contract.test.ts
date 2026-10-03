import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import YAML from 'yaml';

const libraryRoot = join(process.cwd(), 'examples', 'blueprints');
const schema = JSON.parse(await readFile(
  join(process.cwd(), 'schemas', 'pixiecore.blueprint-quality-catalog-v1.schema.json'),
  'utf8',
)) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

interface Measurement {
  readonly kind: 'offline_contract' | 'remote_provider';
  readonly provider: string;
  readonly model: string;
  readonly dataset: { readonly path: string; readonly version: string };
  readonly score: number;
  readonly passed_cases: number;
  readonly total_cases: number;
  readonly runs: number;
  readonly evidence: string;
  readonly benchmark_artifact?: string;
  readonly evidence_status?: 'current' | 'historical';
}

interface QualityUnit {
  readonly id: string;
  readonly blueprint_version: string;
  readonly license: string;
  readonly measurements: readonly Measurement[];
}

interface QualityCatalog {
  readonly schema: string;
  readonly version: string;
  readonly units: readonly QualityUnit[];
}

interface LibraryCatalog {
  readonly units: readonly {
    readonly id: string;
    readonly version: string;
    readonly status: string;
  }[];
}

test('quality catalog covers every active Blueprint with deterministic offline evidence', async () => {
  const [quality, library] = await Promise.all([
    readYaml<QualityCatalog>('quality-catalog.yaml'),
    readYaml<LibraryCatalog>('catalog.yaml'),
  ]);
  assert.equal(validate(quality), true, JSON.stringify(validate.errors));

  const active = library.units.filter(unit => unit.status === 'active');
  assert.deepEqual(
    quality.units.map(unit => unit.id).sort(),
    active.map(unit => unit.id).sort(),
  );

  for (const unit of quality.units) {
    const libraryUnit = active.find(candidate => candidate.id === unit.id);
    assert.ok(libraryUnit, `${unit.id}: active library entry`);
    assert.equal(unit.blueprint_version, libraryUnit.version, `${unit.id}: Blueprint version`);
    assert.equal(unit.license, 'Apache-2.0', `${unit.id}: fixture license`);
    assert.equal(unit.measurements.length, 1, `${unit.id}: evidence count`);

    const measurement = unit.measurements[0]!;
    assert.equal(measurement.kind, 'offline_contract', `${unit.id}: evidence kind`);
    assert.equal(measurement.provider, 'pixiecore-fixture', `${unit.id}: provider identity`);
    assert.equal(measurement.model, 'declared-expected-output', `${unit.id}: model identity`);
    assert.equal(measurement.runs, 1, `${unit.id}: run count`);
    assert.equal(measurement.score, 1, `${unit.id}: canonical accuracy`);

    const dataset = await readYaml<{
      readonly version: string;
      readonly cases: readonly unknown[];
    }>(measurement.dataset.path);
    assert.equal(measurement.dataset.version, dataset.version, `${unit.id}: dataset version`);
    assert.equal(measurement.total_cases, dataset.cases.length, `${unit.id}: total cases`);
    assert.equal(measurement.passed_cases, dataset.cases.length, `${unit.id}: passed cases`);
    await readFile(join(libraryRoot, measurement.evidence), 'utf8');
  }
});

test('remote quality claims require a benchmark artifact', async () => {
  const quality = await readYaml<QualityCatalog>('quality-catalog.yaml');
  const candidate = structuredClone(quality) as unknown as {
    units: Array<{ measurements: Measurement[] }>;
  };
  candidate.units[0]!.measurements[0] = {
    ...candidate.units[0]!.measurements[0]!,
    kind: 'remote_provider',
    provider: 'provider-under-test',
    model: 'model-under-test',
  };
  assert.equal(validate(candidate), false);
  assert.ok(validate.errors?.some(error => error.keyword === 'required'));
});

async function readYaml<T>(relativePath: string): Promise<T> {
  return YAML.parse(await readFile(join(libraryRoot, relativePath), 'utf8')) as T;
}

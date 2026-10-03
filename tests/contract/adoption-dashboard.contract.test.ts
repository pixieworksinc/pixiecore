import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import YAML from 'yaml';
// @ts-expect-error Repository dashboard generator is an executable JavaScript module.
import { checkAdoptionDashboard, createAdoptionDashboard } from '../../scripts/generate-adoption-dashboard.mjs';

const root = process.cwd();
const schema = JSON.parse(await readFile(
  join(root, 'schemas', 'pixiecore.adoption-snapshot-v1.schema.json'),
  'utf8',
)) as object;
const validate = new Ajv2020({
  allErrors: true,
  strict: true,
  formats: {
    'date-time': {
      type: 'string',
      validate: (value: string) => Number.isFinite(Date.parse(value)),
    },
  },
}).compile(schema);

test('monthly adoption snapshot validates and reports only evidence-backed values', async () => {
  const snapshot = YAML.parse(await readFile(
    join(root, 'adoption', 'snapshots', '2026-08.yaml'),
    'utf8',
  )) as {
    metrics: Record<string, {
      status: string;
      value: number | null;
      source: string | null;
    }>;
  };
  assert.equal(validate(snapshot), true, JSON.stringify(validate.errors));
  const library = YAML.parse(await readFile(
    join(root, 'examples', 'blueprints', 'catalog.yaml'),
    'utf8',
  )) as { units: Array<{ status: string }> };
  assert.equal(
    snapshot.metrics.published_blueprints?.value,
    library.units.filter(unit => unit.status === 'active').length,
  );
  assert.deepEqual(
    Object.entries(snapshot.metrics)
      .filter(([, metric]) => metric.status !== 'verified')
      .map(([name, metric]) => [name, metric.value, metric.source]),
    [
      ['installs', null, null],
      ['active_projects', null, null],
      ['external_contributors', null, null],
      ['case_studies', null, null],
    ],
  );
});

test('dashboard generation is current and preserves unavailable metrics as N/A', async () => {
  const dashboard = await createAdoptionDashboard();
  assert.match(dashboard, /Latest period: \*\*2026-08\*\*/);
  assert.match(dashboard, /\| Installs \| not_collected \| N\/A \| N\/A \|/);
  assert.match(dashboard, /\| Published Blueprints \| verified \| 8 \|/);
  assert.match(dashboard, /\| Case studies \| not_collected \| N\/A \| N\/A \|/);
  const packageManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    name: string;
    exports: Record<string, unknown>;
  };
  const schemaSubpath = './adoption/snapshot-schema.json';
  assert.ok(packageManifest.exports[schemaSubpath]);
  assert.ok(dashboard.includes(`\`${packageManifest.name}/${schemaSubpath.slice(2)}\``));
  assert.doesNotMatch(dashboard, /(?<!@pixieworks\/)pixiecore\/adoption\/snapshot-schema\.json/u);
  assert.equal(await checkAdoptionDashboard(), true);
});

test('snapshot schema rejects unsupported evidence claims', async () => {
  const snapshot = YAML.parse(await readFile(
    join(root, 'adoption', 'snapshots', '2026-08.yaml'),
    'utf8',
  )) as { metrics: Record<string, Record<string, unknown>> };
  const unsupported = structuredClone(snapshot);
  unsupported.metrics.installs = {
    ...unsupported.metrics.installs,
    status: 'verified',
    value: 12,
    source: null,
  };
  assert.equal(validate(unsupported), false);

  const fabricatedZero = structuredClone(snapshot);
  fabricatedZero.metrics.active_projects = {
    ...fabricatedZero.metrics.active_projects,
    value: 0,
  };
  assert.equal(validate(fabricatedZero), false);
});

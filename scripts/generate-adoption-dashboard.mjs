#!/usr/bin/env node

import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import YAML from 'yaml';

const DEFAULT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUT_RELATIVE_PATH = join('docs', 'project', 'adoption-dashboard.md');
const METRICS = [
  ['installs', 'Installs'],
  ['active_projects', 'Active projects'],
  ['external_contributors', 'External contributors'],
  ['published_blueprints', 'Published Blueprints'],
  ['case_studies', 'Case studies'],
];

export async function createAdoptionDashboard(root = DEFAULT_ROOT) {
  const repositoryRoot = resolve(root);
  const snapshotRoot = join(repositoryRoot, 'adoption', 'snapshots');
  const schema = JSON.parse(await readFile(
    join(repositoryRoot, 'schemas', 'pixiecore.adoption-snapshot-v1.schema.json'),
    'utf8',
  ));
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    formats: {
      'date-time': {
        type: 'string',
        validate: value => Number.isFinite(Date.parse(value)),
      },
    },
  });
  const validate = ajv.compile(schema);
  const snapshots = [];
  for (const filename of (await readdir(snapshotRoot)).filter(name => name.endsWith('.yaml')).sort()) {
    const snapshot = YAML.parse(await readFile(join(snapshotRoot, filename), 'utf8'));
    if (!validate(snapshot)) {
      throw new TypeError(`Invalid adoption snapshot ${filename}: ${JSON.stringify(validate.errors)}`);
    }
    if (filename !== `${snapshot.period}.yaml`) {
      throw new TypeError(`Adoption snapshot filename must match period: ${filename}`);
    }
    for (const metric of Object.values(snapshot.metrics)) {
      if (metric.status === 'verified') await access(join(repositoryRoot, metric.source));
    }
    snapshots.push(snapshot);
  }
  if (snapshots.length === 0) throw new TypeError('At least one adoption snapshot is required');
  assertUniquePeriods(snapshots);
  const latest = snapshots.at(-1);
  return renderDashboard(latest, snapshots);
}

export async function checkAdoptionDashboard(root = DEFAULT_ROOT) {
  const repositoryRoot = resolve(root);
  const expected = await createAdoptionDashboard(repositoryRoot);
  const outputPath = join(repositoryRoot, OUTPUT_RELATIVE_PATH);
  const actual = await readFile(outputPath, 'utf8').catch(() => '');
  if (actual === expected) return true;
  throw new Error(`${OUTPUT_RELATIVE_PATH} is stale; run npm run generate:adoption-dashboard`);
}

function renderDashboard(latest, snapshots) {
  const lines = [
    '# PixieCore adoption dashboard',
    '',
    'This dashboard reports only evidence-backed ecosystem metrics. A blank or',
    '`not_collected` value is not zero. PixieCore does not add product telemetry to',
    'estimate active projects, and this document must not turn unavailable data into',
    'an adoption claim.',
    '',
    `Latest period: **${latest.period}**`,
    '',
    '| Metric | Status | Value | Evidence | Note |',
    '|---|---|---:|---|---|',
  ];
  for (const [key, label] of METRICS) {
    const metric = latest.metrics[key];
    lines.push(`| ${label} | ${metric.status} | ${metric.value ?? 'N/A'} | ${
      metric.source ? `[source](../../${metric.source})` : 'N/A'
    } | ${escapeCell(metric.note)} |`);
  }
  lines.push(
    '',
    '## Monthly history',
    '',
    '| Period | Installs | Active projects | External contributors | Published Blueprints | Case studies |',
    '|---|---:|---:|---:|---:|---:|',
  );
  for (const snapshot of snapshots) {
    lines.push(`| ${snapshot.period} | ${historyValue(snapshot.metrics.installs)} | ${
      historyValue(snapshot.metrics.active_projects)
    } | ${historyValue(snapshot.metrics.external_contributors)} | ${
      historyValue(snapshot.metrics.published_blueprints)
    } | ${historyValue(snapshot.metrics.case_studies)} |`);
  }
  lines.push(
    '',
    '## Monthly update procedure',
    '',
    '1. Copy the latest YAML snapshot to `adoption/snapshots/YYYY-MM.yaml`.',
    '2. Replace a value only when its named evidence source exists and can be reviewed.',
    '3. Keep unavailable metrics `not_collected`; never infer active use from package contents.',
    '4. Run `npm run generate:adoption-dashboard` and the full project test suite.',
    '5. Review the snapshot and generated diff in the same pull request.',
    '',
    'The source schema is packaged as',
    '`@pixieworks/pixiecore/adoption/snapshot-schema.json`. Snapshot history is packaged under',
    '`adoption/snapshots`.',
    '',
  );
  return lines.join('\n');
}

function historyValue(metric) {
  return metric.status === 'verified' ? String(metric.value) : 'N/A';
}

function escapeCell(value) {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function assertUniquePeriods(snapshots) {
  const periods = snapshots.map(snapshot => snapshot.period);
  if (new Set(periods).size !== periods.length) {
    throw new TypeError('Adoption snapshot periods must be unique');
  }
}

async function main() {
  const write = process.argv.includes('--write');
  const rootIndex = process.argv.indexOf('--root');
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : DEFAULT_ROOT;
  if (!root) throw new Error('--root requires a directory');
  if (!write) {
    await checkAdoptionDashboard(root);
    console.log('Adoption dashboard is current.');
    return;
  }
  await writeFile(
    join(resolve(root), OUTPUT_RELATIVE_PATH),
    await createAdoptionDashboard(root),
    'utf8',
  );
  console.log(`Generated ${OUTPUT_RELATIVE_PATH}.`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}

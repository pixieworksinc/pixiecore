#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const DEFAULT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUT_RELATIVE_PATH = join(
  'examples',
  'blueprints',
  'catalog-site',
  'catalog.json',
);

export async function createBlueprintSearchCatalog(root = DEFAULT_ROOT) {
  const repositoryRoot = resolve(root);
  const libraryRoot = join(repositoryRoot, 'examples', 'blueprints');
  const [library, quality] = await Promise.all([
    readYaml(join(libraryRoot, 'catalog.yaml')),
    readYaml(join(libraryRoot, 'quality-catalog.yaml')),
  ]);
  assertCatalog(library, 'pixiecore.blueprint-library-catalog/v1', 'library catalog');
  assertCatalog(quality, 'pixiecore.blueprint-quality-catalog/v1', 'quality catalog');
  const qualityById = new Map(quality.units.map(unit => [unit.id, unit]));

  const units = [];
  for (const unit of [...library.units].sort((left, right) => left.id.localeCompare(right.id))) {
    if (unit.status === 'retired') continue;
    const evidence = qualityById.get(unit.id);
    if (!evidence) throw new TypeError(`Missing quality catalog entry: ${unit.id}`);
    if (!Array.isArray(unit.use_cases) || unit.use_cases.length === 0) {
      throw new TypeError(`Blueprint catalog entry requires use_cases: ${unit.id}`);
    }
    const blueprint = await readYaml(join(libraryRoot, unit.path));
    if (typeof blueprint.name !== 'string' || !blueprint.name.trim()) {
      throw new TypeError(`Blueprint requires a non-blank name: ${unit.id}`);
    }
    const measurements = evidence.measurements.map(measurement => ({
      kind: measurement.kind,
      provider: measurement.provider,
      model: measurement.model,
      score: measurement.score,
      passed_cases: measurement.passed_cases,
      total_cases: measurement.total_cases,
      runs: measurement.runs,
      dataset: measurement.dataset,
      evidence: measurement.evidence,
      ...(measurement.evidence_status === undefined
        ? {}
        : { evidence_status: measurement.evidence_status }),
      ...(measurement.benchmark_artifact === undefined
        ? {}
        : { benchmark_artifact: measurement.benchmark_artifact }),
    }));
    units.push({
      id: unit.id,
      name: blueprint.name,
      role_family: unit.role_family,
      use_cases: [...unit.use_cases],
      path: unit.path,
      version: unit.version,
      status: unit.status,
      license: evidence.license,
      schema_terms: collectSchemaTerms({
        input_schema: blueprint.input_schema,
        output_schema: blueprint.output_schema,
      }),
      providers: [...new Set(measurements
        .filter(measurement => measurement.evidence_status !== 'historical')
        .map(measurement => measurement.provider))].sort(),
      measurements,
    });
  }

  const unusedQualityIds = quality.units
    .map(unit => unit.id)
    .filter(id => !units.some(unit => unit.id === id));
  if (unusedQualityIds.length > 0) {
    throw new TypeError(`Quality entries are not searchable: ${unusedQualityIds.join(', ')}`);
  }
  return Object.freeze({
    schema: 'pixiecore.blueprint-search-catalog/v1',
    version: library.version,
    sources: Object.freeze({
      library: 'examples/blueprints/catalog.yaml',
      quality: 'examples/blueprints/quality-catalog.yaml',
    }),
    units: Object.freeze(units),
  });
}

export async function checkBlueprintSearchCatalog(root = DEFAULT_ROOT) {
  const repositoryRoot = resolve(root);
  const expected = serialize(await createBlueprintSearchCatalog(repositoryRoot));
  const outputPath = join(repositoryRoot, OUTPUT_RELATIVE_PATH);
  const actual = await readFile(outputPath, 'utf8').catch(() => '');
  if (actual === expected) return true;
  throw new Error(
    `${OUTPUT_RELATIVE_PATH} is stale; run npm run generate:blueprint-catalog-site`,
  );
}

function collectSchemaTerms(value) {
  const terms = new Set();
  visit(value, terms);
  return [...terms].sort();
}

function visit(value, terms) {
  if (typeof value === 'string') {
    if (value.trim()) terms.add(value.toLowerCase());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visit(item, terms);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    terms.add(key.toLowerCase());
    visit(item, terms);
  }
}

async function readYaml(path) {
  const value = YAML.parse(await readFile(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Expected YAML object: ${path}`);
  }
  return value;
}

function assertCatalog(value, schema, label) {
  if (value.schema !== schema || !Array.isArray(value.units)) {
    throw new TypeError(`Invalid ${label}`);
  }
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main() {
  const write = process.argv.includes('--write');
  const rootIndex = process.argv.indexOf('--root');
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : DEFAULT_ROOT;
  if (!root) throw new Error('--root requires a directory');
  if (!write) {
    await checkBlueprintSearchCatalog(root);
    console.log('Blueprint search catalog is current.');
    return;
  }
  const outputPath = join(resolve(root), OUTPUT_RELATIVE_PATH);
  await writeFile(outputPath, serialize(await createBlueprintSearchCatalog(root)), 'utf8');
  console.log(`Generated ${OUTPUT_RELATIVE_PATH}.`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}

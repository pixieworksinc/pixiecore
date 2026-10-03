import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const libraryRoot = join(process.cwd(), 'examples', 'blueprints');

interface CatalogUnit {
  readonly id: string;
  readonly role_family: string;
  readonly use_cases: readonly string[];
  readonly path: string;
  readonly version: string;
  readonly owner: string;
  readonly status: 'active' | 'deprecated' | 'retired';
  readonly introduced_in: string;
  readonly replacement: string | null;
}

interface LibraryCatalog {
  readonly schema: string;
  readonly version: string;
  readonly owner: string;
  readonly units: readonly CatalogUnit[];
}

interface BlueprintFile {
  readonly name?: unknown;
  readonly version?: unknown;
}

interface EvaluationFile {
  readonly schema?: unknown;
  readonly version?: unknown;
  readonly blueprint?: { readonly path?: unknown; readonly version?: unknown };
}

test('reference Blueprint catalog owns every unit and its complete artifact contract', async () => {
  const catalog = YAML.parse(await readFile(join(libraryRoot, 'catalog.yaml'), 'utf8')) as LibraryCatalog;
  assert.equal(catalog.schema, 'pixiecore.blueprint-library-catalog/v1');
  assert.match(catalog.version, STRICT_SEMVER);
  assert.match(catalog.owner, /\S/);
  assert.ok(catalog.units.length >= 8);

  const catalogIds = catalog.units.map(unit => unit.id);
  assert.equal(new Set(catalogIds).size, catalogIds.length, 'catalog IDs must be unique');
  const discoveredIds = await discoverUnitIds();
  const presentCatalogIds = catalog.units
    .filter(unit => unit.status !== 'retired')
    .map(unit => unit.id)
    .sort();
  assert.deepEqual(discoveredIds, presentCatalogIds);

  for (const unit of catalog.units) await assertUnitContract(unit);
});

async function assertUnitContract(unit: CatalogUnit): Promise<void> {
  const [roleFamily, unitSlug, ...extra] = unit.id.split('/');
  assert.equal(extra.length, 0, `${unit.id}: stable ID has exactly two segments`);
  assert.match(roleFamily ?? '', KEBAB_CASE, `${unit.id}: role family`);
  assert.match(unitSlug ?? '', KEBAB_CASE, `${unit.id}: unit slug`);
  assert.equal(unit.role_family, roleFamily, `${unit.id}: role family drift`);
  assert.ok(unit.use_cases.length > 0, `${unit.id}: use cases`);
  assert.equal(new Set(unit.use_cases).size, unit.use_cases.length, `${unit.id}: unique use cases`);
  for (const useCase of unit.use_cases) assert.match(useCase, /\S/, `${unit.id}: non-blank use case`);
  assert.match(unit.version, STRICT_SEMVER, `${unit.id}: Blueprint SemVer`);
  assert.match(unit.introduced_in, STRICT_SEMVER, `${unit.id}: introduced package SemVer`);
  assert.match(unit.owner, /\S/, `${unit.id}: owner`);
  assert.ok(['active', 'deprecated', 'retired'].includes(unit.status), `${unit.id}: status`);

  if (unit.status === 'active') assert.equal(unit.replacement, null, `${unit.id}: active replacement`);
  if (unit.status === 'deprecated' && unit.replacement !== null) {
    assert.match(unit.replacement, /^[a-z0-9-]+\/[a-z0-9-]+$/, `${unit.id}: replacement ID`);
    assert.notEqual(unit.replacement, unit.id, `${unit.id}: replacement must differ`);
  }
  if (unit.status === 'retired') return;

  const expectedPath = `${roleFamily}/${unitSlug}/${unitSlug}.yaml`;
  assert.equal(unit.path, expectedPath, `${unit.id}: canonical path`);
  const unitRoot = join(libraryRoot, roleFamily!, unitSlug!);
  const blueprintPath = join(libraryRoot, unit.path);
  const evaluationPath = join(unitRoot, 'evaluations', `${unitSlug}.yaml`);
  const testPath = join(unitRoot, 'tests', `${unitSlug}.contract.test.ts`);
  const readmePath = join(unitRoot, 'README.md');
  const [blueprintSource, evaluationSource, testSource, readmeSource] = await Promise.all([
    readFile(blueprintPath, 'utf8'),
    readFile(evaluationPath, 'utf8'),
    readFile(testPath, 'utf8'),
    readFile(readmePath, 'utf8'),
  ]);
  const blueprint = YAML.parse(blueprintSource) as BlueprintFile;
  const evaluation = YAML.parse(evaluationSource) as EvaluationFile;

  assert.equal(typeof blueprint.name, 'string', `${unit.id}: Blueprint name`);
  assert.match(String(blueprint.name), /\S/, `${unit.id}: Blueprint name`);
  assert.equal(blueprint.version, unit.version, `${unit.id}: catalog/Blueprint version`);
  assert.equal(evaluation.schema, 'pixiecore.blueprint-eval-dataset/v1', `${unit.id}: dataset schema`);
  assert.match(String(evaluation.version), STRICT_SEMVER, `${unit.id}: dataset SemVer`);
  assert.deepEqual(evaluation.blueprint, {
    path: `../${unitSlug}.yaml`,
    version: unit.version,
  }, `${unit.id}: dataset Blueprint pin`);
  assert.match(testSource, /runBlueprintEvaluation/, `${unit.id}: public evaluation runner test`);
  assert.match(testSource, /PromptRuntime/, `${unit.id}: public runtime contract test`);
  assert.match(readmeSource, /^# /m, `${unit.id}: README title`);
  assert.match(readmeSource, /evaluation/i, `${unit.id}: README evaluation policy`);
}

async function discoverUnitIds(): Promise<string[]> {
  const ids: string[] = [];
  for (const roleEntry of await readdir(libraryRoot, { withFileTypes: true })) {
    if (!roleEntry.isDirectory()) continue;
    assert.match(roleEntry.name, KEBAB_CASE, `role directory: ${roleEntry.name}`);
    const roleRoot = join(libraryRoot, roleEntry.name);
    for (const unitEntry of await readdir(roleRoot, { withFileTypes: true })) {
      if (!unitEntry.isDirectory()) continue;
      assert.match(unitEntry.name, KEBAB_CASE, `unit directory: ${unitEntry.name}`);
      const id = relative(libraryRoot, join(roleRoot, unitEntry.name)).replaceAll('\\', '/');
      ids.push(id);
    }
  }
  return ids.sort();
}

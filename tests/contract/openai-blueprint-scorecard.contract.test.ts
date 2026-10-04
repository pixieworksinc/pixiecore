import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  createOpenAIBlueprintReproductionArgs,
  createOpenAIBlueprintScorecard,
  renderOpenAIBlueprintScorecard,
} from '../../examples/benchmarks/openai-blueprint-reports.js';
import {
  createOpenAIBlueprintMatrixPlan,
  parseOpenAIBlueprintMatrixArgs,
} from '../../examples/benchmarks/openai-blueprint-matrix.js';
import { withTempDirectory } from '../helpers/temp.js';
import { testData } from '../helpers/test-data.js';

const manifest = 'examples/benchmarks/openai-blueprint-run-manifest.json';
const sourceRevision = '0123456789abcdef0123456789abcdef01234567';
const data = testData('OpenAI scorecard limitations');

test('synthetic OpenAI scorecard preserves immutable identity and value-free output', async () => {
  await withTempDirectory(async directory => {
    const fixture = await writeIdentityFixture(directory);
    const plan = await createSyntheticPlan(fixture.manifestPath, directory);
    const checkpointPath = join(directory, 'checkpoint.json');
    await writeFile(checkpointPath, `${JSON.stringify(completedCheckpoint(plan), null, 2)}\n`, 'utf8');
    const report = await createOpenAIBlueprintScorecard(checkpointPath, fixture.manifestPath, directory);
    const markdown = renderOpenAIBlueprintScorecard(report);

    assert.equal(report.schema, 'pixiecore.openai-blueprint-scorecard/v2');
    assert.equal(report.roles.length, 1);
    assert.equal(report.roles[0]?.limitations, undefined);
    assert.equal(report.execution.runs, 1);
  assert.deepEqual(report.totals.usage, {
    calls: 1,
    input_tokens: 10,
    output_tokens: 2,
    total_tokens: 12,
    estimated_cost_usd: 0.0000072,
    complete: true,
  });
  assert.deepEqual({
    observations: report.totals.observations,
    passed: report.totals.passed,
    failed: report.totals.failed,
    errors: report.totals.errors,
  }, { observations: 1, passed: 1, failed: 0, errors: 0 });
  assert.equal(report.roles[0]?.passed, 1);
  assert.match(markdown, /1\/1/u);
  assert.doesNotMatch(markdown,
    /actual_output|expected_output|OPENAI_API_KEY|sk-proj-|\/Users\//u);
  }, 'pixiecore-openai-scorecard-');
});

test('OpenAI scorecard preserves limited comparison scope without changing pass counts', async () => {
  await withTempDirectory(async directory => {
    const fixture = await writeIdentityFixture(directory);
    const checkpoint = completedCheckpoint(await createSyntheticPlan(fixture.manifestPath, directory));
    const limited = {
      ...checkpoint,
      results: checkpoint.results.map(result => ({
        ...result,
        cases: result.cases.map(item => ({ ...item, limitations: ['factuality_not_evaluated'] })),
      })),
    };
    const path = join(directory, `${data.text('limited checkpoint')}.json`);
    await writeFile(path, JSON.stringify(limited), 'utf8');
    const report = await createOpenAIBlueprintScorecard(path, fixture.manifestPath, directory);
    assert.deepEqual(report.roles[0]?.limitations, ['factuality_not_evaluated']);
    assert.equal(report.totals.passed, 1);
    assert.equal(report.totals.accuracy, 1);
    const rendered = renderOpenAIBlueprintScorecard(report);
    assert.match(rendered, /Configured comparator pass rate/u);
    assert.match(rendered, /factuality was not evaluated/u);
  });
});

test('legacy checkpoint formats cannot be regenerated with current dataset identities', async () => {
  await withTempDirectory(async directory => {
    const fixture = await writeIdentityFixture(directory);
    const checkpointPath = join(directory, 'legacy-checkpoint.json');
    await writeFile(checkpointPath, '{"schema":"pixiecore.openai-blueprint-matrix-checkpoint/v1"}\n', 'utf8');
    await assert.rejects(
      createOpenAIBlueprintScorecard(checkpointPath, fixture.manifestPath, directory),
      /completed v2 OpenAI matrix checkpoint with immutable identity/u,
    );
  }, 'pixiecore-openai-scorecard-');
});

test('OpenAI reproduction arguments round-trip full and singleton selections', async () => {
  await withTempDirectory(async directory => {
    const fixture = await writeIdentityFixture(directory);
    const source = completedCheckpoint(await createSyntheticPlan(fixture.manifestPath, directory));
    const manifestSource = JSON.parse(await readFile(fixture.manifestPath, 'utf8'));
    const fullArgs = createOpenAIBlueprintReproductionArgs(source, manifestSource);
    const fullCommand = parseOpenAIBlueprintMatrixArgs([...fullArgs, '--dry-run']);
    const fullPlan = await createOpenAIBlueprintMatrixPlan(fullCommand, {});
    assert.deepEqual(fullPlan.datasets, source.plan.datasets);
    assert.equal(fullPlan.expected_calls, source.plan.expected_calls);

    const quotedSeedSource = {
      ...source,
      plan: { ...source.plan, seed: "seed with spaces; 'quoted' $value" },
    };
    const singletonArgs = createOpenAIBlueprintReproductionArgs(quotedSeedSource, manifestSource);
    const singletonCommand = parseOpenAIBlueprintMatrixArgs([...singletonArgs, '--dry-run']);
    assert.equal(singletonCommand.seed, quotedSeedSource.plan.seed);

    const unsafeRunIdSource = {
      ...source,
      plan: { ...source.plan, datasets: ['date-normalizer'], run_id: 'unsafe;run-id' },
    };
    const unsafeRunIdArgs = createOpenAIBlueprintReproductionArgs(unsafeRunIdSource, manifestSource);
    assert.throws(
      () => parseOpenAIBlueprintMatrixArgs([...unsafeRunIdArgs, '--dry-run']),
      /--run-id must contain only/u,
    );
  }, 'pixiecore-openai-scorecard-');
});

test('new scorecards retain captured identity when the dataset later changes', async () => {
  await withTempDirectory(async directory => {
    const fixture = await writeIdentityFixture(directory);
    const command = parseOpenAIBlueprintMatrixArgs([
      `--manifest=${fixture.manifestPath}`,
      '--phase=canary',
      '--dataset=date-normalizer',
      '--run-id=identity-fixture',
      '--seed=identity-seed',
      `--source-revision=${sourceRevision}`,
      '--dry-run',
    ]);
    const plan = await createOpenAIBlueprintMatrixPlan(command, {}, directory);
    const checkpointPath = join(directory, 'checkpoint.json');
    const checkpointSource = completedCheckpoint(plan);
    await writeFile(checkpointPath, `${JSON.stringify(checkpointSource, null, 2)}\n`, 'utf8');
    await writeFile(fixture.datasetPath, fixture.datasetSource.replace('1.2.3', '9.9.9'), 'utf8');

    const report = await createOpenAIBlueprintScorecard(
      checkpointPath,
      fixture.manifestPath,
      directory,
    );
    assert.equal(report.schema, 'pixiecore.openai-blueprint-scorecard/v2');
    assert.equal(report.execution.source_revision, sourceRevision);
    assert.equal(report.roles[0]?.dataset_version, '1.2.3');
    assert.equal(report.roles[0]?.blueprint_version, '4.5.6');
    assert.match(report.roles[0]!.dataset_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(renderOpenAIBlueprintScorecard(report), new RegExp(sourceRevision, 'u'));

    const tampered = JSON.parse(JSON.stringify(checkpointSource));
    tampered.plan.dataset_snapshots[0].dataset_digest = 'sha256:invalid';
    const tamperedPath = join(directory, 'tampered-checkpoint.json');
    await writeFile(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
    await assert.rejects(
      createOpenAIBlueprintScorecard(tamperedPath, fixture.manifestPath, directory),
      /dataset digest must be a SHA-256 identity/u,
    );
  }, 'pixiecore-openai-scorecard-');
});

async function createSyntheticPlan(manifestPath: string, directory: string) {
  const command = parseOpenAIBlueprintMatrixArgs([
    `--manifest=${manifestPath}`,
    '--phase=canary',
    '--dataset=date-normalizer',
    '--run-id=identity-fixture',
    '--seed=identity-seed',
    `--source-revision=${sourceRevision}`,
    '--dry-run',
  ]);
  return createOpenAIBlueprintMatrixPlan(command, {}, directory);
}

async function writeIdentityFixture(directory: string) {
  const blueprintPath = join(directory, 'blueprint.yaml');
  const datasetPath = join(directory, 'dataset.yaml');
  const manifestPath = join(directory, 'manifest.json');
  const blueprintSource = 'name: Identity fixture\nversion: 4.5.6\nrole: assistant\nprompt: Return JSON.\noutput_schema: { type: object }\n';
  const datasetSource = 'schema: pixiecore.blueprint-eval-dataset/v1\nname: Identity fixture\nversion: 1.2.3\nblueprint: { path: blueprint.yaml, version: 4.5.6 }\ncases:\n  - id: japanese-gregorian\n    inputs: {}\n    expected_output: { ok: true }\n    comparison: { mode: exact }\n';
  await Promise.all([
    writeFile(blueprintPath, blueprintSource, 'utf8'),
    writeFile(datasetPath, datasetSource, 'utf8'),
  ]);
  const source = JSON.parse(await readFile(manifest, 'utf8'));
  source.datasets = source.datasets.map((dataset: { id: string }) => dataset.id === 'date-normalizer'
    ? { ...dataset, path: 'dataset.yaml', case_count: 1 }
    : dataset);
  await writeFile(manifestPath, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  return { blueprintPath, blueprintSource, datasetPath, datasetSource, manifestPath };
}

function completedCheckpoint(plan: Awaited<ReturnType<typeof createOpenAIBlueprintMatrixPlan>>) {
  return {
    schema: 'pixiecore.openai-blueprint-matrix-checkpoint/v2',
    status: 'completed',
    plan: structuredClone(plan),
    started_at: '2026-09-07T12:00:00.000Z',
    updated_at: '2026-09-07T12:00:01.000Z',
    completed_at: '2026-09-07T12:00:01.000Z',
    usage: {
      calls: 1,
      input_tokens: 10,
      output_tokens: 2,
      total_tokens: 12,
      estimated_cost_usd: 0.0000072,
      complete: true,
    },
    results: [{
      run: 1,
      dataset_id: 'date-normalizer',
      role: 'converter',
      summary: { total: 1, passed: 1, failed: 0, errors: 0 },
      cases: [{
        id: 'japanese-gregorian',
        status: 'passed',
        duration_ms: 1,
        provider_usage: [],
        error_name: null,
      }],
    }],
    halt_reason: null,
  };
}

interface HistoricalScorecard {
  readonly schema: string;
  readonly execution: Readonly<{ runs: number }>;
  readonly totals: Readonly<{
    observations: number;
    passed: number;
    failed: number;
    errors: number;
    usage: Readonly<Record<string, number | boolean>>;
  }>;
  readonly roles: readonly Readonly<{
    role: string;
    passed: number;
  }>[];
}

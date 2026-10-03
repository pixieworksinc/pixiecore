import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import YAML from 'yaml';
import {
  BLUEPRINT_BENCHMARK_SCHEMA,
  renderBlueprintBenchmarkScorecard,
  runBlueprintBenchmark,
} from '../../src/core/kernel/evaluation/index.js';
import { ScriptedProvider } from '../helpers/fake-provider.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const data = testData('evaluation benchmark contract');

test('benchmark compares explicit targets across repeated accuracy, cost, latency, and variance runs', async () => {
  await withTempDirectory(async directory => {
    await writeFixture(directory);
    const seed = data.text('benchmark seed', 'seed');
    const providerName = data.text('benchmark provider', 'provider');
    const artifact = await runBlueprintBenchmark({
      cwd: directory,
      datasetPath: 'evaluations/dataset.yaml',
      seed,
      runsPerTarget: 2,
      targets: [
        {
          id: 'accurate-priced',
          pricing: {
            currency: 'USD',
            inputPerMillionTokens: 2,
            outputPerMillionTokens: 4,
          },
          createRuntimeOptions: ({ run, seed: runSeed }) => {
            assert.match(runSeed, new RegExp(`${seed}/accurate-priced/${run}$`));
            return runtimeOptions(new ScriptedProvider([{
              content: JSON.stringify({ value: 'expected' }),
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            }], { name: providerName, model: 'accurate-1' }));
          },
        },
        {
          id: 'variable-unpriced',
          createRuntimeOptions: ({ run }) => runtimeOptions(new ScriptedProvider([{
            content: JSON.stringify({ value: run === 1 ? 'expected' : 'different' }),
          }], { name: providerName, model: 'variable-1' })),
        },
      ],
    });

    assert.equal(artifact.schema, BLUEPRINT_BENCHMARK_SCHEMA);
    assert.equal(artifact.benchmark.seed, seed);
    assert.equal(artifact.benchmark.runs_per_target, 2);
    assert.equal(artifact.targets.length, 2);
    const accurate = artifact.targets[0]!;
    assert.equal(accurate.provider, providerName);
    assert.equal(accurate.model, 'accurate-1');
    assert.deepEqual(
      accurate.totals,
      { total: 2, passed: 2, failed: 0, errors: 0 },
      JSON.stringify(artifact, null, 2),
    );
    assert.equal(accurate.accuracy, 1);
    assert.equal(accurate.accuracy_standard_deviation, 0);
    assert.deepEqual(accurate.usage, {
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
    });
    assert.equal(accurate.cost?.currency, 'USD');
    assert.equal(accurate.cost?.total, 0.00008);
    assert.equal(accurate.cost?.mean_per_case, 0.00004);
    assert.equal(accurate.runs.every(run => run.latency_ms >= 0), true);
    const variable = artifact.targets[1]!;
    assert.equal(variable.accuracy, 0.5);
    assert.equal(variable.accuracy_standard_deviation, 0.5);
    assert.equal(variable.usage, null);
    assert.equal(variable.cost, null);
    assert.equal('actual_output' in variable.runs[0]!, false);

    const schema = JSON.parse(await readFile(
      join(process.cwd(), 'schemas', 'pixiecore.blueprint-benchmark-v1.schema.json'),
      'utf8',
    )) as object;
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    assert.equal(validate(artifact), true, JSON.stringify(validate.errors));

    const scorecard = renderBlueprintBenchmarkScorecard(artifact, {
      release: '0.1.0',
      generatedAt: '2026-08-25T00:00:00.000Z',
      reproductionCommand: 'node benchmark.mjs --seed=fixture',
      methodology: 'Exact comparison against the versioned canonical dataset.',
      pricingSource: 'Provider price sheet captured for the release.',
    });
    assert.match(scorecard, /Benchmark dataset 1\.0\.0/u);
    assert.match(scorecard, /2\/2 \(100%\)/u);
    assert.match(scorecard, /1\/2 \(50%\)/u);
    assert.match(scorecard, /node benchmark\.mjs --seed=fixture/u);
    assert.doesNotMatch(scorecard, /actual_output/u);
    assert.throws(
      () => renderBlueprintBenchmarkScorecard(artifact, {
        release: '0.1.0',
        generatedAt: '2026-08-25T00:00:00.000Z',
        reproductionCommand: 'node benchmark.mjs',
        methodology: 'Canonical dataset.',
      }),
      /pricingSource is required/u,
    );
  });
});

test('scorecard rejects incomplete publication metadata', () => {
  const artifact = {
    schema: BLUEPRINT_BENCHMARK_SCHEMA,
    dataset: { name: 'Fixture', version: '1.0.0', path: 'dataset.yaml', sha256: 'a'.repeat(64) },
    blueprint: { path: 'fixture.yaml', version: '1.0.0', sha256: 'b'.repeat(64) },
    benchmark: {
      id: '00000000-0000-4000-8000-000000000000',
      seed: 'fixture',
      seed_scope: 'runner' as const,
      started_at: '2026-08-25T00:00:00.000Z',
      completed_at: '2026-08-25T00:00:01.000Z',
      runs_per_target: 1,
    },
    targets: [],
  };
  const base = {
    release: '0.1.0',
    generatedAt: '2026-08-25T00:00:00.000Z',
    reproductionCommand: 'node benchmark.mjs',
    methodology: 'Canonical dataset.',
  };
  assert.throws(
    () => renderBlueprintBenchmarkScorecard(artifact, { ...base, release: ' ' }),
    /release must be non-blank/u,
  );
  assert.throws(
    () => renderBlueprintBenchmarkScorecard(artifact, { ...base, generatedAt: 'invalid' }),
  );
  assert.throws(
    () => renderBlueprintBenchmarkScorecard(artifact, { ...base, reproductionCommand: ' ' }),
    /reproductionCommand must be non-blank/u,
  );
  assert.throws(
    () => renderBlueprintBenchmarkScorecard(artifact, { ...base, methodology: ' ' }),
    /methodology must be non-blank/u,
  );
});

test('benchmark rejects ambiguous targets, runs, pricing, and implicit providers', async () => {
  const createRuntimeOptions = () => runtimeOptions(new ScriptedProvider([]));
  await assert.rejects(
    runBlueprintBenchmark({ datasetPath: 'unused.yaml', runsPerTarget: 0, targets: [] }),
    /runsPerTarget must be/u,
  );
  await assert.rejects(
    runBlueprintBenchmark({ datasetPath: 'unused.yaml', targets: [] }),
    /targets must contain at least one target/u,
  );
  await assert.rejects(
    runBlueprintBenchmark({
      datasetPath: 'unused.yaml',
      seed: ' ',
      targets: [{ id: 'unused', createRuntimeOptions }],
    }),
    /seed must be non-blank/u,
  );
  await assert.rejects(
    runBlueprintBenchmark({
      datasetPath: 'unused.yaml',
      targets: [{ id: ' ', createRuntimeOptions }],
    }),
    /target id must be non-blank/u,
  );
  await assert.rejects(
    runBlueprintBenchmark({
      datasetPath: 'unused.yaml',
      targets: [
        { id: 'duplicate', createRuntimeOptions },
        { id: 'duplicate', createRuntimeOptions },
      ],
    }),
    /Duplicate benchmark target id/u,
  );
  await assert.rejects(
    runBlueprintBenchmark({
      datasetPath: 'unused.yaml',
      targets: [{
        id: 'invalid-price',
        pricing: { currency: 'USD', inputPerMillionTokens: -1, outputPerMillionTokens: 1 },
        createRuntimeOptions,
      }],
    }),
    /pricing inputPerMillionTokens must be non-negative/u,
  );
  await assert.rejects(
    runBlueprintBenchmark({
      datasetPath: 'unused.yaml',
      targets: [{
        id: 'blank-currency',
        pricing: { currency: ' ', inputPerMillionTokens: 1, outputPerMillionTokens: 1 },
        createRuntimeOptions,
      }],
    }),
    /pricing currency for blank-currency must be non-blank/u,
  );
  await assert.rejects(
    runBlueprintBenchmark({
      datasetPath: 'unused.yaml',
      targets: [{
        id: 'invalid-output-price',
        pricing: {
          currency: 'USD',
          inputPerMillionTokens: 1,
          outputPerMillionTokens: Number.POSITIVE_INFINITY,
        },
        createRuntimeOptions,
      }],
    }),
    /pricing outputPerMillionTokens must be non-negative/u,
  );
  await assert.rejects(
    runBlueprintBenchmark({
      datasetPath: 'unused.yaml',
      targets: [{ id: 'missing-factory', createRuntimeOptions: null as never }],
    }),
    /requires createRuntimeOptions/u,
  );

  await withTempDirectory(async directory => {
    await writeFixture(directory);
    await assert.rejects(
      runBlueprintBenchmark({
        cwd: directory,
        datasetPath: 'evaluations/dataset.yaml',
        runsPerTarget: 1,
        targets: [{
          id: 'implicit-provider',
          createRuntimeOptions: () => ({
            provider: 'openai',
            mcpConfigPath: 'disabled',
            pluginConfigPath: 'disabled',
          }),
        }],
      }),
      /must create an explicit Provider instance/u,
    );
  });
});

test('benchmark defaults runs, honors model overrides, closes providers, and rejects identity drift', async () => {
  await withTempDirectory(async directory => {
    await writeFixture(directory);
    let closes = 0;
    const artifact = await runBlueprintBenchmark({
      datasetPath: join(directory, 'evaluations', 'dataset.yaml'),
      targets: [{
        id: 'default-runs',
        createRuntimeOptions: () => {
          const provider = Object.assign(new ScriptedProvider([{
            content: JSON.stringify({ value: 'expected' }),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          }], { name: 'stable-provider', model: 'provider-default' }), {
            close: async () => { closes++; },
          });
          return { ...runtimeOptions(provider), model: 'model-override' };
        },
      }],
      customComparators: new Map(),
    });

    assert.equal(artifact.benchmark.runs_per_target, 3);
    assert.match(artifact.benchmark.seed, /^[0-9a-f-]{36}$/u);
    assert.equal(artifact.targets[0]?.model, 'model-override');
    assert.equal(closes, 3);

    await assert.rejects(
      runBlueprintBenchmark({
        cwd: directory,
        datasetPath: 'evaluations/dataset.yaml',
        runsPerTarget: 2,
        targets: [{
          id: 'identity-drift',
          createRuntimeOptions: ({ run }) => runtimeOptions(new ScriptedProvider([{
            content: JSON.stringify({ value: 'expected' }),
          }], { name: `provider-${run}`, model: 'stable-model' })),
        }],
      }),
      /changed provider or model between runs/u,
    );
  });
});

function runtimeOptions(provider: ScriptedProvider) {
  return {
    provider,
    maxRetry: 0,
    mcpConfigPath: 'disabled' as const,
    pluginConfigPath: 'disabled' as const,
  };
}

async function writeFixture(directory: string): Promise<void> {
  await mkdir(join(directory, 'blueprints'), { recursive: true });
  await mkdir(join(directory, 'evaluations'), { recursive: true });
  await writeFile(join(directory, 'package.json'), '{"name":"benchmark-fixture"}\n', 'utf8');
  await writeFile(join(directory, 'blueprints', 'fixture.yaml'), YAML.stringify({
    name: 'Benchmark fixture',
    version: '1.0.0',
    role: 'assistant',
    prompt: 'Convert {source}.',
    input_placeholders: [{ name: 'source', type: 'string', required: true }],
    temperature: 0,
    output_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: { value: { type: 'string' } },
    },
  }), 'utf8');
  await writeFile(join(directory, 'evaluations', 'dataset.yaml'), YAML.stringify({
    schema: 'pixiecore.blueprint-eval-dataset/v1',
    name: 'Benchmark dataset',
    version: '1.0.0',
    blueprint: { path: '../blueprints/fixture.yaml', version: '1.0.0' },
    tags: ['benchmark'],
    cases: [{
      id: 'case-one',
      tags: ['ordinary'],
      inputs: { source: data.text('benchmark input', 'input') },
      expected_output: { value: 'expected' },
      comparison: { mode: 'exact' },
    }],
  }), 'utf8');
}

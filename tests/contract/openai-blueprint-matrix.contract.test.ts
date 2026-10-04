import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import type { GenerateResponse, Provider } from '@pixieworks/pixiecore';
import type {
  BlueprintPlaygroundArtifact,
  BlueprintPlaygroundRunOptions,
  BlueprintProviderUsage,
} from '@pixieworks/pixiecore/eval';
import {
  createOpenAIBlueprintMatrixPlan,
  openAIBlueprintMatrixUsage,
  parseOpenAIBlueprintMatrixArgs,
  runOpenAIBlueprintMatrix,
} from '../../examples/benchmarks/openai-blueprint-matrix.js';
import { withTempDirectory } from '../helpers/temp.js';
import { testData } from '../helpers/test-data.js';

const sourceManifestPath = resolve('examples/benchmarks/openai-blueprint-run-manifest.json');
const fakeKey = 'offline-secret-value-that-must-not-be-persisted';
const sourceRevision = '0123456789abcdef0123456789abcdef01234567';
const data = testData('OpenAI matrix limitations');

test('OpenAI matrix CLI requires live confirmations but dry-run reads no credential', async () => {
  assert.throws(
    () => parseOpenAIBlueprintMatrixArgs(
      [...baseArgs().filter(argument => !argument.startsWith('--source-revision=')), '--dry-run'],
    ),
    /--source-revision is required/u,
  );
  assert.throws(
    () => parseOpenAIBlueprintMatrixArgs(baseArgs()),
    /--confirm-remote-cost/u,
  );
  assert.throws(
    () => parseOpenAIBlueprintMatrixArgs([...baseArgs(), '--confirm-remote-cost']),
    /--confirm-key-rotated/u,
  );
  assert.throws(
    () => parseOpenAIBlueprintMatrixArgs([
      ...baseArgs(), '--confirm-remote-cost', '--confirm-key-rotated',
    ]),
    /--max-calls/u,
  );
  const command = parseOpenAIBlueprintMatrixArgs([...baseArgs(), '--dry-run']);
  const plan = await createOpenAIBlueprintMatrixPlan(command, {});
  assert.equal(plan.schema, 'pixiecore.openai-blueprint-matrix-plan/v2');
  assert.equal(plan.source_revision, sourceRevision);
  assert.equal(plan.dataset_snapshots[0]?.dataset_version, '1.0.0');
  assert.equal(plan.dataset_snapshots[0]?.blueprint_version, '1.0.2');
  assert.equal(plan.expected_calls, 1);
  assert.equal(plan.max_calls, 1);
  assert.equal(plan.budget_usd, 0.05);
  assert.doesNotMatch(JSON.stringify(plan), /secret|api[_-]?key/iu);
  assert.match(openAIBlueprintMatrixUsage(), /OPENAI_API_KEY is read only from the environment/u);
});

test('OpenAI matrix can narrow a reviewed phase to one dataset', async () => {
  const command = parseOpenAIBlueprintMatrixArgs([
    '--phase=repeated',
    '--dataset=travel-request-summary',
    '--run-id=summarizer-repeat',
    '--seed=repeated-fixture-seed',
    `--source-revision=${sourceRevision}`,
    '--max-calls=24',
    '--max-budget-usd=0.1',
    '--dry-run',
  ]);
  const plan = await createOpenAIBlueprintMatrixPlan(command, {});
  assert.deepEqual(plan.datasets, ['travel-request-summary']);
  assert.equal(plan.runs, 3);
  assert.equal(plan.expected_calls, 24);
  assert.equal(plan.max_calls, 24);
  assert.equal(plan.budget_usd, 0.1);

  await assert.rejects(
    createOpenAIBlueprintMatrixPlan({ ...command, phaseId: 'canary' }, {}),
    /dataset travel-request-summary is not included in phase canary/u,
  );
});

test('live runner forwards one immutable environment snapshot to the runtime', async () => {
  await withTempDirectory(async directory => {
    const manifestPath = await writeManifest(directory);
    let captured: NodeJS.ProcessEnv | undefined;
    await runOpenAIBlueprintMatrix(
      liveCommand(manifestPath, 'environment-snapshot', 'environment-seed'),
      {
        ...dependencies(directory, usageResponse(1, 1)),
        runPlayground: async options => {
          captured = options.runtimeOptions?.environment;
          return fakePlayground(options);
        },
      },
    );
    assert.equal(captured?.OPENAI_API_KEY, fakeKey);
  });
});

test('OpenAI matrix rejects endpoint overrides, unallowlisted models, and call-plan overflow', async () => {
  const command = parseOpenAIBlueprintMatrixArgs([...baseArgs(), '--dry-run']);
  await assert.rejects(
    createOpenAIBlueprintMatrixPlan(command, { OPENAI_BASE_URL: 'https://proxy.example/v1' }),
    /permits only https:\/\/api\.openai\.com\/v1/u,
  );
  await withTempDirectory(async directory => {
    const manifestPath = await writeManifest(directory, manifest => ({
      ...manifest,
      model: 'unreviewed-model',
    }));
    await assert.rejects(
      createOpenAIBlueprintMatrixPlan({ ...command, manifestPath }, {}, directory),
      /not allowlisted/u,
    );
  });
  await withTempDirectory(async directory => {
    const manifestPath = await writeManifest(directory, manifest => ({
      ...manifest,
      phases: manifest.phases.map(phase => phase.id === 'canary'
        ? { ...phase, case_ids: ['first', 'second'], max_calls: 1 }
        : phase),
    }));
    await assert.rejects(
      createOpenAIBlueprintMatrixPlan({ ...command, manifestPath }, {}, directory),
      /expects 2 calls but effective cap is 1/u,
    );
  });
});

test('fake OpenAI canary checkpoints tokens and cost without persisting secret values', async () => {
  await withTempDirectory(async directory => {
    const manifestPath = await writeManifest(directory);
    const command = liveCommand(manifestPath, 'successful-canary', 'replay-seed');
    const result = await runOpenAIBlueprintMatrix(command, dependencies(
      directory,
      usageResponse(100, 25),
    ));
    const checkpoint = JSON.parse(await readFile(result.checkpointPath!, 'utf8')) as Checkpoint;
    assert.equal(checkpoint.status, 'completed');
    assert.equal(checkpoint.plan.source_revision, sourceRevision);
    assert.equal(checkpoint.plan.dataset_snapshots.length, 1);
    assert.match(checkpoint.plan.dataset_snapshots[0]!.dataset_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(checkpoint.plan.dataset_snapshots[0]!.blueprint_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(
      checkpoint.plan.dataset_snapshots[0]!.comparison_policy_digest,
      /^sha256:[0-9a-f]{64}$/u,
    );
    assert.deepEqual(checkpoint.usage, {
      calls: 1,
      input_tokens: 100,
      output_tokens: 25,
      total_tokens: 125,
      estimated_cost_usd: 0.00008,
      complete: true,
    });
    assert.equal(checkpoint.results[0]?.summary.passed, 1);
    assert.equal(checkpoint.plan.artifact_directory, 'results/successful-canary');
    assert.doesNotMatch(JSON.stringify(checkpoint), new RegExp(directory, 'u'));
    assert.doesNotMatch(JSON.stringify(checkpoint), new RegExp(fakeKey, 'u'));
    await assert.rejects(
      runOpenAIBlueprintMatrix(command, dependencies(directory, usageResponse(1, 1))),
      /EEXIST/u,
    );
  });
});

test('value-free canary checkpoints retain structural comparison limitations', async () => {
  await withTempDirectory(async directory => {
    const manifestPath = await writeManifest(directory);
    const command = liveCommand(manifestPath, data.text('limited canary', 'run'), data.text('limited seed', 'seed'));
    const result = await runOpenAIBlueprintMatrix(command, {
      ...dependencies(directory, usageResponse(1, 1)),
      runPlayground: async options => {
        const artifact = await fakePlayground(options);
        return {
          ...artifact,
          real: {
            ...artifact.real!,
            comparison: {
              ...artifact.real!.comparison,
              limitations: ['factuality_not_evaluated'] as const,
            },
          },
        };
      },
    });
    const checkpoint = JSON.parse(await readFile(result.checkpointPath!, 'utf8'));
    assert.deepEqual(checkpoint.results[0].cases[0].limitations, ['factuality_not_evaluated']);
    assert.equal(checkpoint.results[0].summary.passed, 1);
    assert.doesNotMatch(JSON.stringify(checkpoint), /actual_output|expected_output|offline-secret/u);
  });
});

test('value-free full-dataset checkpoints retain comparison limitations from the runner', async () => {
  await withTempDirectory(async directory => {
    const manifestPath = await writeManifest(directory, manifest => ({
      ...manifest,
      phases: manifest.phases.map(phase => {
        if (phase.id !== 'canary') return phase;
        const { case_ids: _selected, ...fullDataset } = phase;
        return fullDataset;
      }),
    }));
    const datasetPath = resolve(directory, 'fixture', 'dataset.yaml');
    const dataset = await readFile(datasetPath, 'utf8');
    await writeFile(datasetPath, dataset
      .replace('mode: exact', 'mode: schema')
      .replace('\ncases:', '\ntags: [contract]\ncases:')
      .replace('\n    inputs:', '\n    tags: [contract]\n    inputs:'), 'utf8');
    const result = await runOpenAIBlueprintMatrix(
      liveCommand(manifestPath, data.text('limited full run', 'run'), data.text('limited full seed', 'seed')),
      dependencies(directory, usageResponse(1, 1)),
    );
    const checkpoint = JSON.parse(await readFile(result.checkpointPath!, 'utf8'));
    assert.equal(checkpoint.status, 'completed');
    assert.equal(checkpoint.results[0].summary.passed, 1);
    assert.deepEqual(checkpoint.results[0].cases[0].limitations, ['factuality_not_evaluated']);
  });
});

test('budget, missing usage, and provider errors halt with atomic value-free checkpoints', async () => {
  const failures = [
    { id: 'budget', response: usageResponse(1_000_000, 1_000_000), reason: 'observed_budget_exceeded' },
    { id: 'missing-usage', response: { content: '{}' }, reason: 'missing_provider_usage' },
    { id: 'provider-error', response: new Error('sensitive provider detail'), reason: 'provider_error_cost_unknown' },
  ] as const;
  for (const fixture of failures) {
    await withTempDirectory(async directory => {
      const manifestPath = await writeManifest(directory);
      const command = liveCommand(manifestPath, fixture.id, 'failure-seed');
      await assert.rejects(
        runOpenAIBlueprintMatrix(command, dependencies(directory, fixture.response)),
      );
      const checkpointPath = resolve(directory, 'results', fixture.id, 'checkpoint.json');
      const source = await readFile(checkpointPath, 'utf8');
      const checkpoint = JSON.parse(source) as Checkpoint;
      assert.equal(checkpoint.status, 'halted');
      assert.equal(checkpoint.usage.calls, 1);
      assert.equal(checkpoint.usage.complete, fixture.id === 'budget');
      assert.doesNotMatch(source, /sensitive provider detail|offline-secret/u);
      assert.equal(checkpoint.results.length, 0);
      assert.equal(checkpoint.halt_reason, fixture.reason);
    });
  }
});

test('the same seed produces the same fake-provider result ordering and accounting', async () => {
  await withTempDirectory(async directory => {
    const manifestPath = await writeManifest(directory);
    const first = await runOpenAIBlueprintMatrix(
      liveCommand(manifestPath, 'replay-one', 'stable-seed'),
      dependencies(directory, usageResponse(20, 10)),
    );
    const second = await runOpenAIBlueprintMatrix(
      liveCommand(manifestPath, 'replay-two', 'stable-seed'),
      dependencies(directory, usageResponse(20, 10)),
    );
    const firstCheckpoint = JSON.parse(await readFile(first.checkpointPath!, 'utf8')) as Checkpoint;
    const secondCheckpoint = JSON.parse(await readFile(second.checkpointPath!, 'utf8')) as Checkpoint;
    assert.equal(firstCheckpoint.plan.seed, 'stable-seed');
    assert.equal(secondCheckpoint.plan.seed, 'stable-seed');
    assert.deepEqual(firstCheckpoint.results, secondCheckpoint.results);
    assert.deepEqual(firstCheckpoint.usage, secondCheckpoint.usage);
  });
});

function baseArgs(): string[] {
  return [
    '--phase=canary',
    '--run-id=test-canary',
    '--seed=test-seed',
    `--source-revision=${sourceRevision}`,
  ];
}

function liveCommand(manifestPath: string, runId: string, seed: string) {
  return parseOpenAIBlueprintMatrixArgs([
    `--manifest=${manifestPath}`,
    '--phase=canary',
    `--run-id=${runId}`,
    `--seed=${seed}`,
    `--source-revision=${sourceRevision}`,
    '--confirm-remote-cost',
    '--confirm-key-rotated',
    '--max-calls=1',
    '--max-budget-usd=0.05',
  ]);
}

function dependencies(
  cwd: string,
  response: GenerateResponse | Error,
) {
  return {
    cwd,
    environment: { OPENAI_API_KEY: fakeKey },
    now: () => new Date('2026-08-26T12:00:00.000Z'),
    createProvider: (model: string) => fakeProvider(model, response),
    runPlayground: fakePlayground,
  };
}

function fakeProvider(model: string, response: GenerateResponse | Error): Provider {
  return {
    name: 'openai',
    model,
    supportsTools: false,
    supportsMultimodal: true,
    supportsVision: () => true,
    supportsFileInput: () => true,
    getModelList: () => Promise.resolve([model]),
    generate: () => response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  };
}

async function fakePlayground(
  options: BlueprintPlaygroundRunOptions,
): Promise<BlueprintPlaygroundArtifact> {
  const provider = options.runtimeOptions?.provider;
  assert.ok(provider && typeof provider !== 'string');
  const response = await provider.generate({
    messages: [{ role: 'user', content: 'synthetic fixture' }],
    model: provider.model,
    temperature: 0,
  });
  const usage = response.usage;
  const providerUsage = usage === undefined ? [] : [usageArtifact(
    provider.model,
    usage.inputTokens ?? 0,
    usage.outputTokens ?? 0,
    usage.totalTokens ?? 0,
  )];
  return {
    schema: 'pixiecore.blueprint-playground/v1',
    dataset: { name: 'fixture', version: '1.0.0', path: options.datasetPath },
    blueprint: { path: 'fixture.yaml', version: '1.0.0' },
    case: { id: options.caseId, tags: ['synthetic'] },
    mode: 'real',
    real: {
      provider: provider.name,
      model: provider.model,
      output: { ok: true },
      provider_usage: providerUsage,
      comparison: { passed: true, differences: [] },
    },
    replay_command: 'redacted-offline-replay',
  };
}

function usageResponse(inputTokens: number, outputTokens: number): GenerateResponse {
  return {
    content: '{"ok":true}',
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
  };
}

function usageArtifact(
  model: string,
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
): BlueprintProviderUsage {
  return {
    provider: 'openai',
    model,
    calls: 1,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    estimated_cost: {
      currency: 'USD',
      amount: (inputTokens * 0.4 + outputTokens * 1.6) / 1_000_000,
    },
    cost_status: 'calculated',
    pricing: {
      currency: 'USD',
      input_per_million_tokens: 0.4,
      output_per_million_tokens: 1.6,
      source: 'https://developers.openai.com/api/docs/pricing',
      effective_at: '2026-08-26T00:00:00.000Z',
    },
  };
}

async function writeManifest(
  directory: string,
  mutate: (manifest: Manifest) => Manifest = manifest => manifest,
): Promise<string> {
  const source = JSON.parse(await readFile(sourceManifestPath, 'utf8')) as Manifest;
  const fixtureDirectory = resolve(directory, 'fixture');
  await mkdir(fixtureDirectory);
  await Promise.all([
    writeFile(resolve(fixtureDirectory, 'blueprint.yaml'),
      'name: Fixture\nversion: 1.0.0\nrole: assistant\nprompt: Return JSON.\noutput_schema: { type: object }\n',
      'utf8'),
    writeFile(resolve(fixtureDirectory, 'dataset.yaml'),
      'schema: pixiecore.blueprint-eval-dataset/v1\nname: Fixture\nversion: 1.0.0\nblueprint: { path: blueprint.yaml, version: 1.0.0 }\ncases:\n  - id: japanese-gregorian\n    inputs: {}\n    expected_output: { ok: true }\n    comparison: { mode: exact }\n',
      'utf8'),
  ]);
  const manifest = mutate({
    ...source,
    datasets: source.datasets.map(dataset => dataset.id === 'date-normalizer'
      ? { ...dataset, path: 'fixture/dataset.yaml', case_count: 1 }
      : dataset),
    phases: source.phases.map(phase => ({
      ...phase,
      artifact_directory: 'results',
    })),
  });
  const path = resolve(directory, 'manifest.json');
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}

interface Manifest {
  readonly [key: string]: unknown;
  readonly model: string;
  readonly datasets: readonly Readonly<{
    id: string;
    path: string;
    [key: string]: unknown;
  }>[];
  readonly phases: readonly Readonly<{
    id: string;
    case_ids?: readonly string[];
    max_calls: number;
    artifact_directory: string;
    [key: string]: unknown;
  }>[];
}

interface Checkpoint {
  readonly status: string;
  readonly plan: Readonly<{
    seed: string;
    artifact_directory: string;
    runs: number;
    expected_calls: number;
    source_revision: string;
    dataset_snapshots: readonly Readonly<{
      dataset_digest: string;
      blueprint_digest: string;
      comparison_policy_digest: string;
    }>[];
  }>;
  readonly usage: Readonly<{
    calls: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
    complete: boolean;
  }>;
  readonly results: readonly Readonly<{
    summary: Readonly<{ total: number; passed: number; failed: number; errors: number }>;
  }>[];
  readonly halt_reason: string | null;
}

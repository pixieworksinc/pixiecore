import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  InputValidationError,
  MaxRetryExceededError,
  PromptRuntime,
  type GenerateRequest,
  type GenerateResponse,
  type Provider,
} from '@pixieworks/pixiecore';
import { runBlueprintEvaluation } from '@pixieworks/pixiecore/eval';

interface DatasetCase {
  readonly id: string;
  readonly inputs: {
    readonly destination: { readonly city: string; readonly country_code: string | null };
    readonly policy: Record<string, unknown>;
  };
  readonly expected_output: Record<string, unknown>;
}

interface DatasetFixture {
  readonly cases: readonly DatasetCase[];
}

const blueprintPath = fileURLToPath(new URL('../travel-destination-level.yaml', import.meta.url));
const datasetPath = fileURLToPath(new URL('../evaluations/travel-destination-level.yaml', import.meta.url));
const policyPath = fileURLToPath(new URL('../fixtures/travel-policy-v1.yaml', import.meta.url));

test('destination Classifier passes every canonical policy case without policy drift', async () => {
  const [datasetSource, policySource] = await Promise.all([
    readFile(datasetPath, 'utf8'),
    readFile(policyPath, 'utf8'),
  ]);
  const dataset = YAML.parse(datasetSource) as DatasetFixture;
  const policy = YAML.parse(policySource) as Record<string, unknown>;
  const provider = new FixtureProvider(dataset.cases.map(item => ({
    content: JSON.stringify(item.expected_output),
  })));
  const seed = requiredTestSeed();

  for (const fixture of dataset.cases) assert.deepEqual(fixture.inputs.policy, policy);
  const artifact = await runBlueprintEvaluation({
    datasetPath,
    seed,
    runtimeOptions: runtimeOptions(provider),
  });

  assert.deepEqual(artifact.summary, {
    total: dataset.cases.length,
    passed: dataset.cases.length,
    failed: 0,
    errors: 0,
  });
  assert.equal(artifact.run.seed, seed);
  assert.equal(provider.calls.length, dataset.cases.length);
  for (const [index, fixture] of dataset.cases.entries()) {
    const prompt = lastPrompt(provider.calls[index]!);
    assert.match(prompt, new RegExp(escapeRegExp(fixture.inputs.destination.city)));
    assert.match(prompt, /2026\.1\.0/);
  }
});

test('destination Classifier rejects malformed destinations and policies before generation', async () => {
  const provider = new FixtureProvider([]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));
  const policy = YAML.parse(await readFile(policyPath, 'utf8')) as Record<string, unknown>;

  await assert.rejects(
    runtime.execute(blueprintPath, {
      destination: { city: '   ', country_code: 'US' },
      policy,
    }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      destination: { city: 'Berlin', country_code: 'de' },
      policy,
    }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      destination: { city: 'Berlin', country_code: 'DE' },
      policy: { ...policy, locations: [] },
    }),
    error => error instanceof InputValidationError,
  );
  assert.equal(provider.calls.length, 0);
});

test('destination Classifier rejects an ambiguous output with only one candidate', async () => {
  const policy = YAML.parse(await readFile(policyPath, 'utf8')) as Record<string, unknown>;
  const provider = new FixtureProvider([{
    content: JSON.stringify({
      status: 'ambiguous',
      level: null,
      canonical_city: null,
      country_code: null,
      matched_rule: null,
      reason_code: 'ambiguous_location',
      policy_version: '2026.1.0',
      candidates: [{
        canonical_city: 'Paris',
        country_code: 'FR',
        level: 'A',
        matched_rule: 'city:paris-fr',
      }],
    }),
  }]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));
  await assert.rejects(
    runtime.execute(blueprintPath, {
      destination: { city: 'Paris', country_code: null },
      policy,
    }),
    error => error instanceof MaxRetryExceededError,
  );
  assert.equal(provider.calls.length, 1);
});

class FixtureProvider implements Provider {
  readonly name = 'travel-destination-classifier-fixture';
  readonly model = 'offline-fixture';
  readonly supportsTools = false;
  readonly supportsMultimodal = false;
  readonly calls: GenerateRequest[] = [];

  constructor(private readonly responses: GenerateResponse[]) {}

  generate(request: GenerateRequest): Promise<GenerateResponse> {
    this.calls.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error(`Missing fixture response for call ${this.calls.length}`);
    return Promise.resolve(response);
  }

  supportsVision(): boolean { return false; }
  supportsFileInput(): boolean { return false; }
  getModelList(): Promise<string[]> { return Promise.resolve([this.model]); }
}

function runtimeOptions(provider: Provider) {
  return {
    provider,
    maxRetry: 0,
    mcpConfigPath: 'disabled' as const,
    pluginConfigPath: 'disabled' as const,
  };
}

function lastPrompt(request: GenerateRequest): string {
  const content = request.messages.at(-1)?.content;
  if (typeof content !== 'string') throw new TypeError('Expected a text prompt');
  return content;
}

function requiredTestSeed(): string {
  const seed = process.env.TEST_SEED?.trim();
  if (seed) return seed;
  throw new Error('TEST_SEED is required; run this test through the PixieCore test runner');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

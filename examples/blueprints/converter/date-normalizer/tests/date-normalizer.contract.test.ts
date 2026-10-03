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
  readonly inputs: Record<string, unknown>;
  readonly expected_output: Record<string, unknown>;
}

interface DatasetFixture {
  readonly cases: readonly DatasetCase[];
}

const blueprintPath = fileURLToPath(new URL('../date-normalizer.yaml', import.meta.url));
const datasetPath = fileURLToPath(new URL('../evaluations/date-normalizer.yaml', import.meta.url));

test('date normalizer passes every canonical semantic case through the public eval runner', async () => {
  const dataset = YAML.parse(await readFile(datasetPath, 'utf8')) as DatasetFixture;
  const provider = new FixtureProvider(dataset.cases.map(item => ({
    content: JSON.stringify(item.expected_output),
  })));
  const seed = requiredTestSeed();

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
    assert.equal(artifact.cases[index]?.id, fixture.id);
    const dateText = fixture.inputs.date_text;
    if (typeof dateText !== 'string') throw new TypeError(`Fixture ${fixture.id} has no date_text`);
    assert.match(lastPrompt(provider.calls[index]!), new RegExp(escapeRegExp(dateText)));
  }
});

test('date normalizer rejects blank input before a provider call', async () => {
  const provider = new FixtureProvider([]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));
  await assert.rejects(
    runtime.execute(blueprintPath, { date_text: '   ' }),
    error => error instanceof InputValidationError,
  );
  assert.equal(provider.calls.length, 0);
});

test('date normalizer rejects a malformed normalized date from the provider', async () => {
  const provider = new FixtureProvider([{
    content: JSON.stringify({
      status: 'converted',
      normalized_date: '2026-2-4',
      reason_code: 'none',
    }),
  }]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));
  await assert.rejects(
    runtime.execute(blueprintPath, { date_text: '2026年2月4日' }),
    error => error instanceof MaxRetryExceededError,
  );
  assert.equal(provider.calls.length, 1);
});

class FixtureProvider implements Provider {
  readonly name = 'date-normalizer-fixture';
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

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
import { testData } from '../../../../../tests/helpers/test-data.js';

const SOURCE_FIELDS = [
  'request.purpose',
  'request.start_date',
  'request.end_date',
  'request.destinations',
  'request.total_cost.amount',
  'request.total_cost.currency',
  'request.approval_notes',
] as const;

type SourceField = typeof SOURCE_FIELDS[number];

interface TravelRequest {
  readonly purpose: string | null;
  readonly start_date: string | null;
  readonly end_date: string | null;
  readonly destinations: readonly string[];
  readonly total_cost: { readonly amount: number; readonly currency: string } | null;
  readonly approval_notes: readonly string[];
}

interface SummaryClaim {
  readonly text: string;
  readonly source_fields: readonly SourceField[];
}

interface SummaryOutput {
  readonly status: 'summarized' | 'insufficient_facts';
  readonly summary: string | null;
  readonly character_count: number;
  readonly claims: readonly SummaryClaim[];
  readonly omitted_source_fields: readonly SourceField[];
  readonly missing_source_fields: readonly SourceField[];
}

interface DatasetCase {
  readonly id: string;
  readonly inputs: {
    readonly request: TravelRequest;
    readonly max_characters: number;
  };
  readonly expected_output: SummaryOutput;
}

interface DatasetFixture {
  readonly cases: readonly DatasetCase[];
}

const data = testData('travel request summary reference');
const blueprintPath = fileURLToPath(new URL('../travel-request-summary.yaml', import.meta.url));
const datasetPath = fileURLToPath(new URL('../evaluations/travel-request-summary.yaml', import.meta.url));
const requestPath = fileURLToPath(new URL('../fixtures/travel-request-v1.yaml', import.meta.url));

test('travel Summarizer passes every factual case with complete source partitioning', async () => {
  const [datasetSource, requestSource] = await Promise.all([
    readFile(datasetPath, 'utf8'),
    readFile(requestPath, 'utf8'),
  ]);
  const dataset = YAML.parse(datasetSource) as DatasetFixture;
  const canonicalRequest = YAML.parse(requestSource) as TravelRequest;
  const provider = new FixtureProvider(dataset.cases.map(item => ({
    content: JSON.stringify(item.expected_output),
  })));
  const seed = requiredTestSeed();

  assert.deepEqual(dataset.cases[0]?.inputs.request, canonicalRequest);
  for (const fixture of dataset.cases) assertFixtureContract(fixture);

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
    assert.match(prompt, new RegExp(`Maximum summary length: ${fixture.inputs.max_characters}`));
    for (const destination of fixture.inputs.request.destinations) {
      assert.match(prompt, new RegExp(escapeRegExp(destination)));
    }
  }
});

test('travel Summarizer rejects malformed normalized requests before generation', async () => {
  const provider = new FixtureProvider([]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));
  const canonicalRequest = YAML.parse(await readFile(requestPath, 'utf8')) as TravelRequest;
  const randomPurpose = data.text('purpose', 'purpose');
  const lowercaseCurrency = data.text('currency', 'usd').slice(0, 3).toLowerCase();

  await assert.rejects(
    runtime.execute(blueprintPath, {
      request: { ...canonicalRequest, purpose: '   ' },
      max_characters: 120,
    }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      request: {
        ...canonicalRequest,
        purpose: randomPurpose,
        total_cost: { amount: 10, currency: lowercaseCurrency },
      },
      max_characters: 120,
    }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      request: canonicalRequest,
      max_characters: 39,
    }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      request: { ...canonicalRequest, unexpected: data.text('unexpected') },
      max_characters: 120,
    }),
    error => error instanceof InputValidationError,
  );
  assert.equal(provider.calls.length, 0);
});

test('travel Summarizer rejects claims without source evidence', async () => {
  const canonicalRequest = YAML.parse(await readFile(requestPath, 'utf8')) as TravelRequest;
  const summary = data.text('unsupported claim', 'summary');
  const provider = new FixtureProvider([{
    content: JSON.stringify({
      status: 'summarized',
      summary,
      character_count: [...summary].length,
      claims: [{ text: summary, source_fields: [] }],
      omitted_source_fields: [],
      missing_source_fields: [],
    }),
  }]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));

  await assert.rejects(
    runtime.execute(blueprintPath, {
      request: canonicalRequest,
      max_characters: 120,
    }),
    error => error instanceof MaxRetryExceededError,
  );
  assert.equal(provider.calls.length, 1);
});

function assertFixtureContract(fixture: DatasetCase): void {
  const output = fixture.expected_output;
  const provided = providedSourceFields(fixture.inputs.request);
  const missing = new Set(output.missing_source_fields);
  const omitted = new Set(output.omitted_source_fields);
  const claimed = new Set(output.claims.flatMap(claim => claim.source_fields));

  assert.deepEqual(
    [...missing].sort(),
    SOURCE_FIELDS.filter(field => !provided.has(field)).sort(),
    `${fixture.id}: missing fields`,
  );
  for (const field of omitted) assert.ok(provided.has(field), `${fixture.id}: omitted ${field}`);
  for (const field of claimed) assert.ok(provided.has(field), `${fixture.id}: claimed ${field}`);
  assert.equal(
    new Set([...missing, ...omitted, ...claimed]).size,
    SOURCE_FIELDS.length,
    `${fixture.id}: source partition`,
  );
  assert.equal(
    missing.size + omitted.size + claimed.size,
    SOURCE_FIELDS.length,
    `${fixture.id}: source classifications overlap`,
  );

  if (output.summary === null) {
    assert.equal(output.status, 'insufficient_facts');
    assert.equal(output.character_count, 0);
    assert.equal(provided.size, 0);
    return;
  }

  assert.equal(output.status, 'summarized');
  assert.equal([...output.summary].length, output.character_count, `${fixture.id}: count`);
  assert.ok(output.character_count <= fixture.inputs.max_characters, `${fixture.id}: limit`);
  for (const claim of output.claims) {
    assert.ok(output.summary.includes(claim.text), `${fixture.id}: claim text`);
  }
}

function providedSourceFields(request: TravelRequest): Set<SourceField> {
  const result = new Set<SourceField>();
  if (request.purpose !== null) result.add('request.purpose');
  if (request.start_date !== null) result.add('request.start_date');
  if (request.end_date !== null) result.add('request.end_date');
  if (request.destinations.length > 0) result.add('request.destinations');
  if (request.total_cost !== null) {
    result.add('request.total_cost.amount');
    result.add('request.total_cost.currency');
  }
  if (request.approval_notes.length > 0) result.add('request.approval_notes');
  return result;
}

class FixtureProvider implements Provider {
  readonly name = 'travel-request-summarizer-fixture';
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

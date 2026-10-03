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

interface ProtectedTerm {
  readonly kind: string;
  readonly value: string;
}

interface ProtectedTermResult extends ProtectedTerm {
  readonly preserved: true;
  readonly source_occurrences: number;
  readonly output_occurrences: number;
}

interface LocalizationOutput {
  readonly status: 'localized' | 'unchanged';
  readonly localized_text: string;
  readonly source_language: 'en' | 'ja';
  readonly target_language: 'en' | 'ja';
  readonly target_locale: 'en-US' | 'ja-JP';
  readonly policy_version: string;
  readonly protected_term_results: readonly ProtectedTermResult[];
  readonly changes: readonly Record<string, unknown>[];
}

interface DatasetCase {
  readonly id: string;
  readonly inputs: {
    readonly source_text: string;
    readonly source_language: 'en' | 'ja';
    readonly target: { readonly language: 'en' | 'ja'; readonly locale: 'en-US' | 'ja-JP' };
    readonly protected_terms: readonly ProtectedTerm[];
    readonly policy: Record<string, unknown>;
  };
  readonly expected_output: LocalizationOutput;
}

interface DatasetFixture {
  readonly cases: readonly DatasetCase[];
}

const data = testData('travel purpose localizer reference');
const blueprintPath = fileURLToPath(new URL('../travel-purpose-localizer.yaml', import.meta.url));
const datasetPath = fileURLToPath(new URL('../evaluations/travel-purpose-localizer.yaml', import.meta.url));
const policyPath = fileURLToPath(new URL('../fixtures/localization-policy-v1.yaml', import.meta.url));

test('travel Localizer passes every preservation case without policy drift', async () => {
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

  for (const fixture of dataset.cases) {
    assert.deepEqual(fixture.inputs.policy, policy, `${fixture.id}: policy drift`);
    assertOutputInvariants(fixture);
  }

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
  for (const request of provider.calls) assert.match(lastPrompt(request), /exact_case_sensitive/);
});

test('travel Localizer rejects malformed language, locale, policy, and text before generation', async () => {
  const provider = new FixtureProvider([]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));
  const policy = YAML.parse(await readFile(policyPath, 'utf8')) as Record<string, unknown>;
  const inputs = validInputs(policy);

  await assert.rejects(
    runtime.execute(blueprintPath, { ...inputs, source_text: '   ' }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, { ...inputs, target: { language: 'ja', locale: 'en-US' } }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      ...inputs,
      policy: { ...policy, version: data.text('invalid version') },
    }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      ...inputs,
      protected_terms: [{ kind: 'person', value: data.text('person'), extra: true }],
    }),
    error => error instanceof InputValidationError,
  );
  assert.equal(provider.calls.length, 0);
});

test('travel Localizer rejects a provider result that marks a protected term changed', async () => {
  const policy = YAML.parse(await readFile(policyPath, 'utf8')) as Record<string, unknown>;
  const protectedValue = data.text('protected person', 'Person');
  const provider = new FixtureProvider([{
    content: JSON.stringify({
      status: 'localized',
      localized_text: `翻訳 ${protectedValue}`,
      source_language: 'en',
      target_language: 'ja',
      target_locale: 'ja-JP',
      policy_version: '2026.1.0',
      protected_term_results: [{
        kind: 'person',
        value: protectedValue,
        preserved: false,
        source_occurrences: 1,
        output_occurrences: 1,
      }],
      changes: [{ kind: 'translation', source_fragment: 'Travel', localized_fragment: '出張' }],
    }),
  }]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));

  await assert.rejects(
    runtime.execute(blueprintPath, {
      source_text: `Travel ${protectedValue}`,
      source_language: 'en',
      target: { language: 'ja', locale: 'ja-JP' },
      protected_terms: [{ kind: 'person', value: protectedValue }],
      policy,
    }),
    error => error instanceof MaxRetryExceededError,
  );
  assert.equal(provider.calls.length, 1);
});

function assertOutputInvariants(fixture: DatasetCase): void {
  const output = fixture.expected_output;
  assert.equal(output.source_language, fixture.inputs.source_language, `${fixture.id}: source language`);
  assert.equal(output.target_language, fixture.inputs.target.language, `${fixture.id}: target language`);
  assert.equal(output.target_locale, fixture.inputs.target.locale, `${fixture.id}: target locale`);
  assert.equal(output.policy_version, '2026.1.0', `${fixture.id}: policy version`);
  assert.deepEqual(
    output.protected_term_results.map(({ kind, value }) => ({ kind, value })),
    fixture.inputs.protected_terms,
    `${fixture.id}: protected term order`,
  );
  assert.equal(
    lineBreakCount(output.localized_text),
    lineBreakCount(fixture.inputs.source_text),
    `${fixture.id}: line breaks`,
  );
  for (const term of output.protected_term_results) {
    assert.equal(term.preserved, true, `${fixture.id}: ${term.value} preserved`);
    assert.equal(term.source_occurrences, occurrenceCount(fixture.inputs.source_text, term.value));
    assert.equal(term.output_occurrences, occurrenceCount(output.localized_text, term.value));
    assert.equal(term.source_occurrences, term.output_occurrences, `${fixture.id}: ${term.value} count`);
  }
  if (output.status === 'unchanged') {
    assert.equal(output.localized_text, fixture.inputs.source_text, `${fixture.id}: unchanged text`);
    assert.deepEqual(output.changes, [], `${fixture.id}: unchanged changes`);
  } else {
    assert.ok(output.changes.length > 0, `${fixture.id}: localized changes`);
  }
  assert.ok(output.localized_text.length <= 1000, `${fixture.id}: output length`);
}

function occurrenceCount(text: string, value: string): number {
  let count = 0;
  let cursor = 0;
  while (cursor <= text.length - value.length) {
    const index = text.indexOf(value, cursor);
    if (index === -1) break;
    count += 1;
    cursor = index + value.length;
  }
  return count;
}

function lineBreakCount(value: string): number {
  return value.split('\n').length - 1;
}

function validInputs(policy: Record<string, unknown>): Record<string, unknown> {
  return {
    source_text: `Travel request ${data.text('request identifier', 'REQ')}`,
    source_language: 'en',
    target: { language: 'ja', locale: 'ja-JP' },
    protected_terms: [],
    policy,
  };
}

class FixtureProvider implements Provider {
  readonly name = 'travel-purpose-localizer-fixture';
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

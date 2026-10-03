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

const FIELD_ORDER = [
  'employee_id',
  'purpose',
  'start_date',
  'end_date',
  'destination_country_code',
  'estimated_cost',
  'currency',
] as const;

interface FieldResult {
  readonly field: string;
  readonly valid: boolean;
  readonly error_codes: readonly string[];
}

interface ValidationOutput {
  readonly form_valid: boolean;
  readonly rules_version: string;
  readonly field_results: readonly FieldResult[];
}

interface DatasetCase {
  readonly id: string;
  readonly inputs: {
    readonly form: Record<string, unknown>;
    readonly rules: Record<string, unknown>;
  };
  readonly expected_output: ValidationOutput;
}

interface DatasetFixture {
  readonly cases: readonly DatasetCase[];
}

const data = testData('travel request form validator reference');
const blueprintPath = fileURLToPath(new URL('../travel-request-form.yaml', import.meta.url));
const datasetPath = fileURLToPath(new URL('../evaluations/travel-request-form.yaml', import.meta.url));
const rulesPath = fileURLToPath(new URL('../fixtures/travel-form-rules-v1.yaml', import.meta.url));

test('travel form Validator passes every field-level rule case without policy drift', async () => {
  const [datasetSource, rulesSource] = await Promise.all([
    readFile(datasetPath, 'utf8'),
    readFile(rulesPath, 'utf8'),
  ]);
  const dataset = YAML.parse(datasetSource) as DatasetFixture;
  const rules = YAML.parse(rulesSource) as Record<string, unknown>;
  const provider = new FixtureProvider(dataset.cases.map(item => ({
    content: JSON.stringify(item.expected_output),
  })));
  const seed = requiredTestSeed();

  for (const fixture of dataset.cases) {
    assert.deepEqual(fixture.inputs.rules, rules, `${fixture.id}: rules drift`);
    assertOutputInvariants(fixture.id, fixture.expected_output);
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
  for (const request of provider.calls) {
    assert.match(lastPrompt(request), /2026\.1\.0/);
  }
});

test('travel form Validator rejects malformed envelopes and rules before generation', async () => {
  const provider = new FixtureProvider([]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));
  const rules = YAML.parse(await readFile(rulesPath, 'utf8')) as Record<string, unknown>;
  const form = validForm();

  const { currency: _currency, ...missingCurrency } = form;
  await assert.rejects(
    runtime.execute(blueprintPath, { form: missingCurrency, rules }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      form: { ...form, [data.text('unexpected field')]: data.text('value') },
      rules,
    }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      form,
      rules: { ...rules, allowed_currencies: [] },
    }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      form,
      rules: { ...rules, version: data.text('invalid version') },
    }),
    error => error instanceof InputValidationError,
  );
  assert.equal(provider.calls.length, 0);
});

test('travel form Validator rejects a valid field carrying an error code', async () => {
  const rules = YAML.parse(await readFile(rulesPath, 'utf8')) as Record<string, unknown>;
  const provider = new FixtureProvider([{
    content: JSON.stringify({
      form_valid: false,
      rules_version: '2026.1.0',
      field_results: FIELD_ORDER.map((field, index) => ({
        field,
        valid: true,
        error_codes: index === 0 ? ['invalid_employee_id_format'] : [],
      })),
    }),
  }]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));

  await assert.rejects(
    runtime.execute(blueprintPath, { form: validForm(), rules }),
    error => error instanceof MaxRetryExceededError,
  );
  assert.equal(provider.calls.length, 1);
});

function assertOutputInvariants(id: string, output: ValidationOutput): void {
  assert.deepEqual(output.field_results.map(result => result.field), FIELD_ORDER, `${id}: order`);
  for (const result of output.field_results) {
    assert.equal(result.valid, result.error_codes.length === 0, `${id}: ${result.field}`);
  }
  assert.equal(
    output.form_valid,
    output.field_results.every(result => result.valid),
    `${id}: aggregate`,
  );
  assert.equal(output.rules_version, '2026.1.0');
}

function validForm(): Record<string, unknown> {
  return {
    employee_id: data.text('employee', 'EMP').slice(0, 10),
    purpose: data.text('purpose', 'customer_workshop'),
    start_date: '2026-10-12',
    end_date: '2026-10-14',
    destination_country_code: 'US',
    estimated_cost: data.decimal('cost', 100, 1000),
    currency: 'USD',
  };
}

class FixtureProvider implements Provider {
  readonly name = 'travel-form-validator-fixture';
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

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
  'traveler_name',
  'document_number',
  'start_date',
  'end_date',
  'total_amount',
  'currency',
] as const;

interface FieldResult {
  readonly field: string;
  readonly status: 'matched' | 'mismatched' | 'unverified';
  readonly submitted_value: string | number | null;
  readonly extracted_value: string | number | null;
  readonly evidence: { readonly page: number; readonly text: string } | null;
  readonly reason_code: string;
}

interface VerificationOutput {
  readonly overall_status: 'verified' | 'mismatch' | 'incomplete';
  readonly policy_version: string;
  readonly field_results: readonly FieldResult[];
}

interface DatasetCase {
  readonly id: string;
  readonly inputs: {
    readonly submitted_fields: Record<string, unknown>;
    readonly extracted_fields: Record<string, unknown>;
    readonly comparison_policy: Record<string, unknown>;
  };
  readonly expected_output: VerificationOutput;
}

interface DatasetFixture {
  readonly cases: readonly DatasetCase[];
}

const data = testData('travel document evidence verifier reference');
const blueprintPath = fileURLToPath(new URL('../travel-document-evidence.yaml', import.meta.url));
const datasetPath = fileURLToPath(new URL('../evaluations/travel-document-evidence.yaml', import.meta.url));
const evidencePath = fileURLToPath(new URL('../fixtures/travel-document-evidence-v1.yaml', import.meta.url));
const policyPath = fileURLToPath(new URL('../fixtures/verification-policy-v1.yaml', import.meta.url));

test('travel evidence Verifier passes match, mismatch, and source-gap cases', async () => {
  const [datasetSource, evidenceSource, policySource] = await Promise.all([
    readFile(datasetPath, 'utf8'),
    readFile(evidencePath, 'utf8'),
    readFile(policyPath, 'utf8'),
  ]);
  const dataset = YAML.parse(datasetSource) as DatasetFixture;
  const evidence = YAML.parse(evidenceSource) as Record<string, unknown>;
  const policy = YAML.parse(policySource) as Record<string, unknown>;
  const provider = new FixtureProvider(dataset.cases.map(item => ({
    content: JSON.stringify(item.expected_output),
  })));
  const seed = requiredTestSeed();

  assert.deepEqual(dataset.cases[0]?.inputs.extracted_fields, evidence);
  for (const fixture of dataset.cases) {
    assert.deepEqual(fixture.inputs.comparison_policy, policy, `${fixture.id}: policy drift`);
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
  for (const request of provider.calls) assert.match(lastPrompt(request), /2026\.1\.0/);
});

test('travel evidence Verifier rejects malformed evidence and policy before generation', async () => {
  const provider = new FixtureProvider([]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));
  const [evidence, policy] = await Promise.all([
    readYaml(evidencePath),
    readYaml(policyPath),
  ]);
  const submitted = submittedFields();

  await assert.rejects(
    runtime.execute(blueprintPath, {
      submitted_fields: submitted,
      extracted_fields: {
        ...evidence,
        traveler_name: { status: 'found', value: data.person('traveler'), evidence: null },
      },
      comparison_policy: policy,
    }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      submitted_fields: submitted,
      extracted_fields: {
        ...evidence,
        document_number: {
          status: 'not_found',
          value: null,
          evidence: { page: 1, text: data.text('unexpected evidence') },
        },
      },
      comparison_policy: policy,
    }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      submitted_fields: { ...submitted, start_date: data.text('invalid date') },
      extracted_fields: evidence,
      comparison_policy: policy,
    }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      submitted_fields: submitted,
      extracted_fields: evidence,
      comparison_policy: { ...policy, numeric_tolerance: -0.01 },
    }),
    error => error instanceof InputValidationError,
  );
  assert.equal(provider.calls.length, 0);
});

test('travel evidence Verifier rejects a mismatch without source evidence', async () => {
  const [evidence, policy] = await Promise.all([
    readYaml(evidencePath),
    readYaml(policyPath),
  ]);
  const submitted = submittedFields();
  const provider = new FixtureProvider([{
    content: JSON.stringify({
      overall_status: 'mismatch',
      policy_version: '2026.1.0',
      field_results: FIELD_ORDER.map((field, index) => ({
        field,
        status: index === 0 ? 'mismatched' : 'matched',
        submitted_value: index === 0 ? data.person('submitted') : valueAt(submitted, field),
        extracted_value: valueAt(evidence, field),
        evidence: index === 0 ? null : evidenceAt(evidence, field),
        reason_code: index === 0 ? 'value_mismatch' : 'exact_match',
      })),
    }),
  }]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));

  await assert.rejects(
    runtime.execute(blueprintPath, {
      submitted_fields: submitted,
      extracted_fields: evidence,
      comparison_policy: policy,
    }),
    error => error instanceof MaxRetryExceededError,
  );
  assert.equal(provider.calls.length, 1);
});

function assertOutputInvariants(id: string, output: VerificationOutput): void {
  assert.deepEqual(output.field_results.map(result => result.field), FIELD_ORDER, `${id}: order`);
  const statuses = new Set(output.field_results.map(result => result.status));
  const expectedOverall = statuses.has('mismatched')
    ? 'mismatch'
    : statuses.has('unverified') ? 'incomplete' : 'verified';
  assert.equal(output.overall_status, expectedOverall, `${id}: aggregate`);
  assert.equal(output.policy_version, '2026.1.0');
  for (const result of output.field_results) {
    if (result.status === 'mismatched') {
      assert.notEqual(result.submitted_value, null, `${id}: submitted mismatch value`);
      assert.notEqual(result.extracted_value, null, `${id}: extracted mismatch value`);
      assert.notEqual(result.evidence, null, `${id}: mismatch evidence`);
    }
  }
}

function submittedFields(): Record<string, unknown> {
  return {
    traveler_name: data.person('traveler'),
    document_number: data.text('document', 'TR'),
    start_date: '2026-09-14',
    end_date: '2026-09-18',
    total_amount: data.decimal('amount', 100, 5000),
    currency: 'USD',
  };
}

function valueAt(record: Record<string, unknown>, field: string): unknown {
  const value = record[field];
  if (value && typeof value === 'object' && 'value' in value) {
    return (value as { readonly value: unknown }).value;
  }
  return value;
}

function evidenceAt(record: Record<string, unknown>, field: string): unknown {
  const value = record[field];
  if (value && typeof value === 'object' && 'evidence' in value) {
    return (value as { readonly evidence: unknown }).evidence;
  }
  return null;
}

async function readYaml(path: string): Promise<Record<string, unknown>> {
  return YAML.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

class FixtureProvider implements Provider {
  readonly name = 'travel-document-verifier-fixture';
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

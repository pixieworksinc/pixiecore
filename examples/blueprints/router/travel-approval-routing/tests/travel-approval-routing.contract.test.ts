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

interface RouteCandidate {
  readonly rule_id: string;
  readonly priority: number;
  readonly next_user: string;
}

interface RoutingOutput {
  readonly status: 'routed' | 'no_match' | 'ambiguous' | 'unavailable';
  readonly next_user: string | null;
  readonly matched_rule: string | null;
  readonly matched_priority: number | null;
  readonly reason_code: string;
  readonly routing_table_version: string;
  readonly candidates: readonly RouteCandidate[];
}

interface DatasetCase {
  readonly id: string;
  readonly inputs: {
    readonly request: Record<string, unknown>;
    readonly routing_table_version: string;
    readonly routing_csv: string;
  };
  readonly expected_output: RoutingOutput;
}

interface DatasetFixture {
  readonly cases: readonly DatasetCase[];
}

const data = testData('travel approval router reference');
const blueprintPath = fileURLToPath(new URL('../travel-approval-routing.yaml', import.meta.url));
const datasetPath = fileURLToPath(new URL('../evaluations/travel-approval-routing.yaml', import.meta.url));
const routingTablePath = fileURLToPath(new URL('../fixtures/travel-approval-routing-v1.csv', import.meta.url));

test('travel Router passes every CSV priority case without table drift', async () => {
  const [datasetSource, routingCsv] = await Promise.all([
    readFile(datasetPath, 'utf8'),
    readFile(routingTablePath, 'utf8'),
  ]);
  const dataset = YAML.parse(datasetSource) as DatasetFixture;
  const provider = new FixtureProvider(dataset.cases.map(item => ({
    content: JSON.stringify(item.expected_output),
  })));
  const seed = requiredTestSeed();

  for (const fixture of dataset.cases) {
    assert.equal(fixture.inputs.routing_csv, routingCsv, `${fixture.id}: routing CSV drift`);
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
  for (const [index, request] of provider.calls.entries()) {
    const prompt = lastPrompt(request);
    assert.match(prompt, /2026\.1\.0/);
    assert.match(prompt, new RegExp(dataset.cases[index]!.inputs.request.country_code as string));
  }
});

test('travel Router rejects malformed request and table inputs before generation', async () => {
  const provider = new FixtureProvider([]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));
  const routingCsv = await readFile(routingTablePath, 'utf8');
  const request = validRequest();

  await assert.rejects(
    runtime.execute(blueprintPath, { request, routing_table_version: '2026.1.0', routing_csv: '   ' }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      request,
      routing_table_version: data.text('invalid version'),
      routing_csv: routingCsv,
    }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      request: { ...request, estimated_cost: -data.decimal('negative cost', 1, 100) },
      routing_table_version: '2026.1.0',
      routing_csv: routingCsv,
    }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      request: { ...request, [data.text('extra key')]: data.text('extra value') },
      routing_table_version: '2026.1.0',
      routing_csv: routingCsv,
    }),
    error => error instanceof InputValidationError,
  );
  assert.equal(provider.calls.length, 0);
});

test('travel Router rejects ambiguity with fewer than two candidates', async () => {
  const routingCsv = await readFile(routingTablePath, 'utf8');
  const provider = new FixtureProvider([{
    content: JSON.stringify({
      status: 'ambiguous',
      next_user: null,
      matched_rule: null,
      matched_priority: 5,
      reason_code: 'same_priority_matches',
      routing_table_version: '2026.1.0',
      candidates: [{
        rule_id: 'route:only-candidate',
        priority: 5,
        next_user: 'one@example.test',
      }],
    }),
  }]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));

  await assert.rejects(
    runtime.execute(blueprintPath, {
      request: validRequest(),
      routing_table_version: '2026.1.0',
      routing_csv: routingCsv,
    }),
    error => error instanceof MaxRetryExceededError,
  );
  assert.equal(provider.calls.length, 1);
});

function assertOutputInvariants(id: string, output: RoutingOutput): void {
  assert.equal(output.routing_table_version, '2026.1.0', `${id}: table version`);
  if (output.status === 'ambiguous') {
    assert.equal(output.next_user, null, `${id}: ambiguous next user`);
    assert.equal(output.matched_rule, null, `${id}: ambiguous matched rule`);
    assert.ok(output.matched_priority !== null, `${id}: ambiguous priority`);
    assert.ok(output.candidates.length >= 2, `${id}: ambiguous candidates`);
    for (const candidate of output.candidates) {
      assert.equal(candidate.priority, output.matched_priority, `${id}: candidate priority`);
    }
    return;
  }
  assert.deepEqual(output.candidates, [], `${id}: non-ambiguous candidates`);
  if (output.status === 'no_match') {
    assert.equal(output.next_user, null, `${id}: no-match next user`);
    assert.equal(output.matched_rule, null, `${id}: no-match rule`);
    assert.equal(output.matched_priority, null, `${id}: no-match priority`);
    return;
  }
  assert.ok(output.next_user, `${id}: selected user`);
  assert.ok(output.matched_rule, `${id}: selected rule`);
  assert.ok(output.matched_priority !== null, `${id}: selected priority`);
}

function validRequest(): Record<string, unknown> {
  return {
    country_code: 'US',
    destination_level: 'A',
    estimated_cost: data.decimal('estimated cost', 100, 4000),
    currency: 'USD',
  };
}

class FixtureProvider implements Provider {
  readonly name = 'travel-approval-router-fixture';
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

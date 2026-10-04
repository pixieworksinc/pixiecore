import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import YAML from 'yaml';
import {
  runBlueprintEvaluation,
  runBlueprintPlayground,
} from '../../src/core/kernel/evaluation/index.js';
import { evaluationPricingRules } from '../../src/core/kernel/evaluation/accounting.js';
import { ScriptedProvider } from '../helpers/fake-provider.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const data = testData('evaluation runner contract');

test('evaluation runner emits a versioned replayable artifact and preserves failed cases', async () => {
  await withTempDirectory(async directory => {
    const fixture = await writeFixture(directory, [
      evaluationCase('passing', { value: 'expected' }),
      evaluationCase('failing', { value: 'different' }),
    ]);
    const providerName = data.text('provider name', 'provider');
    const model = data.text('model name', 'model');
    const seed = data.text('evaluation seed', 'seed');
    const artifact = await runBlueprintEvaluation({
      cwd: directory,
      datasetPath: 'evaluations/dataset.yaml',
      seed,
      runtimeOptions: {
        provider: new ScriptedProvider([
          {
            content: JSON.stringify({ value: 'expected' }),
            usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
          },
          {
            content: JSON.stringify({ value: 'actual' }),
            usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
          },
        ], { name: providerName, model }),
        maxRetry: 0,
        mcpConfigPath: 'disabled',
        pluginConfigPath: 'disabled',
      },
      pricing: [pricingRule(providerName, model)],
    });

    assert.equal(artifact.schema, 'pixiecore.blueprint-eval-result/v1');
    assert.deepEqual(artifact.summary, { total: 2, passed: 1, failed: 1, errors: 0 });
    assert.equal(artifact.run.seed, seed);
    assert.equal(artifact.run.seed_scope, 'runner');
    assert.equal(artifact.run.provider, providerName);
    assert.equal(artifact.run.model, model);
    assert.equal(artifact.run.temperature, 0);
    assert.deepEqual(artifact.cases.map(item => item.status), ['passed', 'failed']);
    assert.deepEqual(artifact.cases[0]?.tags, ['contract', 'case']);
    assert.deepEqual(artifact.cases[1]?.actual_output, { value: 'actual' });
    assert.equal(artifact.cases[1]?.differences?.[0]?.reason, 'not_equal');
    assert.deepEqual(artifact.cases[0]?.provider_usage, [{
      provider: providerName,
      model,
      calls: 1,
      input_tokens: 10,
      output_tokens: 4,
      total_tokens: 14,
      estimated_cost: { currency: 'USD', amount: 0.000052 },
      cost_status: 'calculated',
      pricing: {
        currency: 'USD',
        input_per_million_tokens: 2,
        output_per_million_tokens: 8,
        source: 'https://pricing.example/evaluation',
        effective_at: '2026-08-26T00:00:00.000Z',
      },
    }]);
    assert.equal(artifact.cases[1]?.provider_usage?.[0]?.estimated_cost?.amount, 0.000064);
    assert.equal(artifact.replay_command, `pixiecore blueprint eval evaluations/dataset.yaml --seed=${seed}`);
    assert.match(artifact.dataset.sha256, /^[0-9a-f]{64}$/);
    assert.match(artifact.blueprint.sha256, /^[0-9a-f]{64}$/);
    assert.equal(artifact.dataset.path, 'evaluations/dataset.yaml');
    assert.equal(artifact.blueprint.path, 'blueprints/fixture.yaml');

    const schema = JSON.parse(await readFile(
      join(process.cwd(), 'schemas', 'pixiecore.blueprint-eval-result-v1.schema.json'),
      'utf8',
    )) as object;
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    assert.equal(validate(artifact), true, JSON.stringify(validate.errors));
    assert.equal(fixture.blueprintVersion, artifact.blueprint.version);
  });
});

test('evaluation runner records execution errors without aborting later cases', async () => {
  await withTempDirectory(async directory => {
    await writeFixture(directory, [
      evaluationCase('error', { value: 'unused' }),
      evaluationCase('after-error', { value: 'recovered' }),
    ]);
    const failure = data.text('provider failure', 'failure');
    const artifact = await runBlueprintEvaluation({
      cwd: directory,
      datasetPath: 'evaluations/dataset.yaml',
      seed: data.text('error seed', 'seed'),
      runtimeOptions: {
        provider: new ScriptedProvider([
          () => { throw new Error(failure); },
          {
            content: JSON.stringify({ value: 'recovered' }),
            usage: { inputTokens: 9, outputTokens: 3, totalTokens: 12 },
          },
        ]),
        maxRetry: 0,
        mcpConfigPath: 'disabled',
        pluginConfigPath: 'disabled',
      },
    });

    assert.deepEqual(artifact.summary, { total: 2, passed: 1, failed: 0, errors: 1 });
    assert.equal(artifact.cases[0]?.status, 'error');
    assert.deepEqual(artifact.cases[0]?.provider_usage, [{
      provider: 'fake',
      model: 'fake-1',
      calls: 1,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      estimated_cost: null,
      cost_status: 'missing_usage',
      pricing: null,
    }]);
    assert.match(artifact.cases[0]?.error?.message ?? '', new RegExp(failure));
    assert.equal(artifact.cases[1]?.status, 'passed');
  });
});

test('evaluation runner supplies inputs to the built-in traceable-summary comparator', async () => {
  const datasetPath = 'examples/blueprints/summarizer/travel-request-summary/evaluations/travel-request-summary.yaml';
  const dataset = YAML.parse(await readFile(datasetPath, 'utf8')) as {
    readonly cases: readonly { readonly expected_output: Record<string, unknown> }[];
  };
  const summary = 'Customer contract renewal meetings are in San Francisco, US and Los Angeles, US from 2026-09-14 through 2026-09-18. Projected cost: USD 2840.50. Hotel cap exception requires review.';
  const alternativeOutput = {
    status: 'summarized',
    summary,
    character_count: [...summary].length,
    claims: [
      {
        text: 'Customer contract renewal meetings are in San Francisco, US and Los Angeles, US from 2026-09-14 through 2026-09-18.',
        source_fields: [
          'request.purpose',
          'request.start_date',
          'request.end_date',
          'request.destinations',
        ],
      },
      {
        text: 'Projected cost: USD 2840.50.',
        source_fields: ['request.total_cost.amount', 'request.total_cost.currency'],
      },
      {
        text: 'Hotel cap exception requires review.',
        source_fields: ['request.approval_notes'],
      },
    ],
    omitted_source_fields: [],
    missing_source_fields: [],
  };
  const outputs = dataset.cases.map((item, index) => index === 0
    ? alternativeOutput
    : item.expected_output);
  const artifact = await runBlueprintEvaluation({
    datasetPath,
    seed: data.text('traceable summary seed', 'seed'),
    runtimeOptions: {
      provider: new ScriptedProvider(outputs.map(output => ({ content: JSON.stringify(output) }))),
      maxRetry: 0,
      mcpConfigPath: 'disabled',
      pluginConfigPath: 'disabled',
    },
  });
  assert.deepEqual(artifact.summary, { total: 8, passed: 8, failed: 0, errors: 0 });
  for (const result of artifact.cases) {
    assert.deepEqual(result.limitations, ['factuality_not_evaluated']);
  }
  const schema = JSON.parse(await readFile('schemas/pixiecore.blueprint-eval-result-v1.schema.json', 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors));
  const legacy = structuredClone(artifact);
  for (const result of legacy.cases) Reflect.deleteProperty(result, 'limitations');
  assert.equal(validate(legacy), true, JSON.stringify(validate.errors));
});

test('evaluation runner rejects invalid datasets, duplicate IDs, version mismatch, and Blueprint path escape', async () => {
  await withTempDirectory(async directory => {
    await mkdir(join(directory, 'evaluations'), { recursive: true });
    await writeFile(join(directory, 'evaluations', 'dataset.yaml'), '{}\n', 'utf8');
    await assert.rejects(
      runBlueprintEvaluation({
        cwd: directory,
        datasetPath: 'evaluations/dataset.yaml',
        runtimeOptions: runtimeOptions(),
      }),
      /Invalid evaluation dataset:/,
    );

    const duplicate = evaluationCase('duplicate', { value: 'expected' });
    await writeFixture(directory, [duplicate, duplicate]);
    await assert.rejects(
      runBlueprintEvaluation({
        cwd: directory,
        datasetPath: 'evaluations/dataset.yaml',
        runtimeOptions: runtimeOptions(),
      }),
      /Duplicate evaluation case id: duplicate/,
    );

    await writeFixture(directory, [evaluationCase('version', { value: 'expected' })], {
      requiredVersion: '2.0',
    });
    await assert.rejects(
      runBlueprintEvaluation({
        cwd: directory,
        datasetPath: 'evaluations/dataset.yaml',
        runtimeOptions: runtimeOptions(),
      }),
      /requires Blueprint version 2\.0; found 1\.0/,
    );

    await writeFile(join(directory, 'evaluations', 'dataset.yaml'), datasetYaml(
      [evaluationCase('escape', { value: 'expected' })],
      '../../outside.yaml',
    ), 'utf8');
    await assert.rejects(
      runBlueprintEvaluation({
        cwd: directory,
        datasetPath: 'evaluations/dataset.yaml',
        runtimeOptions: runtimeOptions(),
      }),
      /blueprint\.path escapes the project root/,
    );
  });
});

test('Blueprint playground runs one case in offline mock and real comparison modes', async () => {
  await withTempDirectory(async directory => {
    await writeFixture(directory, [evaluationCase('selected-case', { value: 'expected' })]);
    const base = {
      cwd: directory,
      datasetPath: 'evaluations/dataset.yaml',
      caseId: 'selected-case',
    };
    const mock = await runBlueprintPlayground(base);
    assert.equal(mock.schema, 'pixiecore.blueprint-playground/v1');
    assert.equal(mock.mode, 'mock');
    assert.deepEqual(mock.mock, {
      provider: 'playground-mock',
      model: 'dataset-expected-output',
      output: { value: 'expected' },
    });
    assert.equal(mock.real, undefined);
    assert.equal(
      mock.replay_command,
      'pixiecore blueprint play evaluations/dataset.yaml --case=selected-case --mode=mock',
    );

    const providerName = data.text('playground real provider', 'provider');
    const both = await runBlueprintPlayground({
      ...base,
      mode: 'both',
      runtimeOptions: {
        provider: new ScriptedProvider([
          {
            content: JSON.stringify({ value: 'actual' }),
            usage: { inputTokens: 20, outputTokens: 6, totalTokens: 26 },
          },
        ], { name: providerName, model: 'real-model' }),
        maxRetry: 0,
        mcpConfigPath: 'disabled',
        pluginConfigPath: 'disabled',
      },
      pricing: [pricingRule(providerName, 'real-model')],
    });
    assert.equal(both.mock?.provider, 'playground-mock');
    assert.equal(both.real?.provider, providerName);
    assert.deepEqual(both.real?.output, { value: 'actual' });
    assert.equal(both.real?.provider_usage?.[0]?.input_tokens, 20);
    assert.equal(both.real?.provider_usage?.[0]?.output_tokens, 6);
    assert.equal(both.real?.provider_usage?.[0]?.estimated_cost?.amount, 0.000088);
    assert.equal(both.real?.comparison.passed, false);
    assert.equal(both.real?.comparison.differences[0]?.reason, 'not_equal');
  });
});

test('evaluation pricing auto-applies only to the official OpenAI endpoint and allows overrides', () => {
  const automatic = evaluationPricingRules(undefined, {}, undefined);
  assert.deepEqual(automatic, [{
    provider: 'openai',
    model: 'gpt-4.1-mini',
    currency: 'USD',
    inputPerMillionTokens: 0.4,
    outputPerMillionTokens: 1.6,
    source: 'https://developers.openai.com/api/docs/pricing',
    effectiveAt: '2026-08-26T00:00:00.000Z',
  }]);

  assert.deepEqual(evaluationPricingRules(undefined, {
    OPENAI_BASE_URL: 'https://openai-compatible.example/v1',
  }, undefined), []);
  assert.deepEqual(evaluationPricingRules({
    provider: new ScriptedProvider([]),
  }, {}, undefined), []);

  const override = pricingRule('openai', 'gpt-4.1-mini');
  assert.deepEqual(evaluationPricingRules(undefined, {}, [override]), [override]);
  assert.throws(
    () => evaluationPricingRules(undefined, {}, [override, { ...override }]),
    /Duplicate evaluation pricing rule: openai\/gpt-4\.1-mini/u,
  );
});

test('real playground artifacts apply bundled OpenAI pricing without live network traffic', async () => {
  await withTempDirectory(async directory => {
    await writeFixture(directory, [evaluationCase('priced-openai', { value: 'actual' })]);
    const artifact = await runBlueprintPlayground({
      cwd: directory,
      datasetPath: 'evaluations/dataset.yaml',
      caseId: 'priced-openai',
      mode: 'real',
      runtimeOptions: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        environment: { OPENAI_API_KEY: 'test-key' },
        fetch: async () => Response.json({
          choices: [{ message: { content: JSON.stringify({ value: 'actual' }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
        }),
        maxRetry: 0,
        mcpConfigPath: 'disabled',
        pluginConfigPath: 'disabled',
        logToConsole: false,
        logToFile: false,
      },
    });

    assert.deepEqual(artifact.real?.provider_usage, [{
      provider: 'openai',
      model: 'gpt-4.1-mini',
      calls: 1,
      input_tokens: 100,
      output_tokens: 25,
      total_tokens: 125,
      estimated_cost: { currency: 'USD', amount: 0.00008 },
      cost_status: 'calculated',
      pricing: {
        currency: 'USD',
        input_per_million_tokens: 0.4,
        output_per_million_tokens: 1.6,
        source: 'https://developers.openai.com/api/docs/pricing',
        effective_at: '2026-08-26T00:00:00.000Z',
      },
    }]);
  });
});

test('Blueprint playground rejects unknown cases and invalid runtime modes', async () => {
  await withTempDirectory(async directory => {
    await writeFixture(directory, [evaluationCase('known-case', { value: 'expected' })]);
    const base = { cwd: directory, datasetPath: 'evaluations/dataset.yaml' };
    await assert.rejects(
      runBlueprintPlayground({ ...base, caseId: 'missing-case' }),
      /Unknown evaluation case id: missing-case/u,
    );
    await assert.rejects(
      runBlueprintPlayground({ ...base, caseId: 'known-case', mode: 'invalid' as never }),
      /mode must be mock, real, or both/u,
    );
  });
});

function evaluationCase(id: string, expected: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    tags: ['case'],
    inputs: { source: data.text(`input ${id}`, 'input') },
    expected_output: expected,
    comparison: { mode: 'exact' },
  };
}

function pricingRule(provider: string, model: string) {
  return {
    provider,
    model,
    currency: 'USD',
    inputPerMillionTokens: 2,
    outputPerMillionTokens: 8,
    source: 'https://pricing.example/evaluation',
    effectiveAt: '2026-08-26T00:00:00.000Z',
  } as const;
}

async function writeFixture(
  directory: string,
  cases: readonly Record<string, unknown>[],
  options: { requiredVersion?: string } = {},
): Promise<{ blueprintVersion: string }> {
  await mkdir(join(directory, 'blueprints'), { recursive: true });
  await mkdir(join(directory, 'evaluations'), { recursive: true });
  await writeFile(join(directory, 'package.json'), '{"name":"evaluation-fixture","private":true}\n', 'utf8');
  await writeFile(join(directory, 'blueprints', 'fixture.yaml'), blueprintYaml(), 'utf8');
  await writeFile(join(directory, 'evaluations', 'dataset.yaml'), datasetYaml(
    cases,
    '../blueprints/fixture.yaml',
    options.requiredVersion,
  ), 'utf8');
  return { blueprintVersion: '1.0' };
}

function blueprintYaml(): string {
  return `
name: Evaluation fixture
version: '1.0'
role: assistant
prompt: Return a value for {source}
temperature: 0
input_placeholders:
  - name: source
    type: string
    required: true
output_schema:
  type: object
  additionalProperties: false
  required: [value]
  properties:
    value: { type: string }
`;
}

function datasetYaml(
  cases: readonly Record<string, unknown>[],
  blueprintPath: string,
  requiredVersion = '1.0',
): string {
  return `
schema: pixiecore.blueprint-eval-dataset/v1
name: Evaluation fixture
version: 1.0.0
blueprint:
  path: ${JSON.stringify(blueprintPath)}
  version: '${requiredVersion}'
tags: [contract]
cases:
${YAML.stringify(cases).trimEnd().split('\n').map(line => `  ${line}`).join('\n')}
`;
}

function runtimeOptions() {
  return {
    provider: new ScriptedProvider([{ content: JSON.stringify({ value: 'expected' }) }]),
    maxRetry: 0,
    mcpConfigPath: 'disabled' as const,
    pluginConfigPath: 'disabled' as const,
  };
}

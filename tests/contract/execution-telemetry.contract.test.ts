import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { PromptRuntime, PixieCoreError, PixieCoreLogger, logLlmResponse } from '@pixieworks/pixiecore';
import {
  EXECUTION_TELEMETRY_SCHEMA,
  ExecutionTelemetryRecorder,
} from '../../src/core/kernel/telemetry/index.js';
import { ScriptedProvider } from '../helpers/fake-provider.js';
import { testData } from '../helpers/test-data.js';

const data = testData('execution telemetry');
const schema = JSON.parse(await readFile(fileURLToPath(new URL(
  '../../schemas/pixiecore.execution-telemetry-v1.schema.json',
  import.meta.url,
)), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

test('telemetry aggregates application retries, usage, pricing, latency, and value-free failures', async () => {
  const logger = new PixieCoreLogger();
  const failure = new PixieCoreError(data.text('private failure message'), 'temporary_failure');
  const recorder = new ExecutionTelemetryRecorder({
    telemetryId: data.text('telemetry ID', 'telemetry'),
    pricing: [{
      provider: 'fixture-provider',
      model: 'fixture-model',
      currency: 'USD',
      inputPerMillionTokens: 2,
      outputPerMillionTokens: 8,
      source: 'https://pricing.example/fixture',
      effectiveAt: '2026-08-25T00:00:00.000Z',
    }],
  });
  const common = {
    unitType: 'node' as const,
    unitId: data.text('node ID', 'node'),
    blueprintVersion: '1.2.3',
    logger,
    retryOwner: 'application' as const,
  };

  await assert.rejects(recorder.runUnit({ ...common, attempt: 1 }, async () => {
    logLlmResponse('fixture-provider', 'fixture-model', {
      content: '{}',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    }, 1, logger);
    throw failure;
  }), error => error === failure);

  const value = await recorder.runUnit({ ...common, attempt: 2 }, async () => {
    logLlmResponse('fixture-provider', 'fixture-model', {
      content: '{}',
      usage: { inputTokens: 20, outputTokens: 6, totalTokens: 26 },
    }, 1, logger);
    return data.text('telemetry result');
  });
  const artifact = recorder.finish();

  assert.equal(value, data.text('telemetry result'));
  assert.equal(artifact.schema, EXECUTION_TELEMETRY_SCHEMA);
  assert.equal(artifact.result, 'succeeded');
  assert.equal(artifact.units[0]?.attempts, 2);
  assert.deepEqual(artifact.units[0]?.retries, {
    runtime: 0,
    application: 1,
    host: 0,
    total: 1,
  });
  assert.equal(artifact.units[0]?.failure_count, 1);
  assert.deepEqual(artifact.units[0]?.error_codes, ['temporary_failure']);
  assert.deepEqual(artifact.units[0]?.tokens, {
    input_tokens: 30,
    output_tokens: 10,
    total_tokens: 40,
  });
  assert.equal(artifact.units[0]?.token_complete, true);
  assert.deepEqual(artifact.units[0]?.costs, [{ currency: 'USD', amount: 0.00014 }]);
  assert.equal(artifact.units[0]?.cost_complete, true);
  assert.equal(artifact.totals.provider_calls, 2);
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors));
  assert.doesNotMatch(JSON.stringify(artifact), new RegExp(failure.message));
  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(Object.isFrozen(artifact.units[0]?.provider_usage[0]), true);
});

test('PromptRuntime output correction emits an exact runtime retry count', async () => {
  const name = data.person('retry subject');
  const greeting = `Hello ${name}`;
  const provider = new ScriptedProvider([
    {
      content: JSON.stringify({ wrong: data.text('wrong output') }),
      usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 },
    },
    {
      content: JSON.stringify({ greeting }),
      usage: { inputTokens: 11, outputTokens: 3, totalTokens: 14 },
    },
  ]);
  const runtime = new PromptRuntime({
    provider,
    mcpConfigPath: 'disabled',
    logToConsole: false,
    maxRetry: 2,
  });
  const recorder = new ExecutionTelemetryRecorder();
  try {
    const result = await recorder.runUnit({
      unitType: 'blueprint',
      unitId: data.text('Blueprint ID', 'blueprint'),
      blueprintVersion: '1.0.0',
      logger: runtime.logger,
      retryOwner: 'runtime',
    }, () => runtime.executeYaml(`
name: Telemetry retry
version: '1.0.0'
role: assistant
prompt: Greet {{ name }}
input_placeholders:
  - name: name
    type: string
    required: true
output_schema:
  type: object
  additionalProperties: false
  required: [greeting]
  properties:
    greeting: { type: string }
`, { name }));
    assert.deepEqual(result, { greeting });
  } finally {
    await runtime.close();
  }

  const artifact = recorder.finish();
  assert.equal(artifact.units[0]?.retries.runtime, 1);
  assert.equal(artifact.units[0]?.attempts, 1);
  assert.equal(artifact.units[0]?.provider_usage[0]?.calls, 2);
  assert.deepEqual(artifact.units[0]?.tokens, {
    input_tokens: 18,
    output_tokens: 5,
    total_tokens: 23,
  });
  assert.equal(artifact.units[0]?.cost_complete, false);
  assert.equal(artifact.units[0]?.provider_usage[0]?.cost_status, 'missing_pricing');
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors));
});

test('telemetry distinguishes missing usage from missing pricing without estimating cost', async () => {
  const logger = new PixieCoreLogger();
  const recorder = new ExecutionTelemetryRecorder();
  await recorder.runUnit({
    unitType: 'blueprint',
    unitId: data.text('incomplete usage Blueprint'),
    blueprintVersion: '2.0.0',
    logger,
  }, async () => {
    logLlmResponse('unknown-provider', 'unknown-model', {
      content: '{}',
      usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 },
    }, 1, logger);
    logLlmResponse('unknown-provider', 'unknown-model', { content: '{}' }, 1, logger);
  });
  const artifact = recorder.finish();
  assert.equal(artifact.units[0]?.provider_usage[0]?.tokens, null);
  assert.equal(artifact.units[0]?.token_complete, false);
  assert.equal(artifact.units[0]?.provider_usage[0]?.cost, null);
  assert.equal(artifact.units[0]?.provider_usage[0]?.cost_status, 'missing_usage');
  assert.deepEqual(artifact.units[0]?.costs, []);
  assert.equal(artifact.units[0]?.cost_complete, false);
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors));
});

test('failed and cancelled units remain distinct and never retain exception messages', async () => {
  const logger = new PixieCoreLogger();
  const failed = new ExecutionTelemetryRecorder();
  const failure = new PixieCoreError(data.text('hidden terminal failure'), 'terminal_failure');
  await assert.rejects(failed.runUnit({
    unitType: 'node',
    unitId: data.text('failed node'),
    blueprintVersion: '1.0.0',
    logger,
  }, async () => { throw failure; }), error => error === failure);
  const failedArtifact = failed.finish();
  assert.equal(failedArtifact.result, 'failed');
  assert.equal(failedArtifact.totals.failure_count, 1);
  assert.deepEqual(failedArtifact.units[0]?.error_codes, ['terminal_failure']);
  assert.doesNotMatch(JSON.stringify(failedArtifact), new RegExp(failure.message));

  const cancelled = new ExecutionTelemetryRecorder();
  const controller = new AbortController();
  const reason = new DOMException(data.text('hidden cancellation'), 'AbortError');
  controller.abort(reason);
  await assert.rejects(cancelled.runUnit({
    unitType: 'blueprint',
    unitId: data.text('cancelled Blueprint'),
    blueprintVersion: '1.0.0',
    logger,
    signal: controller.signal,
  }, async () => { throw reason; }), error => error === reason);
  const cancelledArtifact = cancelled.finish();
  assert.equal(cancelledArtifact.result, 'cancelled');
  assert.equal(cancelledArtifact.totals.failure_count, 0);
  assert.equal(cancelledArtifact.units[0]?.retries.total, 0);
  assert.doesNotMatch(JSON.stringify(cancelledArtifact), new RegExp(reason.message));
});

test('telemetry rejects ambiguous pricing, attempts, identity, and premature finish', async () => {
  const duplicatePricing = {
    provider: 'provider',
    model: 'model',
    currency: 'USD',
    inputPerMillionTokens: 1,
    outputPerMillionTokens: 1,
    source: 'https://pricing.example/model',
    effectiveAt: '2026-08-25T00:00:00.000Z',
  };
  assert.throws(() => new ExecutionTelemetryRecorder({ pricing: [duplicatePricing, duplicatePricing] }), /Duplicate/u);
  assert.throws(() => new ExecutionTelemetryRecorder({
    pricing: [{ ...duplicatePricing, effectiveAt: 'not-a-date' }],
  }), /effectiveAt/u);
  const recorder = new ExecutionTelemetryRecorder();
  const logger = new PixieCoreLogger();
  await assert.rejects(recorder.runUnit({
    unitType: 'node',
    unitId: ' ',
    blueprintVersion: '1.0.0',
    logger,
  }, async () => undefined), /non-blank/u);
  await assert.rejects(recorder.runUnit({
    unitType: 'node',
    unitId: 'node',
    blueprintVersion: '1.0.0',
    logger,
    attempt: 2,
  }, async () => undefined), /must be 1/u);

  let release!: () => void;
  const pending = recorder.runUnit({
    unitType: 'node',
    unitId: 'active-node',
    blueprintVersion: '1.0.0',
    logger,
  }, () => new Promise<void>(resolve => { release = resolve; }));
  assert.throws(() => recorder.finish(), /active units/u);
  release();
  await pending;
  const artifact = recorder.finish();
  assert.equal(recorder.finish(), artifact);
  await assert.rejects(recorder.runUnit({
    unitType: 'node',
    unitId: 'late-node',
    blueprintVersion: '1.0.0',
    logger,
  }, async () => undefined), /already complete/u);
});

test('telemetry schema rejects negative counters, extra values, and false calculated costs', () => {
  const valid = {
    schema: 'pixiecore.execution-telemetry/v1',
    telemetry_id: 'telemetry',
    started_at: '2026-08-25T00:00:00.000Z',
    duration_ms: 0,
    result: 'succeeded',
    units: [],
    totals: {
      unit_count: 0,
      attempts: 0,
      retries: { runtime: 0, application: 0, host: 0, total: 0 },
      failure_count: 0,
      provider_calls: 0,
      tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      token_complete: true,
      costs: [],
      cost_complete: true,
    },
  };
  assert.equal(validate(valid), true, JSON.stringify(validate.errors));
  for (const invalid of [
    { ...valid, extra: true },
    { ...valid, duration_ms: -1 },
    { ...valid, totals: { ...valid.totals, attempts: -1 } },
    {
      ...valid,
      units: [{
        unit_type: 'blueprint', unit_id: 'unit', blueprint_version: '1.0.0',
        started_at: valid.started_at, duration_ms: 1, result: 'succeeded', attempts: 1,
        retries: valid.totals.retries, failure_count: 0, error_codes: [],
        provider_usage: [{
          provider: 'p', model: 'm', calls: 1,
          tokens: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          cost: null, cost_status: 'calculated',
        }],
        tokens: valid.totals.tokens, costs: [], cost_complete: false,
      }],
    },
  ]) assert.equal(validate(invalid), false);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { PixieCoreError } from '../../src/core/contracts/errors/index.js';
import {
  PROVIDER_FALLBACK_RECEIPT_SCHEMA,
  ProviderFallbackContractError,
  ProviderFallbackExhaustedError,
  executeWithProviderFallback,
  type ProviderFallbackExecutionOptions,
} from '../../src/core/kernel/fallback/index.js';
import { testData } from '../helpers/test-data.js';

const data = testData('provider fallback');
const schema = JSON.parse(await readFile(fileURLToPath(new URL(
  '../../schemas/pixiecore.provider-fallback-receipt-v1.schema.json',
  import.meta.url,
)), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

test('primary success does not use fallback and emits a value-free receipt', async () => {
  const privateValue = data.text('primary output');
  const result = await executeWithProviderFallback(options(), ({ target, attempt, signal }) => {
    assert.equal(target.id, 'primary');
    assert.equal(attempt, 1);
    assert.equal(signal, undefined);
    return { privateValue };
  });

  assert.deepEqual(result.value, { privateValue });
  assert.equal(result.receipt.schema, PROVIDER_FALLBACK_RECEIPT_SCHEMA);
  assert.equal(result.receipt.fallback_used, false);
  assert.equal(result.receipt.selected_target_id, 'primary');
  assert.equal(result.receipt.quality_drop, 0);
  assert.equal(result.receipt.attempts.length, 1);
  assert.equal(result.receipt.attempts[0]?.result, 'succeeded');
  assert.doesNotMatch(JSON.stringify(result.receipt), new RegExp(privateValue));
  assert.equal(Object.isFrozen(result.receipt), true);
  assert.equal(validate(result.receipt), true, JSON.stringify(validate.errors));
});

test('listed outage advances once within the explicit quality downgrade', async () => {
  const calls: string[] = [];
  const hiddenFailure = data.text('provider failure detail');
  const result = await executeWithProviderFallback(options(), ({ target }) => {
    calls.push(target.id);
    if (target.id === 'primary') throw new PixieCoreError(hiddenFailure, 'provider_unavailable');
    return data.text('fallback output');
  });

  assert.deepEqual(calls, ['primary', 'secondary']);
  assert.equal(result.receipt.fallback_used, true);
  assert.equal(result.receipt.selected_target_id, 'secondary');
  assert.equal(result.receipt.quality_drop, 0.02);
  assert.deepEqual(result.receipt.attempts.map(attempt => attempt.result), ['failed', 'succeeded']);
  assert.equal(result.receipt.attempts[0]?.error_code, 'provider_unavailable');
  assert.doesNotMatch(JSON.stringify(result.receipt), new RegExp(hiddenFailure));
  assert.equal(validate(result.receipt), true, JSON.stringify(validate.errors));
});

test('unlisted failure and cancellation never advance to another target', async () => {
  let calls = 0;
  const terminal = new PixieCoreError(data.text('terminal detail'), 'invalid_request');
  await assert.rejects(executeWithProviderFallback(options(), () => {
    calls++;
    throw terminal;
  }), error => error === terminal);
  assert.equal(calls, 1);

  const abort = new DOMException(data.text('abort detail'), 'AbortError');
  await assert.rejects(executeWithProviderFallback(options(), () => {
    calls++;
    throw abort;
  }), error => error === abort);
  assert.equal(calls, 2);

  const controller = new AbortController();
  const reason = new Error(data.text('parent abort detail'));
  controller.abort(reason);
  await assert.rejects(
    executeWithProviderFallback({ ...options(), signal: controller.signal }, () => { calls++; }),
    error => error === reason,
  );
  assert.equal(calls, 2);
});

test('exhaustion preserves the final cause and exposes all value-free attempts', async () => {
  const failures = [
    new PixieCoreError(data.text('primary hidden failure'), 'provider_unavailable'),
    new PixieCoreError(data.text('secondary hidden failure'), 'provider_unavailable'),
  ];
  await assert.rejects(executeWithProviderFallback(options(), ({ attempt }) => {
    throw failures[attempt - 1];
  }), error => {
    assert.ok(error instanceof ProviderFallbackExhaustedError);
    assert.equal(error.cause, failures[1]);
    assert.equal(error.receipt.fallback_used, true);
    assert.equal(error.receipt.selected_target_id, null);
    assert.equal(error.receipt.quality_drop, null);
    assert.equal(error.receipt.attempts.length, 2);
    assert.equal(validate(error.receipt), true, JSON.stringify(validate.errors));
    for (const failure of failures) {
      assert.doesNotMatch(JSON.stringify(error.receipt), new RegExp(failure.message));
    }
    return true;
  });
});

test('quality and evidence policy rejects every ambiguous plan before execution', async () => {
  let calls = 0;
  const base = options();
  const invalid = [
    { ...base, targets: [] },
    { ...base, targets: [base.targets[0], base.targets[0]] },
    { ...base, targets: [base.targets[0], { ...base.targets[1], quality: { ...base.targets[1]!.quality, score: 0.89 } }] },
    { ...base, policy: { ...base.policy, maximum_quality_drop: 0.01 } },
    { ...base, policy: { ...base.policy, fallback_error_codes: [] } },
    { ...base, policy: { ...base.policy, fallback_error_codes: ['x', 'x'] } },
    { ...base, targets: [{ ...base.targets[0], quality: { ...base.targets[0]!.quality, measured_at: 'invalid' } }] },
  ];
  for (const candidate of invalid) {
    await assert.rejects(executeWithProviderFallback(candidate as never, () => { calls++; }), ProviderFallbackContractError);
  }
  assert.equal(calls, 0);
});

test('fallback contract validates the callback, signal, scores, and identifiers', async () => {
  const base = options();
  await assert.rejects(executeWithProviderFallback(base, null as never), /execute must be a function/u);
  await assert.rejects(executeWithProviderFallback({ ...base, signal: {} as AbortSignal }, () => null), /AbortSignal/u);
  for (const candidate of [
    { ...base, policy: { ...base.policy, policy_id: '' } },
    { ...base, policy: { ...base.policy, minimum_quality_score: -1 } },
    { ...base, policy: { ...base.policy, maximum_quality_drop: 2 } },
    { ...base, targets: [{ ...base.targets[0], provider: '' }] },
  ]) {
    await assert.rejects(executeWithProviderFallback(candidate as never, () => null), ProviderFallbackContractError);
  }
});

function options(): ProviderFallbackExecutionOptions {
  return {
    targets: [
      {
        id: 'primary',
        provider: 'provider-one',
        model: 'model-one',
        quality: {
          score: 0.98,
          dataset_id: 'travel-city-classifier',
          dataset_version: '2.0.0',
          measured_at: '2026-08-25T00:00:00.000Z',
        },
      },
      {
        id: 'secondary',
        provider: 'provider-two',
        model: 'model-two',
        quality: {
          score: 0.96,
          dataset_id: 'travel-city-classifier',
          dataset_version: '2.0.0',
          measured_at: '2026-08-24T00:00:00.000Z',
        },
      },
    ],
    policy: {
      policy_id: 'travel-fallback',
      policy_version: '1.0.0',
      fallback_error_codes: ['provider_unavailable'],
      minimum_quality_score: 0.95,
      maximum_quality_drop: 0.02,
    },
  };
}

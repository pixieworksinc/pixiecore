/**
 * Exercises the language-neutral Drupal real-provider boundary without I/O.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';

const contracts = new URL('../../examples/integrations/drupal/real-provider/contracts/', import.meta.url);
const readJson = (path: string): Record<string, unknown> => JSON.parse(
  readFileSync(new URL(path, contracts), 'utf8'),
) as Record<string, unknown>;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const capability = ajv.compile(readJson('capabilities-v1.schema.json'));
const execute = ajv.compile(readJson('execute-v1.schema.json'));
const ready = readJson('fixtures/capabilities-ready.json');
const success = readJson('fixtures/execute-success.json');

test('versioned offline capability and execution fixtures satisfy their schemas', () => {
  assert.equal(capability(ready), true, JSON.stringify(capability.errors));
  assert.equal(execute(success), true, JSON.stringify(execute.errors));
});

test('stock PixieCore API cannot advertise the paid demo capability', () => {
  assert.equal(capability({ status: 'ok' }), false);
  assert.equal(execute({
    status: 'success', data: success.data,
    metadata: { provider: 'openai', model: 'configured-model', duration_ms: 1 },
  }), false);
});

test('capability is rejected if metering, durability, or version is absent', () => {
  for (const change of [
    { usage_complete: false },
    { durable_budget: false },
    { contract: 'pixiecore.drupal-metered-execution/v2' },
    { max_output_tokens: 0 },
  ]) {
    assert.equal(capability({ ...ready, ...change }), false);
  }
});

test('successful execution cannot omit or falsify accounting evidence', () => {
  const metadata = success.metadata as Record<string, unknown>;
  for (const change of [
    { input_tokens: null },
    { output_tokens: -1 },
    { provider_calls: 0 },
    { estimated_cost_usd: null },
    { pricing_source: '' },
    { budget_record_id: '' },
    { contract: 'pixiecore.drupal-metered-execution/v2' },
  ]) {
    assert.equal(execute({ ...success, metadata: { ...metadata, ...change } }), false);
  }
});

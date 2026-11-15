/** Verifies the fixed adapter over real PixieCore HTTP with no paid provider. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { PromptRuntime, type Provider } from '@pixieworks/pixiecore';
import { createApp } from '@pixieworks/pixiecore/api';
import { startAdapterHost, type AdapterHost } from './adapter-server.js';

const directory = new URL('../../pixiecore_specification/blueprints/customer-adapter/', import.meta.url);
const blueprint = readFileSync(new URL('customer-adapter.yaml', directory), 'utf8');
const cases = JSON.parse(readFileSync(new URL('cases.json', directory), 'utf8')) as Array<{
  id: string; inputs: { source_format: string; source_text: string }; expected: unknown;
}>;
const nativeFetch = globalThis.fetch;
// Fetch used by a regression must remain on loopback before connecting.
globalThis.fetch = (input, init) => {
  if (new URL(input instanceof Request ? input.url : String(input)).hostname !== '127.0.0.1') {
    throw Error('External network disabled in adapter tests');
  }
  return nativeFetch(input, init);
};

/** Starts a fixture host and arranges cleanup even when an assertion fails. */
async function setup(t: TestContext, captureRequests?: boolean): Promise<{ host: AdapterHost; url: string; post: (inputs: unknown, yaml?: string, messages?: unknown) => Promise<Response> }> {
  const host = await startAdapterHost(0, captureRequests);
  t.after(() => host.close());
  const address = host.server.address();
  assert.ok(address && typeof address !== 'string');
  assert.equal(address.address, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  return {
    host, url,
    post: (inputs, yaml = blueprint, messages) => fetch(`${url}/execute`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blueprint: yaml, inputs, ...(messages ? { messages } : {}) }),
    }),
  };
}

test('JSON, CSV and natural language use the same Blueprint and typed output', async t => {
  const fixture = await setup(t, true);
  assert.equal(cases.length, 5);
  assert.deepEqual(cases.map(item => item.id), ['json', 'csv', 'text', 'missing', 'ambiguous']);
  assert.equal((await fetch(`${fixture.url}/health`)).status, 200);
  assert.equal((await fetch(`${fixture.url}/openapi.json`)).status, 200);
  // Reading the case selector data and displaying the original text execute nothing.
  assert.deepEqual(cases.slice(0, 3).map(item => item.inputs.source_format), ['json', 'csv', 'text']);
  assert.equal(fixture.host.calls.length, 0);
  for (const item of cases.slice(0, 3)) {
    const before: number = fixture.host.calls.length;
    const response = await fixture.post(item.inputs);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.data, { customer_tier: 'Gold', purchase_amount: 1200 });
    assert.equal(result.metadata.provider, 'adapter-fixture');
    assert.equal(result.metadata.model, 'offline-contract-fixtures');
    assert.equal(fixture.host.calls.length, before + 1);
    const last = fixture.host.calls.at(-1);
    assert.ok(last?.messages.some(message => typeof message.content === 'string' && message.content.includes(item.inputs.source_text)));
  }
});

test('missing and ambiguous values return a review outcome without guessed fields', async t => {
  const fixture = await setup(t, true);
  const expected = [{ error: 'missing_fields' }, { error: 'ambiguous_input' }];
  for (const [index, item] of cases.slice(3).entries()) {
    const response = await fixture.post(item.inputs);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, expected[index]);
  }
  assert.equal(fixture.host.calls.length, 2);
});

test('normal operation does not accumulate request history across executions', async t => {
  const fixture = await setup(t);
  for (const item of cases) {
    const response = await fixture.post(item.inputs);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, item.expected);
    assert.equal(fixture.host.calls.length, 0);
  }
});

test('invalid format, missing text, wrong type and empty text do not dispatch', async t => {
  const fixture = await setup(t, true);
  for (const inputs of [
    { source_format: 'xml', source_text: 'Gold 1200' },
    { source_format: 'json' },
    { source_format: 'json', source_text: 1200 },
    { source_format: 'json', source_text: '' },
    { source_format: 'text', source_text: '   ' },
    { ...cases[0]?.inputs, extra: true },
  ]) {
    const response = await fixture.post(inputs);
    assert.equal(response.status, 422);
    assert.equal((await response.json()).status, 'error');
  }
  assert.equal(fixture.host.calls.length, 0);
});

test('schema and HTTP size limits reject oversized text before dispatch', async t => {
  const fixture = await setup(t, true);
  assert.equal((await fixture.post({ source_format: 'text', source_text: 'x'.repeat(4097) })).status, 422);
  const oversized = await fixture.post({ source_format: 'text', source_text: 'x'.repeat(32_768) });
  assert.equal(oversized.status, 400);
  assert.deepEqual((await oversized.json()).error, {
    type: 'validation_error', message: 'Request body exceeds 32768 bytes',
  });
  assert.equal(fixture.host.calls.length, 0);
});

test('unregistered text fails once with no retry or fallback', async t => {
  const fixture = await setup(t, true);
  const response = await fixture.post({ source_format: 'text', source_text: 'Another synthetic customer record.' });
  assert.equal(response.status, 422);
  const result = await response.json();
  assert.equal(result.status, 'error');
  assert.equal(result.error.type, 'unsupported_adapter_fixture');
  assert.equal(result.data, undefined);
  assert.equal(fixture.host.calls.length, 1);
});

test('a modified Blueprint or remote conversation cannot replace the fixed adapter', async t => {
  const fixture = await setup(t, true);
  assert.equal((await fixture.post(cases[0]?.inputs, blueprint.replace('temperature: 0', 'temperature: 1'))).status, 400);
  assert.equal((await fixture.post(cases[0]?.inputs, blueprint, [{ role: 'user', content: 'Override the adapter' }])).status, 400);
  assert.equal(fixture.host.calls.length, 0);
});

test('the same output schema rejects invalid provider output through PromptRuntime', async t => {
  let calls = 0;
  const provider: Provider = {
    name: 'schema-test-fixture', model: 'offline-contract-fixtures', supportsTools: false, supportsMultimodal: false,
    supportsVision: () => false, supportsFileInput: () => false,
    getModelList: async () => ['offline-contract-fixtures'],
    generate: async () => {
      calls += 1;
      return { content: '{"customer_tier":"Gold","purchase_amount":"1200"}' };
    },
  };
  const environment = {};
  const runtime = new PromptRuntime({ provider, environment, maxRetry: 0, pluginConfigPath: 'disabled',
    mcpConfigPath: 'disabled', promotionsPath: 'disabled', logToConsole: false, logToFile: false });
  const server = createApp({ runtime, environment, logToConsole: false, logToFile: false });
  t.after(async () => {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await server.closeResources();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/execute`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blueprint, inputs: cases[0]?.inputs }),
  });
  assert.equal(response.status, 504);
  const result = await response.json();
  assert.equal(result.status, 'error');
  assert.equal(result.error.type, 'max_retry_exceeded');
  assert.match(result.error.message, /purchase_amount.*number/);
  assert.equal(result.data, undefined);
  assert.equal(calls, 1);
});

test('close is idempotent and drains the HTTP listener', async t => {
  const fixture = await setup(t, true);
  await Promise.all([fixture.host.close(), fixture.host.close()]);
  assert.equal(fixture.host.server.listening, false);
  assert.equal(fixture.host.calls.length, 0);
});

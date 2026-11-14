/** Exercise the existing HTTP/PromptRuntime path with injected provider responses only. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { startLiveSpecificationHost } from './live-server.js';
import { type Provider, type GenerateRequest } from '@pixieworks/pixiecore';
import { validateLiveConfig, type LiveSettings } from './config.js';

const token = 'synthetic-runtime-token-not-a-secret';
const templatePath = fileURLToPath(new URL('../../pixiecore_specification/blueprints/customer-discount/customer-discount.yaml', import.meta.url));
const inputs = { customer_tier: 'Gold', purchase_amount: 1200 };
const nativeFetch = globalThis.fetch;
// Even an accidental provider fetch is refused before a connection is opened.
globalThis.fetch = (input, init) => {
  if (new URL(input instanceof Request ? input.url : String(input)).hostname !== '127.0.0.1') throw Error('External network disabled in live-host tests');
  return nativeFetch(input, init);
};

async function setup(t: TestContext, responses: unknown[] = [{ discount: 0.15, final_price: 1020 }, { discount: 0.2, final_price: 960 }], overrides: Partial<LiveSettings> = {}, includeUsage = true) {
  const statePath = await mkdtemp(join(tmpdir(), 'pixiecore-live-test-'));
  t.after(() => rm(statePath, { recursive: true, force: true }));
  const config = { expiresAt: new Date(Date.now() + 60000).toISOString(), statePath, templatePath,
    apiKeyPath: '/nonexistent-test-key', transportTokenPath: '/nonexistent-test-token', ...overrides };
  let calls = 0;
  const messages: GenerateRequest['messages'][] = [];
  const provider: Provider = { name: 'openai', model: 'gpt-6-luna', supportsTools: false, supportsMultimodal: false,
    supportsVision: () => false, supportsFileInput: () => false, getModelList: async () => { throw Error('Model list forbidden'); },
    generate: async request => {
      messages.push(request.messages);
      const data = responses[calls++];
      if (data instanceof Error) throw data;
      assert.notEqual(data, undefined);
      return { content: JSON.stringify(data), ...(includeUsage ? { usage: { inputTokens: 500, outputTokens: 20 } } : {}) };
    } };
  let host = await startLiveSpecificationHost({ config, token, provider, templatePath, port: 0 });
  t.after(() => host.close());
  const url = (): string => {
    const address = host.server.address();
    assert.ok(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
  };
  const template = (await readFile(templatePath, 'utf8')).split('\nexamples:\n')[0] + '\n';
  const post = (rate: string, authorization = `Bearer ${token}`, businessInputs: unknown = inputs) => fetch(`${url()}/execute`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify({ blueprint: template.replace('Set discount to 0.20 only', `Set discount to ${rate} only`), inputs: businessInputs }),
  });
  return { config, post, url, calls: () => calls, messages, startupId: host.startupId,
    restart: async () => { await host.close(); host = await startLiveSpecificationHost({ config, token, provider, templatePath, port: 0 }); } };
}

test('existing editor payload changes only the specification, same runtime, two calls total', async t => {
  const fixture = await setup(t);
  assert.equal((await fetch(`${fixture.url()}/health`)).status, 200);
  assert.equal(fixture.calls(), 0);
  const first = await (await fixture.post('0.15')).json();
  const second = await (await fixture.post('0.20')).json();
  assert.deepEqual(first.data, { discount: 0.15, final_price: 1020 });
  assert.deepEqual(second.data, { discount: 0.2, final_price: 960 });
  assert.equal(first.metadata.startup_id, second.metadata.startup_id);
  assert.equal(first.metadata.provider_calls, 1);
  assert.equal(first.metadata.input_tokens, 500);
  assert.equal((await fixture.post('0.20')).status, 502);
  assert.equal(fixture.calls(), 2);
  await fixture.restart();
  assert.equal((await fixture.post('0.20')).status, 502);
  assert.equal(fixture.calls(), 2);
});

test('authentication and invalid inputs are rejected before provider dispatch', async t => {
  const fixture = await setup(t);
  assert.equal((await fixture.post('0.15', 'Bearer wrong')).status, 401);
  assert.equal((await fixture.post('0.15', `Bearer ${token}`, { customer_tier: 'Gold' })).status, 400);
  assert.equal(fixture.calls(), 0);
  assert.equal((await fixture.post('0.15')).status, 200);
});

test('an expired trial opens no provider connection', async t => {
  const fixture = await setup(t, [], { expiresAt: '2000-01-01T00:00:00Z' });
  assert.equal((await fixture.post('0.15')).status, 502);
  assert.equal(fixture.calls(), 0);
});

test('a provider error is not retried and stays halted after a restart', async t => {
  const fixture = await setup(t, [new Error('Synthetic provider failure')]);
  assert.equal((await fixture.post('0.15')).status, 502);
  assert.equal((await fixture.post('0.20')).status, 502);
  await fixture.restart();
  assert.equal((await fixture.post('0.20')).status, 502);
  assert.equal(fixture.calls(), 1);
});

test('arithmetic mismatch halts the trial instead of recording success', async t => {
  const fixture = await setup(t, [{ discount: 0.15, final_price: 960 }]);
  assert.equal((await fixture.post('0.15')).status, 502);
  assert.equal((await fixture.post('0.20')).status, 502);
  assert.equal(fixture.calls(), 1);
});

test('an interrupted claimed call stops the next process before dispatch', async t => {
  const fixture = await setup(t);
  await writeFile(join(fixture.config.statePath, 'call-1.claimed'), 'interrupted');
  await fixture.restart();
  assert.equal((await fixture.post('0.15')).status, 502);
  assert.equal(fixture.calls(), 0);
});

test('operator settings cannot substitute a different provider or larger token cap', () => {
  const config = { expiresAt: '2000-01-01T00:00:00Z', statePath: '/state', templatePath: '/template', apiKeyPath: '/key', transportTokenPath: '/token' };
  assert.equal(validateLiveConfig(config).model, 'gpt-6-luna');
  assert.throws(() => validateLiveConfig({ ...config, model: 'another-model' }));
  assert.throws(() => validateLiveConfig({ ...config, maxOutputTokens: 5000 }));
});

test('missing provider usage consumes the attempt and stops further calls', async t => {
  const fixture = await setup(t, [{ discount: 0.15, final_price: 1020 }], {}, false);
  assert.equal((await fixture.post('0.15')).status, 502);
  assert.equal((await fixture.post('0.20')).status, 502);
  assert.equal(fixture.calls(), 1);
});

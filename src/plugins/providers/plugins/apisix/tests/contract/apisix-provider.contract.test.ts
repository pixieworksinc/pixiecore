/**
 * Verifies the APISIX provider adapter against an injected gateway transport.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginManager } from '../../../../../../../src/index.js';
import { LLMAPIError, ConfigurationError } from '../../../../../../../src/index.js';

test('APISIX provider sends OpenAI-compatible requests with only configured gateway auth', async () => {
  const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"result":"ok"}' } }],
      usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const manager = new PluginManager(undefined, {}, { pluginConfigPath: 'disabled' });
  try {
    const provider = await manager.createProvider('apisix', {
      environment: {
        APISIX_GATEWAY_URL: 'https://gateway.example.test/ai/chat',
        APISIX_GATEWAY_API_KEY: 'gateway-secret',
        APISIX_GATEWAY_MODEL: 'routed-model',
      },
      fetch: fetcher,
    });
    assert.equal(provider.name, 'apisix');
    assert.equal(provider.model, 'routed-model');
    assert.equal(provider.supportsTools, false);
    assert.equal(provider.supportsMultimodal, false);
    assert.equal(provider.supportsVision(), false);
    assert.equal(provider.supportsFileInput(), false);
    assert.deepEqual(await provider.getModelList(), ['routed-model']);
    const response = await provider.generate({
      messages: [{ role: 'user', content: 'hello' }],
    });
    assert.equal(response.content, '{"result":"ok"}');
    assert.deepEqual(response.usage, { inputTokens: 9, outputTokens: 4, totalTokens: 13 });
    assert.equal(requests[0]?.url, 'https://gateway.example.test/ai/chat');
    const headers = new Headers(requests[0]?.init.headers);
    assert.equal(headers.get('x-api-key'), 'gateway-secret');
    assert.equal(headers.get('authorization'), null);
    const body = JSON.parse(String(requests[0]?.init.body)) as Record<string, unknown>;
    assert.equal(body.model, 'routed-model');
  } finally {
    await manager.close();
  }
});

test('APISIX provider capabilities require explicit route declarations', async () => {
  const manager = new PluginManager(undefined, {}, { pluginConfigPath: 'disabled' });
  try {
    const provider = await manager.createProvider('apisix', {
      environment: {
        APISIX_GATEWAY_URL: 'https://gateway.example.test/ai/chat',
        APISIX_GATEWAY_SUPPORTS_TOOLS: 'true',
        APISIX_GATEWAY_SUPPORTS_VISION: 'yes',
        APISIX_GATEWAY_SUPPORTS_FILES: '1',
      },
    });
    assert.equal(provider.supportsTools, true);
    assert.equal(provider.supportsMultimodal, true);
    assert.equal(provider.supportsVision(), true);
    assert.equal(provider.supportsFileInput(), true);
  } finally {
    await manager.close();
  }
});

test('APISIX provider validates required URL and configured authentication header', async () => {
  const manager = new PluginManager(undefined, {}, { pluginConfigPath: 'disabled' });
  try {
    await assert.rejects(
      manager.createProvider('apisix', { environment: {} }),
      error => error instanceof LLMAPIError && /APISIX_GATEWAY_URL/.test(error.message),
    );
    await assert.rejects(
      manager.createProvider('apisix', {
        environment: {
          APISIX_GATEWAY_URL: 'https://gateway.example.test/ai',
          APISIX_GATEWAY_API_KEY: 'secret',
          APISIX_GATEWAY_API_KEY_HEADER: 'bad header',
        },
      }),
      error => error instanceof ConfigurationError && /valid HTTP header/.test(error.message),
    );
  } finally {
    await manager.close();
  }
});

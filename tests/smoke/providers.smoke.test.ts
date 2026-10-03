import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../../src/index.js';
import type { ProviderName } from '../../src/index.js';

const liveEnabled = process.env.PIXIECORE_RUN_LIVE_TESTS === 'true';

test('opt-in provider smoke tests', { skip: !liveEnabled }, async () => {
  const configured = process.env.PIXIECORE_LIVE_PROVIDERS;
  assert.ok(configured, 'PIXIECORE_LIVE_PROVIDERS must list one or more provider names');
  const providers = configured.split(',').map(value => value.trim()).filter(Boolean) as ProviderName[];
  assert.ok(providers.length > 0, 'PIXIECORE_LIVE_PROVIDERS must list one or more provider names');

  for (const name of providers) {
    const provider = createProvider(name);
    try {
      const response = await provider.generate({
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        maxTokens: 16,
      });
      assert.ok(response.content || response.toolCalls?.length, `${name} returned no content`);
    } finally {
      if ('close' in provider && typeof provider.close === 'function') await provider.close();
    }
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { LoggingServicePort } from '../../../../core/contracts/logging/index.js';
import type { MultimodalServicePort } from '../../../../core/contracts/multimodal/index.js';
import { createLoggingService } from '../../../../plugins/logging/src/service.js';
import { createMultimodalService } from '../../../../plugins/multimodal/src/service.js';
import { createOpenAIProvider } from '../../../../plugins/providers/plugins/openai/openai.js';
import * as anthropicProvider from '../../../../plugins/providers/plugins/anthropic/anthropic.js';
import * as geminiProvider from '../../../../plugins/providers/plugins/gemini/gemini.js';
import * as providerInternals from '../../../../plugins/providers/src/index.js';
import * as publicProviders from '../../../../core/kernel/providers/index.js';

test('provider compatibility facade preserves its named synchronous surface', () => {
  assert.deepEqual(Object.keys(publicProviders).sort(), [
    'BUILT_IN_PROVIDER_NAMES',
    'cleanGeminiSchema',
    'createProvider',
    'isBuiltInProviderName',
    'shouldUseAnthropicPdfTextFallback',
  ]);
  assert.equal(publicProviders.createProvider.name, 'createProvider');
  assert.equal(publicProviders.createProvider.length, 1);
  assert.equal(publicProviders.BUILT_IN_PROVIDER_NAMES, providerInternals.BUILT_IN_PROVIDER_NAMES);
  assert.equal(publicProviders.cleanGeminiSchema, geminiProvider.cleanGeminiSchema);
  assert.equal(publicProviders.isBuiltInProviderName, providerInternals.isBuiltInProviderName);
  assert.equal(
    publicProviders.shouldUseAnthropicPdfTextFallback,
    anthropicProvider.shouldUseAnthropicPdfTextFallback,
  );
  const provider = publicProviders.createProvider('openai', {
    environment: { OPENAI_API_KEY: 'key' },
  });
  assert.equal(provider.name, 'openai');
});

test('provider internals consume injected logging and multimodal services', async () => {
  const sanitized: string[] = [];
  const logging: LoggingServicePort = {
    ...createLoggingService(),
    sanitizeLogMessage(message): string {
      sanitized.push(message);
      return 'injected-redaction';
    },
  };
  const baseMultimodal = createMultimodalService();
  let resolvedAttachments = 0;
  const multimodal: MultimodalServicePort = {
    ...baseMultimodal,
    resolveAttachment(part, fetcher) {
      resolvedAttachments += 1;
      return baseMultimodal.resolveAttachment(part, fetcher);
    },
  };
  const services = { logging, multimodal };

  const support = providerInternals.createProviderSupport(services);
  const failing = createOpenAIProvider({
    environment: { OPENAI_API_KEY: 'key' },
    fetch: async () => Response.json(
      { error: { message: 'upstream-secret' } },
      { status: 401 },
    ),
  }, support);
  await assert.rejects(
    failing.generate({ messages: [{ role: 'user', content: 'Hello' }] }),
    /injected-redaction/,
  );
  assert.deepEqual(sanitized, ['upstream-secret']);

  const successful = createOpenAIProvider({
    environment: { OPENAI_API_KEY: 'key' },
    fetch: async () => Response.json({ choices: [{ message: { content: 'ok' } }] }),
  }, support);
  await successful.generate({
    messages: [{
      role: 'user',
      content: [{ type: 'image', source: 'data:image/png;base64,aW1hZ2U=' }],
    }],
  });
  assert.equal(resolvedAttachments, 1);
});

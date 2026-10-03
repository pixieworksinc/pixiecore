import assert from 'node:assert/strict';
import test from 'node:test';
import { PromptProcessor, PromptRuntime } from '../../../../index.js';
import type { McpServicePort } from '../../../../core/contracts/mcp/index.js';
import { createLoggingService } from '../../../../plugins/logging/src/service.js';
import { createMultimodalService } from '../../../../plugins/multimodal/src/service.js';
import { createRuntimeService } from '../../../../plugins/runtime/src/service.js';
import { createToolService } from '../../../../plugins/tools/src/service.js';
import { createValidationService } from '../../../../plugins/validation/src/service.js';
import { ScriptedProvider } from '../../../../../tests/helpers/fake-provider.js';

test('runtime service is a frozen stateless bundle and does not create an MCP manager', () => {
  let managerCreations = 0;
  const mcp: McpServicePort = {
    createManager() {
      managerCreations++;
      throw new Error('runtime service activation must not create operational resources');
    },
  };
  const processorServices = {
    logging: createLoggingService(),
    validation: createValidationService(),
    multimodal: createMultimodalService(),
    tools: createToolService(),
  };

  const service = createRuntimeService(processorServices, mcp);

  assert.equal(Object.isFrozen(service), true);
  assert.equal(Object.isFrozen(service.processorServices), true);
  assert.equal(service.mcp, mcp);
  assert.deepEqual(service.processorServices, processorServices);
  assert.equal(managerCreations, 0);
});

test('PromptRuntime activates only its core closure without eager provider or MCP work', async () => {
  const provider = new ScriptedProvider([]);
  const runtime = new PromptRuntime({
    provider,
    mcpConfigPath: 'disabled',
    logToConsole: false,
  });
  try {
    assert.ok(runtime.processor instanceof PromptProcessor);
    assert.equal(runtime.provider, provider);
    assert.equal(runtime.mcpManager.isLoaded, false);
    assert.equal(provider.calls.length, 0);
    assert.deepEqual(
      runtime.pluginManager.getPluginStatus().plugins
        .filter(plugin => plugin.activated)
        .map(plugin => plugin.id)
        .sort(),
      [
        'pixiecore.recipe',
        'pixiecore.logging',
        'pixiecore.mcp',
        'pixiecore.multimodal',
        'pixiecore.permissions',
        'pixiecore.providers',
        'pixiecore.providers.openai',
        'pixiecore.providers.anthropic',
        'pixiecore.providers.azure',
        'pixiecore.providers.gemini',
        'pixiecore.providers.apisix',
        'pixiecore.providers.apisix.ai-prompt-guard',
        'pixiecore.providers.apisix.ai-proxy-multi',
        'pixiecore.providers.apisix.ai-rag',
        'pixiecore.providers.apisix.ai-rate-limiting',
        'pixiecore.roles',
        'pixiecore.self-evaluation',
        'pixiecore.tools',
        'pixiecore.validation',
        'pixiecore.runtime',
      ].sort(),
    );
  } finally {
    await runtime.close();
  }
});

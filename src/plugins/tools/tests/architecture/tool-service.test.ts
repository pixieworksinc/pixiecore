import assert from 'node:assert/strict';
import test from 'node:test';
import { ScopedServiceRegistry } from '../../../../core/bootstrap/plugin-manager/registries/services.js';
import { TOOL_SERVICE } from '../../../../core/contracts/plugin/services.js';
import type { PluginActivationContext } from '../../../../core/contracts/plugin/activation.js';
import type { ToolServicePort } from '../../../../core/contracts/tools/index.js';
import type { Blueprint, ToolCall, ToolDefinition } from '../../../../core/contracts/types/index.js';
import { CORE_PLUGIN_CATALOG } from '../../../../core/kernel/generated/core-plugin-catalog.generated.js';
import type {
  StaticCorePluginManifest,
  StaticCoreServiceComponent,
} from '../../../../core/bootstrap/plugin-manager/model/definition.js';
import { createLoggingService } from '../../../../plugins/logging/src/service.js';
import { createMultimodalService } from '../../../../plugins/multimodal/src/service.js';
import { PromptProcessor as CorePromptProcessor } from '../../../../plugins/runtime/src/processor.js';
import { createCorePluginActivator } from '../../../../plugins/tools/src/activator.js';
import { createToolService } from '../../../../plugins/tools/src/service.js';
import { createValidationService } from '../../../../plugins/validation/src/service.js';
import { ScriptedProvider } from '../../../../../tests/helpers/fake-provider.js';

const BLUEPRINT: Blueprint = {
  name: 'Tool service fixture',
  version: '1.0',
  role: 'assistant',
  prompt: 'Run the configured tool',
  output_schema: {
    type: 'object',
    properties: { result: { type: 'string' } },
    required: ['result'],
  },
};

test('tool service activator registers fresh frozen non-closable capabilities', () => {
  const first = activateToolService();
  const second = activateToolService();
  const firstService = first.resolve(TOOL_SERVICE);
  const secondService = second.resolve(TOOL_SERVICE);

  assert.notEqual(firstService, secondService);
  assert.equal(Object.isFrozen(firstService), true);
  assert.equal(Object.isFrozen(secondService), true);
  assert.equal('close' in firstService, false);
  assert.equal(serviceComponent(corePluginManifest('pixiecore.tools')).service_id, TOOL_SERVICE.id);
});

function corePluginManifest(id: string): StaticCorePluginManifest {
  const entry = CORE_PLUGIN_CATALOG.find(item => item.manifest.id === id);
  assert.ok(entry, `Missing core plugin manifest: ${id}`);
  return entry.manifest;
}

function serviceComponent(manifest: StaticCorePluginManifest): StaticCoreServiceComponent {
  const component = manifest.components.find(candidate => candidate.type === 'service');
  if (!component || component.type !== 'service') {
    throw new Error(`Core plugin ${manifest.id} has no service component`);
  }
  return component;
}

test('tool service preserves safe-name, collision, mapping, and reverse-call behavior', () => {
  const service = createToolService();
  const existing = new Set<string>();
  assert.equal(service.makeSafeToolName('weather', existing), 'weather');
  assert.notEqual(service.makeSafeToolName('weather', existing), 'weather');

  const original: ToolDefinition = {
    name: 'mcp.fetch.html',
    description: 'Fetch HTML',
    parameters: { type: 'object' },
  };
  const { tools, mapping } = service.sanitizeToolNames([original]);
  assert.notEqual(tools[0]?.name, original.name);
  assert.equal(mapping.get(tools[0]!.name), original.name);
  assert.equal(
    service.convertToolCallNames([
      { id: 'call-1', name: tools[0]!.name, arguments: { url: 'https://example.com' } },
    ], mapping)[0]?.name,
    original.name,
  );
  assert.equal(original.name, 'mcp.fetch.html');
});

test('PromptProcessor consumes tool-name behavior only through its injected port', async () => {
  const base = createToolService();
  const recording = new RecordingToolService(base);
  const safeName = base.makeSafeToolName('mcp.fetch.html');
  const provider = new ScriptedProvider([
    { toolCalls: [{ id: 'call-1', name: safeName, arguments: { value: 'ok' } }] },
    { content: '{"result":"done"}' },
  ]);
  const processor = new CorePromptProcessor(provider, {
    logging: createLoggingService(),
    validation: createValidationService(),
    multimodal: createMultimodalService(),
    tools: recording,
  });
  processor.registerAgentRole({
    supportedRoles: ['assistant'],
    apply: prompt => ({ messages: [{ role: 'user', content: prompt }] }),
  });
  let received: unknown;
  processor.registerTool({
    name: 'mcp.fetch.html',
    description: 'Fetch HTML',
    parameters: { type: 'object' },
    execute: args => { received = args.value; return { ok: true }; },
  });

  assert.deepEqual(await processor.execute(BLUEPRINT, {}), { result: 'done' });
  assert.equal(received, 'ok');
  assert.equal(recording.sanitizeCount, 1);
  assert.equal(recording.convertCount, 1);
  assert.equal(provider.calls[0]?.tools?.[0]?.name, safeName);
});

class RecordingToolService implements ToolServicePort {
  sanitizeCount = 0;
  convertCount = 0;
  validationCount = 0;

  constructor(private readonly delegate: ToolServicePort) {}

  makeSafeToolName(name: string, existing?: Set<string>, maxLength?: number): string {
    return this.delegate.makeSafeToolName(name, existing, maxLength);
  }

  sanitizeToolNames(tools: ToolDefinition[]) {
    this.sanitizeCount++;
    return this.delegate.sanitizeToolNames(tools);
  }

  convertToolCallNames(calls: ToolCall[], mapping: Map<string, string>): ToolCall[] {
    this.convertCount++;
    return this.delegate.convertToolCallNames(calls, mapping);
  }

  validateArguments(parameters: Record<string, unknown>, args: unknown) {
    this.validationCount++;
    return this.delegate.validateArguments(parameters, args);
  }
}

function activateToolService(): ScopedServiceRegistry {
  const services = new ScopedServiceRegistry();
  const context: PluginActivationContext = {
    services,
    own: () => undefined,
    registerExtension: () => undefined,
    registerAgentRole: () => undefined,
    registerDecorator: () => undefined,
    registerTool: () => undefined,
    registerProvider: () => undefined,
    registerProviderFactory: () => undefined,
  };
  assert.equal(createCorePluginActivator().activate(context), undefined);
  return services;
}

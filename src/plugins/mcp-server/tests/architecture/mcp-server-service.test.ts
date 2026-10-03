import assert from 'node:assert/strict';
import test from 'node:test';
import { CORE_PLUGIN_CATALOG } from '../../../../core/kernel/generated/core-plugin-catalog.generated.js';
import { ScopedServiceRegistry } from '../../../../core/bootstrap/plugin-manager/registries/services.js';
import type {
  StaticCorePluginManifest,
  StaticCoreServiceComponent,
} from '../../../../core/bootstrap/plugin-manager/model/definition.js';
import type { McpServerRuntimePort } from '../../../../core/contracts/mcp/server.js';
import { MCP_SERVER_SERVICE } from '../../../../core/contracts/plugin/services.js';
import type { PluginActivationContext } from '../../../../core/contracts/plugin/activation.js';
import { createCorePluginActivator } from '../../../../plugins/mcp-server/src/activator.js';
import { createPixieCoreMcpServer } from '../../../../core/kernel/mcp-server/index.js';

test('MCP server activator registers a fresh frozen stateless factory', () => {
  const first = activateMcpServerService();
  const second = activateMcpServerService();
  const firstService = first.resolve(MCP_SERVER_SERVICE);
  const secondService = second.resolve(MCP_SERVER_SERVICE);

  assert.notEqual(firstService, secondService);
  assert.equal(Object.isFrozen(firstService), true);
  assert.equal('close' in firstService, false);

  const manifest = corePluginManifest('pixiecore.mcp-server');
  assert.deepEqual(manifest.requires, { 'pixiecore.runtime': '^0.1.0' });
  assert.equal(serviceComponent(manifest).service_id, MCP_SERVER_SERVICE.id);
});

test('public MCP server facade closes an injected runtime exactly once', async () => {
  const runtime = new EmptyRuntime();
  const server = createPixieCoreMcpServer({ runtime, environment: {} });

  assert.equal(server.runtime, runtime);
  await server.close();
  await server.closeResources();

  assert.equal(runtime.closeCount, 1);
});

class EmptyRuntime implements McpServerRuntimePort {
  closeCount = 0;
  async execute(): Promise<Record<string, unknown>> { return {}; }
  async executeYaml(): Promise<Record<string, unknown>> { return {}; }
  close(): void { this.closeCount++; }
}

function activateMcpServerService(): ScopedServiceRegistry {
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

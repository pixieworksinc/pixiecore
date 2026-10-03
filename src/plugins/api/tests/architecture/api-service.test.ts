import assert from 'node:assert/strict';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import test from 'node:test';
import { createApp } from '../../../../core/kernel/api/index.js';
import { PromptRuntime, PixieCoreLogger } from '../../../../index.js';
import { CORE_PLUGIN_CATALOG } from '../../../../core/kernel/generated/core-plugin-catalog.generated.js';
import { ScopedServiceRegistry } from '../../../../core/bootstrap/plugin-manager/registries/services.js';
import type {
  StaticCorePluginManifest,
  StaticCoreServiceComponent,
} from '../../../../core/bootstrap/plugin-manager/model/definition.js';
import type {
  ApiRuntime,
  ApiServerCompositionPort,
} from '../../../../core/contracts/api/index.js';
import type { LoggingServicePort } from '../../../../core/contracts/logging/index.js';
import {
  API_SERVICE,
  LOGGING_SERVICE,
} from '../../../../core/contracts/plugin/services.js';
import type { PluginActivationContext } from '../../../../core/contracts/plugin/activation.js';
import { createCorePluginActivator } from '../../../../plugins/api/src/activator.js';
import { createLoggingService } from '../../../../plugins/logging/src/service.js';
import { RecordingLoggerPort } from '../../../../../tests/helpers/recording-logger.js';

test('API activator registers a frozen server factory without creating resources', () => {
  const services = new ScopedServiceRegistry();
  const logging = createLoggingService();
  let loggerCreations = 0;
  const recordingLogging: LoggingServicePort = {
    ...logging,
    createLogger(options, name) {
      loggerCreations++;
      return logging.createLogger(options, name);
    },
  };
  services.register(LOGGING_SERVICE, recordingLogging);
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
  const api = services.resolve(API_SERVICE);

  assert.equal(Object.isFrozen(api), true);
  assert.equal('close' in api, false);
  assert.equal(loggerCreations, 0);
  const manifest = corePluginManifest('pixiecore.api');
  assert.deepEqual(manifest.requires, {
    'pixiecore.logging': '^0.1.0',
    'pixiecore.runtime': '^0.1.0',
  });
  assert.equal(serviceComponent(manifest).service_id, API_SERVICE.id);
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

test('API server closes an injected runtime, logger, and external bootstrap in parallel once', async () => {
  const services = new ScopedServiceRegistry();
  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const logger = new RecordingLoggerPort('pixiecore.api');
  logger.close = (): Promise<void> => {
    started.push('logger');
    return gate;
  };
  const logging: LoggingServicePort = {
    ...createLoggingService(),
    createLogger(): RecordingLoggerPort {
      return logger;
    },
  };
  services.register(LOGGING_SERVICE, logging);
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
  createCorePluginActivator().activate(context);

  const runtime: ApiRuntime = {
    providerName: 'test-provider',
    model: 'test-model',
    async executeYaml() { return {}; },
    close(): Promise<void> {
      started.push('runtime');
      return gate;
    },
  };
  const composition: ApiServerCompositionPort = {
    environment: {},
    runtime,
    getLoggingConfig: () => ({ logToConsole: false }),
    closeBootstrap(): Promise<void> {
      started.push('bootstrap');
      return gate;
    },
  };
  const server = services.resolve(API_SERVICE).createServer({}, composition);

  assert.equal(server.runtime, runtime);
  assert.equal(server.apiLogger, logger);
  const closing = server.closeResources();
  await waitForImmediate();
  assert.deepEqual([...started].sort(), ['bootstrap', 'logger', 'runtime']);

  release();
  await closing;
  await server.closeResources();
  assert.deepEqual([...started].sort(), ['bootstrap', 'logger', 'runtime']);
});

test('public createApp stays synchronous and reuses its concrete runtime bootstrap scope', async () => {
  const server = createApp({
    environment: {},
    mcpConfigPath: 'disabled',
    logToConsole: false,
  });
  try {
    assert.ok(server.runtime instanceof PromptRuntime);
    assert.ok(server.apiLogger instanceof PixieCoreLogger);
    assert.equal(server.listening, false);
    const runtime = server.runtime as PromptRuntime;
    const api = runtime.pluginManager.getPluginStatus().plugins.find(
      plugin => plugin.id === 'pixiecore.api',
    );
    assert.equal(api?.activated, true);
  } finally {
    await server.closeResources();
  }
});

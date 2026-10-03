import assert from 'node:assert/strict';
import test from 'node:test';
import { ScopedServiceRegistry } from '../../src/core/bootstrap/plugin-manager/registries/services.js';
import {
  LOGGING_SERVICE,
  MULTIMODAL_SERVICE,
  VALIDATION_SERVICE,
} from '../../src/core/contracts/plugin/services.js';
import type { PluginActivationContext } from '../../src/core/contracts/plugin/activation.js';
import type { OutputDecorator, Provider } from '../../src/core/contracts/types/index.js';
import { CORE_PLUGIN_CATALOG } from '../../src/core/kernel/generated/core-plugin-catalog.generated.js';
import type {
  StaticCorePluginManifest,
  StaticCoreServiceComponent,
} from '../../src/core/bootstrap/plugin-manager/model/definition.js';
import { createCorePluginActivator as createLoggingActivator } from '../../src/plugins/logging/src/activator.js';
import { createLoggingService } from '../../src/plugins/logging/src/service.js';
import { createCorePluginActivator as createMultimodalActivator } from '../../src/plugins/multimodal/src/activator.js';
import { createMultimodalService } from '../../src/plugins/multimodal/src/service.js';
import { SchemaGuard } from '../../src/plugins/validation/src/schema/guard.js';
import { createCorePluginActivator as createValidationActivator } from '../../src/plugins/validation/src/activator.js';
import { createValidationService } from '../../src/plugins/validation/src/service.js';

const MINIMAL_BLUEPRINT = {
  name: 'Service fixture',
  version: '1.0',
  role: 'assistant',
  prompt: 'Return {value}',
  output_schema: {
    type: 'object',
    properties: { result: { type: 'string' } },
    required: ['result'],
  },
};

test('core service factories return fresh frozen non-closable capabilities', () => {
  const factoryPairs = [
    [createLoggingService(), createLoggingService()],
    [createValidationService(), createValidationService()],
    [createMultimodalService(), createMultimodalService()],
  ] as const;

  for (const [first, second] of factoryPairs) {
    assert.notEqual(first, second);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(second), true);
    assert.equal('close' in first, false);
    assert.equal('close' in second, false);
  }
  assert.equal('getLogger' in factoryPairs[0][0], false);
});

test('core service activators synchronously register isolated scope values', () => {
  const first = activateServices();
  const second = activateServices();

  assert.notEqual(
    first.services.resolve(LOGGING_SERVICE),
    second.services.resolve(LOGGING_SERVICE),
  );
  assert.notEqual(
    first.services.resolve(VALIDATION_SERVICE),
    second.services.resolve(VALIDATION_SERVICE),
  );
  assert.notEqual(
    first.services.resolve(MULTIMODAL_SERVICE),
    second.services.resolve(MULTIMODAL_SERVICE),
  );
  assert.deepEqual(first.owned, [first.decorators[0]]);
  assert.ok(first.decorators[0] instanceof SchemaGuard);

  assert.equal(serviceComponent(corePluginManifest('pixiecore.logging')).service_id, LOGGING_SERVICE.id);
  assert.equal(serviceComponent(corePluginManifest('pixiecore.validation')).service_id, VALIDATION_SERVICE.id);
  assert.equal(
    serviceComponent(corePluginManifest('pixiecore.multimodal')).service_id,
    MULTIMODAL_SERVICE.id,
  );
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

test('logging service uses explicit loggers and leaves the global default out of its port', () => {
  const service = createLoggingService();
  const logger = service.createLogger({
    logToConsole: false,
    logFullPayloads: true,
  }, 'pixiecore.service-test');
  const records: Array<Record<string, unknown>> = [];
  const unsubscribe = logger.subscribe(record => records.push(record));
  try {
    const trace = service.runWithTraceId('service-trace', () => {
      service.logExecutionStart('fixture', { value: 'visible' }, logger);
      service.logValidationResult('schema', true, undefined, logger);
      return service.getTraceId();
    });
    assert.equal(trace, 'service-trace');
    assert.deepEqual(records.map(record => record.step), ['execution_start', 'validation']);
    assert.ok(records.every(record => record.trace_id === 'service-trace'));
    assert.equal(service.sanitizeLogMessage('Authorization: Bearer secret'), 'Authorization: ***REDACTED***');
  } finally {
    unsubscribe();
  }
});

test('validation and multimodal services preserve existing helper contracts', async () => {
  const validation = createValidationService();
  assert.equal(
    validation.createBlueprintValidator().validateDict(MINIMAL_BLUEPRINT).name,
    'Service fixture',
  );
  assert.deepEqual(
    validation.createInputValidator([
      { name: 'count', type: 'integer', required: true },
    ]).validate({ count: '2' }),
    { count: 2 },
  );
  assert.deepEqual(
    validation.createInputSchemaValidator({
      type: 'object',
      properties: { count: { type: 'integer', minimum: 1 } },
      required: ['count'],
      additionalProperties: false,
    }).validate({ count: 2 }),
    { count: 2 },
  );
  assert.deepEqual(
    validation.createOutputValidator(MINIMAL_BLUEPRINT.output_schema).validate({ result: 'ok' }),
    { result: 'ok' },
  );

  const multimodal = createMultimodalService();
  assert.deepEqual(multimodal.contentParts('hello'), [{ type: 'text', text: 'hello' }]);
  assert.equal(multimodal.contentText([
    { type: 'text', text: 'first' },
    { type: 'file', source: 'file-1' },
    { type: 'text', text: 'second' },
  ]), 'firstsecond');
  assert.deepEqual(multimodal.parseDataUrl('data:text/plain;base64,aGVsbG8='), {
    mediaType: 'text/plain',
    data: Buffer.from('hello'),
  });

  let fetchCount = 0;
  const providerFile = await multimodal.resolveAttachment(
    { type: 'file', source: 'file-existing' },
    async () => {
      fetchCount++;
      return new Response('unexpected');
    },
  );
  assert.equal(providerFile.fileId, 'file-existing');
  assert.equal(fetchCount, 0);
});

function activateServices(): {
  readonly services: ScopedServiceRegistry;
  readonly decorators: OutputDecorator[];
  readonly owned: unknown[];
} {
  const services = new ScopedServiceRegistry();
  const decorators: OutputDecorator[] = [];
  const owned: unknown[] = [];
  const context: PluginActivationContext = {
    services,
    own: value => { owned.push(value); },
    registerExtension: () => undefined,
    registerAgentRole: () => undefined,
    registerDecorator: value => { decorators.push(value); },
    registerTool: () => undefined,
    registerProvider: (_provider: Provider) => undefined,
    registerProviderFactory: () => undefined,
  };

  const activators = [
    createLoggingActivator(),
    createValidationActivator(),
    createMultimodalActivator(),
  ];
  for (const activator of activators) {
    assert.equal(activator.activate(context), undefined);
  }
  return { services, decorators, owned };
}

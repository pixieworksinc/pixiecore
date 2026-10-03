import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DefaultAgentRole,
  PermissionGuard,
  PluginLoadError,
  PluginManager,
  SchemaGuard,
  SelfEvalDecorator,
} from '../../src/index.js';
import { StaticCorePluginCatalog } from '../../src/core/kernel/plugin/catalog.js';
import { PluginEngine } from '../../src/core/bootstrap/plugin-manager/activation/engine.js';
import type {
  PluginCatalog,
  PluginDefinition,
  StaticCorePluginCatalogEntry,
  StaticCoreProviderComponent,
} from '../../src/core/bootstrap/plugin-manager/model/definition.js';
import { CORE_PLUGIN_CATALOG } from '../../src/core/kernel/generated/core-plugin-catalog.generated.js';
import {
  activateCorePluginRoots,
  resolvePluginService,
} from '../../src/core/kernel/plugin/manager.js';
import { ScopedServiceRegistry } from '../../src/core/bootstrap/plugin-manager/registries/services.js';
import { PluginStatusTracker } from '../../src/core/bootstrap/plugin-manager/activation/status.js';
import { PLUGIN_ENVIRONMENT_SERVICE } from '../../src/core/contracts/plugin/services.js';
import type { PluginActivationContext } from '../../src/core/contracts/plugin/activation.js';
import type { Provider } from '../../src/core/contracts/types/index.js';
import { withEnvironment } from '../helpers/environment.js';

const PROVIDER_ORDER = [
  'openai',
  'anthropic',
  'azure_openai',
  'azure_native',
  'gemini_native',
  'gemini_openai',
  'apisix',
] as const;

const PROVIDER_FAMILY_IDS = [
  'pixiecore.providers.openai',
  'pixiecore.providers.anthropic',
  'pixiecore.providers.azure',
  'pixiecore.providers.gemini',
  'pixiecore.providers.apisix',
] as const;

test('generated provider family catalog fixes nested ownership and public names', () => {
  const families = (CORE_PLUGIN_CATALOG as readonly StaticCorePluginCatalogEntry[]).filter(entry => (
    entry.parentId === 'pixiecore.providers'
  ));
  assert.deepEqual(families.map(entry => entry.manifest.id), PROVIDER_FAMILY_IDS);
  assert.deepEqual(
    families.flatMap(entry => entry.manifest.components)
      .filter((component): component is StaticCoreProviderComponent => (
        component.type === 'provider'
      ))
      .map(component => component.provider_name),
    PROVIDER_ORDER,
  );
});

test('generated core catalog reproduces the exact constructor-visible foundation', async () => {
  const manager = new PluginManager();
  try {
    assert.deepEqual([...manager.agentRoles.keys()], ['assistant', 'default']);
    const role = manager.getAgentRole('assistant');
    assert.ok(role instanceof DefaultAgentRole);
    assert.equal(role, manager.getAgentRole('default'));

    const decorators = manager.getDecorators();
    assert.ok(decorators[0] instanceof SchemaGuard);
    assert.ok(decorators[1] instanceof PermissionGuard);
    assert.ok(decorators[2] instanceof SelfEvalDecorator);
    assert.deepEqual(
      decorators.map(decorator => [decorator.priority, decorator.stage]),
      [[10, 'after'], [20, 'before'], [30, 'after']],
    );

    assert.deepEqual([...manager.providers.keys()], PROVIDER_ORDER);
    for (const name of PROVIDER_ORDER) assert.equal(manager.isBuiltInProvider(name), true);
  } finally {
    await manager.close();
  }
});

test('PluginManager records every core descriptor and keeps bootstrap helpers internal', async () => {
  const environment = { PIXIECORE_SCOPE_TEST: 'snapshot' };
  const manager = new PluginManager(undefined, environment);
  environment.PIXIECORE_SCOPE_TEST = 'changed';
  try {
    const status = manager.getPluginStatus().plugins.filter(plugin => plugin.origin === 'core');
    assert.equal(status.length, CORE_PLUGIN_CATALOG.length);
    assert.ok(status.every(plugin => plugin.enabled && plugin.locked));
    assert.deepEqual(resolvePluginService(manager, PLUGIN_ENVIRONMENT_SERVICE), {
      PIXIECORE_SCOPE_TEST: 'snapshot',
    });

    const before = manager.getAgentRole('assistant');
    activateCorePluginRoots(manager, ['pixiecore.roles', 'pixiecore.roles']);
    assert.equal(manager.getAgentRole('assistant'), before);
  } finally {
    await manager.close();
  }
});

test('core activators and every constructor-visible contribution are fresh per manager', async () => {
  const first = new PluginManager();
  const second = new PluginManager();
  try {
    assert.notEqual(first.getAgentRole('assistant'), second.getAgentRole('assistant'));
    for (const [index, decorator] of first.getDecorators().entries()) {
      assert.notEqual(decorator, second.getDecorators()[index]);
    }
    for (const name of PROVIDER_ORDER) {
      assert.notEqual(first.getProvider(name), second.getProvider(name));
    }
    for (const entry of CORE_PLUGIN_CATALOG) {
      assert.notEqual(entry.createActivator(), entry.createActivator());
    }
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test('legacy load never reactivates core or replaces call-time overrides', async () => {
  const manager = new PluginManager();
  const roleMap = manager.agentRoles;
  const toolMap = manager.tools;
  const role = manager.getAgentRole('assistant');
  const decorators = manager.getDecorators();
  const customProvider: Provider = {
    name: 'openai',
    model: 'custom',
    supportsTools: false,
    supportsMultimodal: false,
    supportsVision: () => false,
    supportsFileInput: () => false,
    getModelList: async () => ['custom'],
    generate: async () => ({ content: '{}' }),
  };
  manager.registerProvider(customProvider);
  const providerMap = manager.providers;

  await manager.load();
  await manager.load();

  assert.notEqual(manager.agentRoles, roleMap);
  assert.notEqual(manager.tools, toolMap);
  assert.notEqual(manager.providers, providerMap);
  assert.deepEqual([...manager.agentRoles], [...roleMap]);
  assert.deepEqual([...manager.tools], [...toolMap]);
  assert.deepEqual([...manager.providers], [...providerMap]);
  assert.equal(manager.getAgentRole('assistant'), role);
  assert.deepEqual(manager.getDecorators(), decorators);
  assert.equal(manager.getProvider('openai')?.create({}), customProvider);
  assert.equal(manager.isBuiltInProvider('openai'), false);
  await manager.close();
});

test('core provider factories retain the manager environment snapshot and explicit precedence', async () => {
  await withEnvironment({ OPENAI_API_KEY: undefined }, async () => {
    const sourceEnvironment: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'manager-snapshot' };
    const manager = new PluginManager(undefined, sourceEnvironment);
    delete sourceEnvironment.OPENAI_API_KEY;
    try {
      const provider = await manager.createProvider('openai');
      assert.equal(provider.name, 'openai');
      await assert.rejects(
        manager.createProvider('openai', { environment: {} }),
        /Missing required environment variable: OPENAI_API_KEY/,
      );
    } finally {
      await manager.close();
    }
  });
});

test('static core catalog rejects duplicate, spoofed, invalid-version, and disabled metadata', () => {
  const entry = CORE_PLUGIN_CATALOG[0];
  assert.ok(entry);
  assert.throws(
    () => new StaticCorePluginCatalog([entry, entry]),
    /Duplicate core plugin id/,
  );
  assert.throws(
    () => new StaticCorePluginCatalog([{
      ...entry,
      manifest: { ...entry.manifest, id: 'acme.spoof' },
    } as StaticCorePluginCatalogEntry]),
    /reserved pixiecore namespace/,
  );
  assert.throws(
    () => new StaticCorePluginCatalog([{
      ...entry,
      manifest: { ...entry.manifest, version: '1.0.0-01' },
    } as StaticCorePluginCatalogEntry]),
    /invalid SemVer version/,
  );
  assert.throws(
    () => new StaticCorePluginCatalog([{
      ...entry,
      manifest: { ...entry.manifest, enabled: false },
    } as unknown as StaticCorePluginCatalogEntry]),
    /may not define trusted field enabled/,
  );
  assert.throws(
    () => new StaticCorePluginCatalog([{
      ...entry,
      parentId: 'pixiecore.parent',
    }]),
    /Nested core plugin id must begin with pixiecore\.parent\./,
  );
});

test('synchronous core activation shares lifecycle ownership and rejects thenables', async () => {
  const events: string[] = [];
  const manifest = Object.freeze({
    schema: 'pixiecore.plugin/v1' as const,
    id: 'pixiecore.lifecycle-test',
    name: 'Lifecycle Test',
    version: '1.0.0',
    description: 'Exercises synchronous core lifecycle ownership.',
    entry: './lifecycle-test.js' as const,
    requires: Object.freeze({}),
    optional_requires: Object.freeze({}),
    conflicts: Object.freeze({}),
    components: Object.freeze([
      Object.freeze({ type: 'tool', export: 'LifecycleTool', tool_name: 'lifecycle' }),
    ]),
  });
  const catalog = new StaticCorePluginCatalog([{
    manifest,
    manifestUrl: new URL('file:///pixiecore/lifecycle-test/lifecycle-test.yaml'),
    createActivator: () => ({
      activate(context): void {
        context.own({ close: () => { events.push('contribution'); } });
      },
      close: () => { events.push('activator'); },
    }),
  }]);
  const services = new ScopedServiceRegistry();
  let engine: PluginEngine;
  const context: PluginActivationContext = {
    services,
    own: value => engine.trackResource(value),
    registerExtension: () => undefined,
    registerAgentRole: () => undefined,
    registerDecorator: () => undefined,
    registerTool: () => undefined,
    registerProvider: () => undefined,
    registerProviderFactory: () => undefined,
  };
  engine = new PluginEngine(catalog, () => context);
  engine.activateSynchronousCatalog();
  engine.activateSynchronousCatalog();
  await engine.close();
  await engine.close();
  assert.deepEqual(events, ['contribution', 'activator']);

  const asyncCatalog = new StaticCorePluginCatalog([{
    manifest,
    manifestUrl: new URL('file:///pixiecore/lifecycle-test/lifecycle-test.yaml'),
    createActivator: () => ({
      activate: (() => Promise.resolve()) as never,
    }),
  }]);
  const asyncEngine = new PluginEngine(asyncCatalog, () => context);
  assert.throws(
    () => asyncEngine.activateSynchronousCatalog(),
    error => error instanceof PluginLoadError && /must activate synchronously/.test(error.message),
  );
});

test('core root activation is required-closure based, optional-aware, and idempotent', async () => {
  const firstEvents: string[] = [];
  const firstStatus = new PluginStatusTracker();
  const first = activationEngine(firstEvents, firstStatus);

  first.engine.activateSynchronousRoots(['pixiecore.root']);
  first.engine.activateSynchronousRoots(['pixiecore.root']);
  assert.deepEqual(firstEvents, ['pixiecore.required', 'pixiecore.root']);
  assert.deepEqual(
    firstStatus.getSnapshot().plugins.map(plugin => [plugin.id, plugin.state, plugin.activated]),
    [
      ['pixiecore.root', 'activated', true],
      ['pixiecore.optional', 'enabled', false],
      ['pixiecore.required', 'activated', true],
      ['pixiecore.unrelated', 'enabled', false],
    ],
  );
  assert.throws(
    () => first.engine.activateSynchronousRoots(['pixiecore.missing']),
    /Unknown core plugin activation root: pixiecore\.missing/,
  );
  await first.engine.close();

  const orderedEvents: string[] = [];
  const ordered = activationEngine(orderedEvents);
  ordered.engine.activateSynchronousRoots(['pixiecore.root', 'pixiecore.optional']);
  assert.deepEqual(orderedEvents, [
    'pixiecore.optional',
    'pixiecore.required',
    'pixiecore.root',
  ]);
  await ordered.engine.close();
});

test('activating a core parent cascades through every nested descendant', async () => {
  const events: string[] = [];
  const catalog = new StaticCorePluginCatalog([
    activationEntry('pixiecore.family', events),
    {
      ...activationEntry('pixiecore.family.child', events, {
        requires: { 'pixiecore.family': '^1.0.0' },
      }),
      parentId: 'pixiecore.family',
    },
    {
      ...activationEntry('pixiecore.family.child.leaf', events, {
        requires: { 'pixiecore.family.child': '^1.0.0' },
      }),
      parentId: 'pixiecore.family.child',
    },
    activationEntry('pixiecore.outside', events),
  ]);
  const services = new ScopedServiceRegistry();
  const engine = new PluginEngine(
    catalog,
    () => emptyActivationContext(services, value => engine.trackResource(value)),
  );
  engine.activateSynchronousRoots(['pixiecore.family']);
  assert.deepEqual(events, [
    'pixiecore.family',
    'pixiecore.family.child',
    'pixiecore.family.child.leaf',
  ]);
  await engine.close();
});

test('deferred plugins activate required core roots before loading their modules', async () => {
  const events: string[] = [];
  const core = activationCatalog(events);
  const managedDescriptor = Object.freeze({
    id: 'acme.runtime-consumer',
    schema: 'pixiecore.plugin/v1' as const,
    name: 'Runtime consumer',
    version: '1.0.0',
    origin: 'managed-custom' as const,
    manifestPath: '/plugins/acme.runtime-consumer/plugin.yml',
    rootPath: '/plugins/acme.runtime-consumer',
    ordinal: 1,
    requires: Object.freeze({ 'pixiecore.root': '^1.0.0' }),
    optionalRequires: Object.freeze({}),
    conflicts: Object.freeze({}),
  });
  const catalog: PluginCatalog = {
    synchronousDefinitions: () => core.synchronousDefinitions(),
    async *definitions(): AsyncIterable<PluginDefinition> {
      yield {
        descriptor: managedDescriptor,
        loadActivator: () => {
          events.push('managed:module');
          return { activate: () => { events.push('managed:activate'); } };
        },
      };
    },
  };
  const services = new ScopedServiceRegistry();
  const context = emptyActivationContext(services, () => undefined);
  const engine = new PluginEngine(catalog, () => context);

  await engine.load();
  assert.deepEqual(events, [
    'pixiecore.required',
    'pixiecore.root',
    'managed:module',
    'managed:activate',
  ]);
  await engine.close();
});

function activationEngine(
  events: string[],
  status?: PluginStatusTracker,
): { readonly engine: PluginEngine } {
  const catalog = activationCatalog(events);
  const services = new ScopedServiceRegistry();
  let engine: PluginEngine;
  const context = emptyActivationContext(services, value => engine.trackResource(value));
  engine = new PluginEngine(catalog, () => context, undefined, status);
  return { engine };
}

function activationCatalog(events: string[]): StaticCorePluginCatalog {
  return new StaticCorePluginCatalog([
    activationEntry('pixiecore.root', events, {
      requires: { 'pixiecore.required': '^1.0.0' },
      optional_requires: { 'pixiecore.optional': '^1.0.0' },
    }),
    activationEntry('pixiecore.optional', events),
    activationEntry('pixiecore.required', events),
    activationEntry('pixiecore.unrelated', events),
  ]);
}

function activationEntry(
  id: string,
  events: string[],
  dependencies: {
    readonly requires?: Readonly<Record<string, string>>;
    readonly optional_requires?: Readonly<Record<string, string>>;
  } = {},
): StaticCorePluginCatalogEntry {
  const pluginName = id.slice('pixiecore.'.length);
  const manifest = Object.freeze({
    schema: 'pixiecore.plugin/v1' as const,
    id,
    name: id,
    version: '1.0.0',
    description: `Activation fixture for ${id}.`,
    entry: `./${pluginName}.js` as `./${string}.js`,
    requires: Object.freeze({ ...(dependencies.requires ?? {}) }),
    optional_requires: Object.freeze({ ...(dependencies.optional_requires ?? {}) }),
    conflicts: Object.freeze({}),
    components: Object.freeze([
      Object.freeze({
        type: 'service' as const,
        export: 'FixtureService',
        service_id: `${id}.service`,
      }),
    ]),
  });
  return {
    manifest,
    manifestUrl: new URL(`file:///${id}/${pluginName}.yaml`),
    createActivator: () => ({ activate: () => { events.push(id); } }),
  };
}

function emptyActivationContext(
  services: ScopedServiceRegistry,
  own: (value: unknown) => void,
): PluginActivationContext {
  return {
    services,
    own,
    registerExtension: () => undefined,
    registerAgentRole: () => undefined,
    registerDecorator: () => undefined,
    registerTool: () => undefined,
    registerProvider: () => undefined,
    registerProviderFactory: () => undefined,
  };
}

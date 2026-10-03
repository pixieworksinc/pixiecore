import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { LegacyPluginCatalog } from '../../src/core/bootstrap/plugin-manager/catalog/index.js';
import type {
  NormalizedPluginDescriptor,
  PluginCatalog,
  PluginDefinition,
  SynchronousPluginDefinition,
} from '../../src/core/bootstrap/plugin-manager/model/definition.js';
import { PluginEngine } from '../../src/core/bootstrap/plugin-manager/activation/engine.js';
import { PluginStatusTracker } from '../../src/core/bootstrap/plugin-manager/activation/status.js';
import { PluginLoadError } from '../../src/core/contracts/errors/index.js';
import type { PluginActivationContext } from '../../src/core/contracts/plugin/activation.js';
import { writePluginFixture } from '../helpers/plugin.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const EMPTY_DEPENDENCIES: Readonly<Record<string, string>> = Object.freeze({});
const UNUSED_CONTEXT = {} as PluginActivationContext;
const data = testData('plugin lifecycle status');

test('plugin status snapshots are passive, defensive, and deeply frozen', () => {
  const tracker = new PluginStatusTracker();
  const roots = ['/workspace/plugins'];
  const requires = { 'pixiecore.runtime': '^1.0.0' };
  const diagnostic = {
    code: 'invalid-disabled-manifest',
    message: 'invalid while disabled',
    pluginId: undefined,
    manifestPath: '/workspace/plugins/invalid/plugin.yml',
  };

  tracker.configure('/workspace/pixiecore.plugins.yml', roots);
  tracker.record({
    origin: 'managed-custom',
    state: 'invalid-disabled',
    enabled: false,
    manifestPath: diagnostic.manifestPath,
    rootPath: '/workspace/plugins/invalid',
    ordinal: 2,
    diagnostics: [diagnostic],
  });
  tracker.record({
    id: 'acme.converter',
    schema: 'pixiecore.plugin/v1',
    name: 'Converter',
    version: '1.0.0',
    origin: 'managed-custom',
    state: 'resolved',
    enabled: true,
    manifestPath: '/workspace/plugins/converter/plugin.yml',
    rootPath: '/workspace/plugins/converter',
    ordinal: 1,
    requires,
  });

  roots[0] = '/changed';
  requires['pixiecore.runtime'] = '*';
  diagnostic.message = 'changed';
  const snapshot = tracker.getSnapshot();

  assert.equal(snapshot.configPath, '/workspace/pixiecore.plugins.yml');
  assert.deepEqual(snapshot.roots, ['/workspace/plugins']);
  assert.deepEqual(snapshot.plugins.map(plugin => plugin.state), ['resolved', 'invalid-disabled']);
  assert.deepEqual(snapshot.plugins[0]?.requires, { 'pixiecore.runtime': '^1.0.0' });
  assert.equal(snapshot.plugins[1]?.diagnostics[0]?.message, 'invalid while disabled');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.roots), true);
  assert.equal(Object.isFrozen(snapshot.plugins), true);
  assert.equal(Object.isFrozen(snapshot.plugins[0]), true);
  assert.equal(Object.isFrozen(snapshot.plugins[0]?.requires), true);
  assert.equal(Object.isFrozen(snapshot.plugins[1]?.diagnostics), true);
  assert.equal(Object.isFrozen(snapshot.plugins[1]?.diagnostics[0]), true);

  assert.notEqual(snapshot, tracker.getSnapshot());
  assert.deepEqual(snapshot, tracker.getSnapshot());
});

test('engine reports activation, failure, and best-effort disposal without changing errors', async () => {
  const tracker = new PluginStatusTracker();
  const coreDescriptor = descriptor('pixiecore.status-test', 'core', 1);
  const closeError = new Error('close failed');
  const coreDefinition: SynchronousPluginDefinition = {
    descriptor: coreDescriptor,
    loadActivator: () => ({
      activate: () => undefined,
      close: () => { throw closeError; },
    }),
  };
  const coreCatalog: PluginCatalog = {
    synchronousDefinitions: () => [coreDefinition],
    async *definitions(): AsyncIterable<PluginDefinition> {},
  };
  const coreEngine = new PluginEngine(coreCatalog, () => UNUSED_CONTEXT, undefined, tracker);

  coreEngine.activateSynchronousCatalog();
  assert.deepEqual(tracker.getSnapshot().plugins.map(plugin => ({
    id: plugin.id,
    state: plugin.state,
    enabled: plugin.enabled,
    locked: plugin.locked,
    activated: plugin.activated,
  })), [{
    id: 'pixiecore.status-test',
    state: 'activated',
    enabled: true,
    locked: true,
    activated: true,
  }]);

  await assert.rejects(coreEngine.close(), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors[0], closeError);
    return true;
  });
  assert.equal(tracker.getSnapshot().plugins[0]?.state, 'disposed');
  assert.equal(tracker.getSnapshot().plugins[0]?.activated, false);

  const failedTracker = new PluginStatusTracker();
  const customDescriptor = descriptor('acme.failure', 'managed-custom', 1);
  let stateDuringActivation: string | undefined;
  const failingCatalog: PluginCatalog = {
    synchronousDefinitions: () => [],
    async *definitions(): AsyncIterable<PluginDefinition> {
      yield {
        descriptor: customDescriptor,
        loadActivator: () => ({
          activate: () => {
            stateDuringActivation = failedTracker.getSnapshot().plugins[0]?.state;
            throw new Error('activation failed');
          },
        }),
      };
    },
  };
  const failingEngine = new PluginEngine(
    failingCatalog,
    () => UNUSED_CONTEXT,
    undefined,
    failedTracker,
  );

  await assert.rejects(failingEngine.load(), /Failed to load plugins: activation failed/);
  assert.equal(stateDuringActivation, 'loaded');
  const failed = failedTracker.getSnapshot().plugins[0];
  assert.equal(failed?.state, 'failed');
  assert.equal(failed?.diagnostics[0]?.code, 'plugin-load-failed');
  assert.equal(failed?.diagnostics[0]?.message, 'activation failed');
});

test('engine close waits for an in-flight activation before disposing resources', async () => {
  let releaseActivation = (): void => undefined;
  const activationGate = new Promise<void>(resolve => { releaseActivation = resolve; });
  let reportActivationStarted = (): void => undefined;
  const activationStarted = new Promise<void>(resolve => { reportActivationStarted = resolve; });
  const events: string[] = [];
  const customDescriptor = descriptor('acme.close-during-load', 'managed-custom', 1);
  const catalog: PluginCatalog = {
    synchronousDefinitions: () => [],
    async *definitions(): AsyncIterable<PluginDefinition> {
      yield {
        descriptor: customDescriptor,
        loadActivator: () => ({
          activate: async () => {
            events.push('activate');
            reportActivationStarted();
            await activationGate;
            events.push('activated');
          },
          close: () => { events.push('close'); },
        }),
      };
    },
  };
  const engine = new PluginEngine(catalog, () => UNUSED_CONTEXT);

  const load = engine.load();
  await activationStarted;
  const close = engine.close();
  await Promise.resolve();
  assert.deepEqual(events, ['activate']);
  releaseActivation();
  await Promise.all([load, close]);
  assert.deepEqual(events, ['activate', 'activated', 'close']);
});

test('activation failure retains its primary error while every resource cleanup is attempted once', async () => {
  const tracker = new PluginStatusTracker();
  const firstId = data.text('first cleanup plugin', 'acme.first');
  const failingId = data.text('failing cleanup plugin', 'acme.failing');
  const activationError = new Error(data.text('activation error'));
  const syncCloseError = new Error(data.text('synchronous close error'));
  const asyncCloseError = new Error(data.text('asynchronous close error'));
  const events: string[] = [];
  let firstCloseCount = 0;
  let failingCloseCount = 0;
  const catalog: PluginCatalog = {
    synchronousDefinitions: () => [],
    async *definitions(): AsyncIterable<PluginDefinition> {
      yield {
        descriptor: descriptor(firstId, 'managed-custom', 1),
        loadActivator: () => ({
          activate: () => { events.push(`activate:${firstId}`); },
          close: () => {
            firstCloseCount++;
            events.push(`close:${firstId}`);
            throw syncCloseError;
          },
        }),
      };
      yield {
        descriptor: descriptor(failingId, 'managed-custom', 2),
        loadActivator: () => ({
          activate: () => {
            events.push(`activate:${failingId}`);
            throw activationError;
          },
          close: async () => {
            failingCloseCount++;
            events.push(`close:${failingId}`);
            throw asyncCloseError;
          },
        }),
      };
    },
  };
  const engine = new PluginEngine(catalog, () => UNUSED_CONTEXT, undefined, tracker);

  await assert.rejects(engine.load(), error => {
    assert.ok(error instanceof PluginLoadError);
    assert.equal(error.message, `Failed to load plugins: ${activationError.message}`);
    assert.equal(error.cause, activationError);
    return true;
  });
  assert.deepEqual(events, [
    `activate:${firstId}`,
    `activate:${failingId}`,
    `close:${failingId}`,
    `close:${firstId}`,
  ]);
  assert.equal(firstCloseCount, 1);
  assert.equal(failingCloseCount, 1);

  const status = tracker.getSnapshot();
  assert.equal(Object.isFrozen(status), true);
  assert.equal(status.plugins.find(plugin => plugin.id === firstId)?.state, 'disposed');
  assert.equal(status.plugins.find(plugin => plugin.id === failingId)?.state, 'failed');
  await engine.close();
  await engine.close();
  assert.equal(firstCloseCount, 1);
  assert.equal(failingCloseCount, 1);
});

test('legacy catalog records a resolved definition when it is yielded', async () => {
  await withTempDirectory(async root => {
    await writePluginFixture(root, 'legacy', {
      manifest: `
name: Legacy Status
version: '1.0.0'
module: ./plugin.mjs
`,
      module: 'export default { tools: [] };',
    });
    const tracker = new PluginStatusTracker();
    const catalog = new LegacyPluginCatalog([root], tracker);
    const next = await catalog.definitions()[Symbol.asyncIterator]().next();

    assert.equal(next.done, false);
    assert.deepEqual(tracker.getSnapshot().plugins.map(plugin => ({
      id: plugin.id,
      origin: plugin.origin,
      state: plugin.state,
      enabled: plugin.enabled,
      manifestPath: plugin.manifestPath,
    })), [{
      id: 'legacy:1:legacy/plugin.yml',
      origin: 'legacy',
      state: 'resolved',
      enabled: true,
      manifestPath: join(root, 'legacy', 'plugin.yml'),
    }]);
  });
});

function descriptor(
  id: string,
  origin: NormalizedPluginDescriptor['origin'],
  ordinal: number,
): NormalizedPluginDescriptor {
  return Object.freeze({
    id,
    schema: 'pixiecore.plugin/v1',
    name: id,
    version: '1.0.0',
    origin,
    manifestPath: `/plugins/${id}/plugin.yml`,
    rootPath: `/plugins/${id}`,
    ordinal,
    requires: EMPTY_DEPENDENCIES,
    optionalRequires: EMPTY_DEPENDENCIES,
    conflicts: EMPTY_DEPENDENCIES,
  });
}

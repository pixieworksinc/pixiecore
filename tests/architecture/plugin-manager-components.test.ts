import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginLoadError } from '../../src/core/contracts/errors/index.js';
import type {
  OutputDecorator,
  Provider,
  ProviderFactory,
  RegisteredTool,
} from '../../src/core/contracts/types/index.js';
import { PluginLifecycle } from '../../src/core/bootstrap/plugin-manager/activation/lifecycle.js';
import { ContributionRegistries } from '../../src/core/bootstrap/plugin-manager/registries/contributions.js';

function createProvider(name: string, model: string): Provider {
  return {
    name,
    model,
    supportsTools: true,
    supportsMultimodal: true,
    supportsVision: () => true,
    supportsFileInput: () => true,
    getModelList: async () => [model],
    generate: async () => ({ content: '{}' }),
  };
}

test('contribution registries preserve maps, replacement rules, and stable decorator ordering', async () => {
  const registries = new ContributionRegistries();
  assert.ok(registries.agentRoles instanceof Map);
  assert.ok(registries.tools instanceof Map);
  assert.ok(registries.providers instanceof Map);

  const firstRole = { supportedRoles: ['same'], apply: () => ({ messages: [] }) };
  const secondRole = { supportedRoles: ['same'], apply: () => ({ messages: [] }) };
  registries.registerAgentRole(firstRole);
  registries.registerAgentRole(secondRole);
  assert.equal(registries.getAgentRole('same'), secondRole);

  const firstTool: RegisteredTool = {
    name: 'same',
    description: 'first',
    parameters: { type: 'object' },
    execute: () => 'first',
  };
  const secondTool: RegisteredTool = { ...firstTool, description: 'second', execute: () => 'second' };
  registries.registerTool(firstTool);
  registries.registerTool(secondTool);
  assert.equal(registries.getTool('same'), secondTool);

  const decorators: OutputDecorator[] = [
    { priority: 20, validate: () => undefined },
    { priority: 10, validate: () => undefined },
    { priority: 20, validate: () => undefined },
  ];
  for (const decorator of decorators) registries.registerDecorator(decorator);
  assert.deepEqual(registries.getDecorators(), [decorators[1], decorators[0], decorators[2]]);

  const builtIn: ProviderFactory = { name: 'same', create: () => createProvider('same', 'built-in') };
  const custom: ProviderFactory = { name: 'same', create: () => createProvider('same', 'custom') };
  registries.registerProviderFactory(builtIn, true);
  assert.equal(registries.isBuiltInProvider('same'), true);
  registries.providers.set('same', custom);
  assert.equal(registries.getProvider('same'), custom);
  assert.equal(registries.isBuiltInProvider('same'), false);
  assert.equal((await registries.createProvider('same')).model, 'custom');
  registries.providers.delete('same');
  assert.equal(registries.getProvider('same'), undefined);
  assert.equal(registries.isBuiltInProvider('same'), false);
  await assert.rejects(
    registries.createProvider('same'),
    error => error instanceof Error && error.message === 'Unknown provider: same',
  );
});

test('contribution registries retain PluginManager validation errors', async () => {
  const registries = new ContributionRegistries();
  assert.throws(
    () => registries.registerAgentRole({ supportedRoles: [] } as never),
    error => error instanceof PluginLoadError && error.message === 'Agent role plugin requires apply()',
  );
  assert.throws(
    () => registries.registerDecorator({ validate: () => undefined }, Number.NaN),
    error => error instanceof PluginLoadError && error.message === 'Decorator priority must be a finite number',
  );
  assert.throws(
    () => registries.registerProviderFactory({ name: '', create: () => createProvider('', '') }),
    error => error instanceof PluginLoadError
      && error.message === 'Provider plugin requires a non-empty name and create()',
  );
  await assert.rejects(
    registries.createProvider('missing'),
    error => error instanceof Error && error.message === 'Unknown provider: missing',
  );
});

test('plugin lifecycle preserves load and reverse best-effort cleanup semantics', async () => {
  const lifecycle = new PluginLifecycle();
  assert.equal(lifecycle.beginLoad(), true);
  lifecycle.completeLoad();
  assert.equal(lifecycle.beginLoad(), false);

  const closed: string[] = [];
  lifecycle.trackResource({ close: () => { closed.push('first'); } });
  lifecycle.trackResource({ close: () => { closed.push('second'); throw new Error('close failed'); } });
  lifecycle.trackResource({ close: () => { closed.push('third'); } });

  await assert.rejects(
    lifecycle.close(),
    error => error instanceof AggregateError
      && error.message === 'Failed to close one or more plugin resources'
      && error.errors.length === 1,
  );
  assert.deepEqual(closed, ['third', 'second', 'first']);
  await lifecycle.close();
  assert.deepEqual(closed, ['third', 'second', 'first']);
  assert.throws(
    () => lifecycle.trackResource({ close: () => undefined }),
    error => error instanceof PluginLoadError && error.message === 'Plugin manager is closed',
  );

  const closedBeforeLoad = new PluginLifecycle();
  await closedBeforeLoad.close();
  assert.throws(
    () => closedBeforeLoad.beginLoad(),
    error => error instanceof PluginLoadError && error.message === 'Plugin manager is closed',
  );
});

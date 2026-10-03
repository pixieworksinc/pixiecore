import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigurationError, PluginLoadError } from '../../src/core/contracts/errors/index.js';
import type { NormalizedPluginDescriptor } from '../../src/core/bootstrap/plugin-manager/model/definition.js';
import {
  resolveManagedPluginDependencies,
  type ManagedResolutionCandidate,
} from '../../src/core/bootstrap/plugin-manager/dependency/resolver.js';

interface FixtureOptions {
  readonly ordinal: number;
  readonly parentId?: string;
  readonly version?: string;
  readonly requires?: Readonly<Record<string, string>>;
  readonly optionalRequires?: Readonly<Record<string, string>>;
  readonly conflicts?: Readonly<Record<string, string>>;
}

function candidate(id: string, options: FixtureOptions): ManagedResolutionCandidate<string> {
  const descriptor: NormalizedPluginDescriptor = {
    id,
    schema: 'pixiecore.plugin/v1',
    name: id,
    version: options.version ?? '1.0.0',
    origin: 'managed-custom',
    manifestPath: `/plugins/${id}/plugin.yml`,
    rootPath: `/plugins/${id}`,
    ordinal: options.ordinal,
    requires: options.requires ?? {},
    optionalRequires: options.optionalRequires ?? {},
    conflicts: options.conflicts ?? {},
  };
  return {
    id,
    ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
    ordinal: options.ordinal,
    validate: async () => ({ descriptor, value: id }),
  };
}

function inventory(...candidates: readonly ManagedResolutionCandidate<string>[]) {
  return new Map(candidates.map(item => [item.id, item]));
}

const core: NormalizedPluginDescriptor = {
  id: 'pixiecore.runtime',
  schema: 'pixiecore.plugin/v1',
  name: 'Runtime',
  version: '1.2.0',
  origin: 'core',
  manifestPath: '/pixiecore/runtime/plugin.yml',
  rootPath: '/pixiecore/runtime',
  ordinal: 1,
  requires: {}, optionalRequires: {}, conflicts: {},
};

test('managed dependency resolution selects required closures and orders dependencies first', async () => {
  const first = candidate('acme.first', {
    ordinal: 1,
    requires: { 'acme.dependency': '^1.0.0', 'pixiecore.runtime': '^1.0.0' },
  });
  const unrelated = candidate('acme.unrelated', { ordinal: 2 });
  const dependency = candidate('acme.dependency', { ordinal: 3 });

  const resolved = await resolveManagedPluginDependencies({
    enabled: ['acme.first', 'acme.unrelated'],
    disabled: new Set(),
    inventory: inventory(first, unrelated, dependency),
    coreDescriptors: [core],
  });

  assert.deepEqual(resolved.map(item => item.value), [
    'acme.unrelated',
    'acme.dependency',
    'acme.first',
  ]);
});

test('optional dependencies do not select plugins but order them when independently selected', async () => {
  const owner = candidate('acme.owner', {
    ordinal: 1,
    optionalRequires: { 'acme.optional': '^2.0.0' },
  });
  const optional = candidate('acme.optional', { ordinal: 2, version: '2.1.0' });
  const available = inventory(owner, optional);

  const withoutOptional = await resolveManagedPluginDependencies({
    enabled: ['acme.owner'], disabled: new Set(), inventory: available, coreDescriptors: [],
  });
  assert.deepEqual(withoutOptional.map(item => item.value), ['acme.owner']);

  const withOptional = await resolveManagedPluginDependencies({
    enabled: ['acme.owner', 'acme.optional'],
    disabled: new Set(),
    inventory: available,
    coreDescriptors: [],
  });
  assert.deepEqual(withOptional.map(item => item.value), ['acme.optional', 'acme.owner']);
});

test('managed parent selection cascades to children while disabled branches remain excluded', async () => {
  const parent = candidate('acme.parent', { ordinal: 1 });
  const child = candidate('acme.parent.child', {
    ordinal: 2,
    parentId: 'acme.parent',
  });
  const grandchild = candidate('acme.parent.child.grandchild', {
    ordinal: 3,
    parentId: 'acme.parent.child',
  });
  const sibling = candidate('acme.parent.sibling', {
    ordinal: 4,
    parentId: 'acme.parent',
  });
  const available = inventory(parent, child, grandchild, sibling);

  const resolved = await resolveManagedPluginDependencies({
    enabled: ['acme.parent'],
    disabled: new Set(['acme.parent.sibling']),
    inventory: available,
    coreDescriptors: [],
  });
  assert.deepEqual(resolved.map(item => item.value), [
    'acme.parent',
    'acme.parent.child',
    'acme.parent.child.grandchild',
  ]);

  await assert.rejects(
    resolveManagedPluginDependencies({
      enabled: ['acme.parent.child'],
      disabled: new Set(['acme.parent']),
      inventory: available,
      coreDescriptors: [],
    }),
    error => error instanceof ConfigurationError
      && /acme\.parent\.child cannot be enabled because acme\.parent is disabled/.test(error.message),
  );
});

test('dependencies cannot select a child below a disabled parent', async () => {
  const owner = candidate('other.owner', {
    ordinal: 1,
    requires: { 'acme.parent.child': '^1.0.0' },
  });
  const parent = candidate('acme.parent', { ordinal: 2 });
  const child = candidate('acme.parent.child', {
    ordinal: 3,
    parentId: 'acme.parent',
  });

  await assert.rejects(
    resolveManagedPluginDependencies({
      enabled: ['other.owner'],
      disabled: new Set(['acme.parent']),
      inventory: inventory(owner, parent, child),
      coreDescriptors: [],
    }),
    error => error instanceof PluginLoadError
      && /requires explicitly disabled plugin acme\.parent\.child/.test(error.message),
  );
});

test('managed dependency policy rejects unknown, disabled, missing, and incompatible requirements', async () => {
  await assert.rejects(
    resolveManagedPluginDependencies({
      enabled: ['acme.unknown'], disabled: new Set(), inventory: new Map(), coreDescriptors: [],
    }),
    ConfigurationError,
  );

  const missingOwner = candidate('acme.owner', {
    ordinal: 1,
    requires: { 'acme.missing': '^1.0.0' },
  });
  await assert.rejects(
    resolveManagedPluginDependencies({
      enabled: ['acme.owner'],
      disabled: new Set(),
      inventory: inventory(missingOwner),
      coreDescriptors: [],
    }),
    error => error instanceof PluginLoadError && /requires missing plugin acme\.missing/.test(error.message),
  );
  await assert.rejects(
    resolveManagedPluginDependencies({
      enabled: ['acme.owner'],
      disabled: new Set(['acme.missing']),
      inventory: inventory(missingOwner, candidate('acme.missing', { ordinal: 2 })),
      coreDescriptors: [],
    }),
    error => error instanceof PluginLoadError && /explicitly disabled/.test(error.message),
  );

  const incompatibleOwner = candidate('acme.incompatible', {
    ordinal: 1,
    requires: { 'acme.dependency': '^2.0.0' },
  });
  await assert.rejects(
    resolveManagedPluginDependencies({
      enabled: ['acme.incompatible'],
      disabled: new Set(),
      inventory: inventory(
        incompatibleOwner,
        candidate('acme.dependency', { ordinal: 2, version: '1.9.0' }),
      ),
      coreDescriptors: [],
    }),
    error => error instanceof PluginLoadError && /found 1\.9\.0/.test(error.message),
  );
});

test('managed dependency policy rejects selected conflicts, core disabling, and cycles', async () => {
  const left = candidate('acme.left', {
    ordinal: 1,
    conflicts: { 'acme.right': '*' },
  });
  const right = candidate('acme.right', { ordinal: 2 });
  await assert.rejects(
    resolveManagedPluginDependencies({
      enabled: ['acme.left', 'acme.right'],
      disabled: new Set(),
      inventory: inventory(left, right),
      coreDescriptors: [],
    }),
    error => error instanceof PluginLoadError && /conflicts with selected plugin acme\.right/.test(error.message),
  );

  await assert.rejects(
    resolveManagedPluginDependencies({
      enabled: [],
      disabled: new Set(['pixiecore.runtime']),
      inventory: new Map(),
      coreDescriptors: [core],
    }),
    ConfigurationError,
  );

  const cycleLeft = candidate('cycle.left', {
    ordinal: 1,
    requires: { 'cycle.right': '*' },
  });
  const cycleRight = candidate('cycle.right', {
    ordinal: 2,
    requires: { 'cycle.left': '*' },
  });
  await assert.rejects(
    resolveManagedPluginDependencies({
      enabled: ['cycle.left'],
      disabled: new Set(),
      inventory: inventory(cycleLeft, cycleRight),
      coreDescriptors: [],
    }),
    error => error instanceof PluginLoadError && /dependency cycle/.test(error.message),
  );
});

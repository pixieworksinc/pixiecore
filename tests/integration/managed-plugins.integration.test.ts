import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  ConfigurationError,
  PluginLoadError,
  PluginManager,
  PromptRuntime,
  type PluginStatusSnapshot,
} from '../../src/index.js';
import {
  buildLegacyPluginManifest,
  buildManagedPluginManifestV1,
  buildManagedPluginStateV1,
  writePluginFixture,
  type ManagedPluginManifestV1FixtureOptions,
} from '../helpers/plugin.js';
import { withTempDirectory } from '../helpers/temp.js';

interface ManagedFixtureOptions extends ManagedPluginManifestV1FixtureOptions {
  readonly markerPath: string;
  readonly toolName?: string;
  readonly toolResult?: string;
  readonly closeMarker?: boolean;
}

test('an enabled managed plugin activates through the public manager API', async () => {
  await withTempDirectory(async root => {
    const managedRoot = join(root, 'managed');
    const markerPath = join(root, 'enabled-imported.txt');
    await writeManagedPlugin(managedRoot, 'enabled', {
      id: 'acme.enabled',
      name: 'Enabled',
      version: '1.0.0',
      markerPath,
      toolName: 'managed-enabled',
      toolResult: 'managed works',
    });
    const statePath = await writeState(root, 'enabled.yml', {
      roots: [managedRoot],
      enabled: ['acme.enabled'],
    });
    const manager = managedManager(statePath);

    try {
      await Promise.all([manager.load(), manager.load()]);
      await manager.load();

      assert.equal(await manager.getTool('managed-enabled')?.execute({}), 'managed works');
      assert.deepEqual(await markerLines(markerPath), ['activate:acme.enabled']);
      const status = manager.getPluginStatus();
      const plugin = status.plugins.find(item => item.id === 'acme.enabled');
      assert.equal(status.configPath, statePath);
      assert.deepEqual(status.roots, [await realpath(managedRoot)]);
      assert.equal(plugin?.origin, 'managed-custom');
      assert.equal(plugin?.state, 'activated');
      assert.equal(plugin?.enabled, true);
      assert.equal(plugin?.activated, true);
    } finally {
      await manager.close();
    }
  });
});

test('a named managed manifest activates its compiled named entry', async () => {
  await withTempDirectory(async root => {
    const managedRoot = join(root, 'managed');
    const markerPath = join(root, 'named-imported.txt');
    await writePluginFixture(managedRoot, 'named', {
      manifestFileName: 'named.yaml',
      moduleFileName: 'named.mjs',
      manifest: buildManagedPluginManifestV1({
        id: 'acme.named',
        name: 'Named managed plugin',
        version: '1.0.0',
        entry: './named.mjs',
      }),
      module: importMarkedToolModule(
        'acme.named',
        markerPath,
        'named-managed-tool',
        'named layout works',
      ),
    });
    const statePath = await writeState(root, 'named.yml', {
      roots: [managedRoot],
      enabled: ['acme.named'],
    });
    const manager = managedManager(statePath);

    try {
      await manager.load();
      assert.equal(
        await manager.getTool('named-managed-tool')?.execute({}),
        'named layout works',
      );
      assert.deepEqual(await markerLines(markerPath), ['activate:acme.named']);
    } finally {
      await manager.close();
    }
  });
});

test('the canonical project plugins directory activates a directory-symlinked plugin', async () => {
  await withTempDirectory(async root => {
    const projectRoot = join(root, 'project');
    const pluginsRoot = join(projectRoot, 'plugins');
    const externalRoot = join(root, 'external');
    const markerPath = join(root, 'symlink-imported.txt');
    const pluginRoot = await writeManagedPlugin(externalRoot, 'linked', {
      id: 'acme.linked',
      name: 'Symlinked managed plugin',
      version: '1.0.0',
      markerPath,
      toolName: 'symlink-managed-tool',
      toolResult: 'symlink works',
    });
    await mkdir(pluginsRoot, { recursive: true });
    await symlink(pluginRoot, join(pluginsRoot, 'linked'), 'dir');
    const statePath = await writeState(projectRoot, 'pixiecore.plugins.yml', {
      roots: [],
      enabled: ['acme.linked'],
    });
    const manager = managedManager(statePath);

    try {
      await manager.load();
      assert.equal(await manager.getTool('symlink-managed-tool')?.execute({}), 'symlink works');
      assert.deepEqual(await markerLines(markerPath), ['activate:acme.linked']);
      assert.deepEqual(manager.getPluginStatus().roots, [await realpath(pluginsRoot)]);
      assert.equal(
        manager.getPluginStatus().plugins.find(item => item.id === 'acme.linked')?.rootPath,
        await realpath(pluginRoot),
      );
    } finally {
      await manager.close();
    }
  });
});

test('a nested managed plugin must use its parent id prefix before any module import', async () => {
  await withTempDirectory(async root => {
    const managedRoot = join(root, 'managed');
    const parentMarker = join(root, 'nested-parent.txt');
    const childMarker = join(root, 'nested-child.txt');
    const parentRoot = await writeManagedPlugin(managedRoot, 'parent', {
      id: 'acme.parent',
      name: 'Nested parent',
      version: '1.0.0',
      markerPath: parentMarker,
    });
    await writeManagedPlugin(join(parentRoot, 'plugins'), 'child', {
      id: 'acme.unrelated-child',
      name: 'Mismatched nested child',
      version: '1.0.0',
      markerPath: childMarker,
    });
    const statePath = await writeState(root, 'nested-prefix.yml', {
      roots: [managedRoot],
      disabled: ['acme.parent', 'acme.unrelated-child'],
    });

    await assertManagedLoadFailure(
      statePath,
      'load',
      /Nested managed plugin id must begin with acme\.parent\./,
      [parentMarker, childMarker],
      status => {
        const child = status.plugins.find(plugin => plugin.id === 'acme.unrelated-child');
        assert.ok(child?.diagnostics.some(diagnostic =>
          diagnostic.code === 'managed-manifest-parent-id'));
      },
    );
  });
});

test('enabling a managed parent cascades to non-disabled child units in parent-first order', async () => {
  await withTempDirectory(async root => {
    const managedRoot = join(root, 'managed');
    const lifecyclePath = join(root, 'nested-lifecycle.txt');
    const disabledMarker = join(root, 'nested-disabled.txt');
    const parentRoot = await writeManagedPlugin(managedRoot, 'parent', {
      id: 'acme.parent',
      name: 'Cascade parent',
      version: '1.0.0',
      markerPath: lifecyclePath,
    });
    const childRoot = join(parentRoot, 'plugins');
    await Promise.all([
      writeManagedPlugin(childRoot, 'child', {
        id: 'acme.parent.child',
        name: 'Cascade child',
        version: '1.0.0',
        markerPath: lifecyclePath,
      }),
      writeManagedPlugin(childRoot, 'disabled-child', {
        id: 'acme.parent.disabled-child',
        name: 'Disabled cascade child',
        version: '1.0.0',
        markerPath: disabledMarker,
      }),
    ]);
    const statePath = await writeState(root, 'nested-cascade.yml', {
      roots: [managedRoot],
      enabled: ['acme.parent'],
      disabled: ['acme.parent.disabled-child'],
    });
    const manager = managedManager(statePath);

    try {
      await manager.load();
      assert.deepEqual(await markerLines(lifecyclePath), [
        'activate:acme.parent',
        'activate:acme.parent.child',
      ]);
      await assertNeverImported([disabledMarker]);
      const byId = new Map(manager.getPluginStatus().plugins.map(plugin => [plugin.id, plugin]));
      assert.equal(byId.get('acme.parent')?.state, 'activated');
      assert.equal(byId.get('acme.parent.child')?.state, 'activated');
      assert.equal(byId.get('acme.parent.disabled-child')?.state, 'disabled');
    } finally {
      await manager.close();
    }
  });
});

test('a disabled managed parent blocks explicit and dependency selection of its children', async t => {
  await t.test('explicit child enablement', async () => {
    await withTempDirectory(async root => {
      const managedRoot = join(root, 'managed');
      const parentMarker = join(root, 'disabled-parent.txt');
      const childMarker = join(root, 'blocked-child.txt');
      const parentRoot = await writeManagedPlugin(managedRoot, 'parent', {
        id: 'acme.parent', name: 'Disabled parent', version: '1.0.0', markerPath: parentMarker,
      });
      await writeManagedPlugin(join(parentRoot, 'plugins'), 'child', {
        id: 'acme.parent.child', name: 'Blocked child', version: '1.0.0', markerPath: childMarker,
      });
      const statePath = await writeState(root, 'disabled-parent.yml', {
        roots: [managedRoot],
        enabled: ['acme.parent.child'],
        disabled: ['acme.parent'],
      });

      await assertManagedLoadFailure(
        statePath,
        'configuration',
        /acme\.parent\.child cannot be enabled because acme\.parent is disabled/,
        [parentMarker, childMarker],
      );
    });
  });

  await t.test('required child dependency', async () => {
    await withTempDirectory(async root => {
      const managedRoot = join(root, 'managed');
      const ownerMarker = join(root, 'dependent-owner.txt');
      const parentMarker = join(root, 'dependency-parent.txt');
      const childMarker = join(root, 'dependency-child.txt');
      const parentRoot = await writeManagedPlugin(managedRoot, 'parent', {
        id: 'acme.parent', name: 'Disabled parent', version: '1.0.0', markerPath: parentMarker,
      });
      await Promise.all([
        writeManagedPlugin(join(parentRoot, 'plugins'), 'child', {
          id: 'acme.parent.child', name: 'Blocked child', version: '1.0.0', markerPath: childMarker,
        }),
        writeManagedPlugin(managedRoot, 'owner', {
          id: 'other.owner',
          name: 'Dependent owner',
          version: '1.0.0',
          requires: { 'acme.parent.child': '^1.0.0' },
          markerPath: ownerMarker,
        }),
      ]);
      const statePath = await writeState(root, 'disabled-parent-dependency.yml', {
        roots: [managedRoot],
        enabled: ['other.owner'],
        disabled: ['acme.parent'],
      });

      await assertManagedLoadFailure(
        statePath,
        'load',
        /other\.owner requires explicitly disabled plugin acme\.parent\.child/,
        [ownerMarker, parentMarker, childMarker],
      );
    });
  });
});

test('RuntimeOptions.pluginConfigPath forwards managed activation into PromptRuntime', async () => {
  await withTempDirectory(async root => {
    const managedRoot = join(root, 'managed');
    const markerPath = join(root, 'runtime-imported.txt');
    await writeManagedPlugin(managedRoot, 'runtime', {
      id: 'acme.runtime',
      name: 'Runtime managed plugin',
      version: '1.0.0',
      markerPath,
      toolName: 'runtime-managed-tool',
    });
    const statePath = await writeState(root, 'runtime.yml', {
      roots: [managedRoot],
      enabled: ['acme.runtime'],
    });
    const runtime = new PromptRuntime({
      environment: {},
      pluginConfigPath: statePath,
      mcpConfigPath: 'disabled',
      provider: {
        name: 'managed-runtime-test',
        model: 'managed-runtime-test',
        supportsTools: false,
        supportsMultimodal: false,
        supportsVision: () => false,
        supportsFileInput: () => false,
        getModelList: async () => ['managed-runtime-test'],
        generate: async () => ({ content: '{"message":"ok"}' }),
      },
    });
    try {
      assert.deepEqual(await runtime.executeYaml(`
name: Managed runtime
version: '1.0'
role: assistant
prompt: Run
output_schema:
  type: object
  required: [message]
  properties:
    message: { type: string }
`), { message: 'ok' });
      assert.ok(runtime.pluginManager.getTool('runtime-managed-tool'));
      assert.deepEqual(await markerLines(markerPath), ['activate:acme.runtime']);
    } finally {
      await runtime.close();
    }
  });
});

test('managed activation preserves call-time override precedence and disposed status', async () => {
  await withTempDirectory(async root => {
    const managedRoot = join(root, 'managed');
    const markerPath = join(root, 'precedence.txt');
    await writeManagedPlugin(managedRoot, 'managed', {
      id: 'acme.precedence',
      name: 'Precedence',
      version: '1.0.0',
      markerPath,
      toolName: 'same-tool',
      toolResult: 'managed',
    });
    const statePath = await writeState(root, 'precedence.yml', {
      roots: [managedRoot],
      enabled: ['acme.precedence'],
    });
    const manager = managedManager(statePath);
    const tool = (result: string) => ({
      name: 'same-tool',
      description: result,
      parameters: { type: 'object' },
      execute: () => result,
    });

    manager.registerTool(tool('before load'));
    assert.equal(await manager.getTool('same-tool')?.execute({}), 'before load');
    await manager.load();
    assert.equal(await manager.getTool('same-tool')?.execute({}), 'managed');
    manager.registerTool(tool('after load'));
    assert.equal(await manager.getTool('same-tool')?.execute({}), 'after load');

    await manager.close();
    const plugin = manager.getPluginStatus().plugins.find(item => item.id === 'acme.precedence');
    assert.equal(plugin?.state, 'disposed');
    assert.equal(plugin?.activated, false);
  });
});

test('unselected and explicitly disabled managed plugins are never imported', async () => {
  await withTempDirectory(async root => {
    const managedRoot = join(root, 'managed');
    const selectedMarker = join(root, 'selected.txt');
    const unselectedMarker = join(root, 'unselected.txt');
    const disabledMarker = join(root, 'disabled.txt');
    await Promise.all([
      writeManagedPlugin(managedRoot, 'a-selected', {
        id: 'acme.selected', name: 'Selected', version: '1.0.0', markerPath: selectedMarker,
      }),
      writeManagedPlugin(managedRoot, 'b-unselected', {
        id: 'acme.unselected', name: 'Unselected', version: '1.0.0', markerPath: unselectedMarker,
      }),
      writeManagedPlugin(managedRoot, 'c-disabled', {
        id: 'acme.disabled', name: 'Disabled', version: '1.0.0', markerPath: disabledMarker,
      }),
    ]);
    const statePath = await writeState(root, 'selection.yml', {
      roots: [managedRoot],
      enabled: ['acme.selected'],
      disabled: ['acme.disabled'],
    });
    const manager = managedManager(statePath);

    try {
      await manager.load();
      assert.deepEqual(await markerLines(selectedMarker), ['activate:acme.selected']);
      await assertNeverImported([unselectedMarker, disabledMarker]);

      const byId = new Map(manager.getPluginStatus().plugins.map(item => [item.id, item]));
      assert.equal(byId.get('acme.unselected')?.state, 'disabled');
      assert.equal(byId.get('acme.disabled')?.state, 'disabled');
      assert.equal(byId.get('acme.unselected')?.enabled, false);
      assert.equal(byId.get('acme.disabled')?.enabled, false);
      assert.equal(
        byId.get('acme.unselected')?.rootPath,
        await realpath(join(managedRoot, 'b-unselected')),
      );
      assert.equal(
        byId.get('acme.disabled')?.rootPath,
        await realpath(join(managedRoot, 'c-disabled')),
      );
    } finally {
      await manager.close();
    }
  });
});

test('an invalid default-disabled manifest is nonfatal and reported without importing it', async () => {
  await withTempDirectory(async root => {
    const managedRoot = join(root, 'managed');
    const markerPath = join(root, 'invalid-imported.txt');
    await writePluginFixture(managedRoot, 'invalid', {
      manifest: buildManagedPluginManifestV1({
        id: 'acme.invalid', name: 'Invalid', version: '1.0.0',
      }).replace('pixiecore.plugin/v1', 'pixiecore.plugin/v999'),
      module: importMarkedToolModule('acme.invalid', markerPath),
    });
    const statePath = await writeState(root, 'invalid-disabled.yml', {
      roots: [managedRoot],
    });
    const manager = managedManager(statePath);

    try {
      await manager.load();
      await assertNeverImported([markerPath]);

      const plugin = manager.getPluginStatus().plugins.find(item => item.id === 'acme.invalid');
      assert.equal(plugin?.state, 'invalid-disabled');
      assert.equal(plugin?.enabled, false);
      assert.equal(plugin?.activated, false);
      assert.ok(plugin?.diagnostics.some(item => /schema/i.test(item.message)));
    } finally {
      await manager.close();
    }
  });
});

test('a default-disabled valid manifest defers an invalid entry path without importing', async () => {
  await withTempDirectory(async root => {
    const managedRoot = join(root, 'managed');
    await writePluginFixture(managedRoot, 'missing-entry', {
      manifest: buildManagedPluginManifestV1({
        id: 'acme.missing-entry',
        name: 'Missing entry',
        version: '1.0.0',
        entry: './missing.mjs',
      }),
    });
    const statePath = await writeState(root, 'missing-entry.yml', { roots: [managedRoot] });
    const manager = managedManager(statePath);

    try {
      await manager.load();
      const plugin = manager.getPluginStatus().plugins.find(item =>
        item.id === 'acme.missing-entry');
      assert.equal(plugin?.state, 'disabled');
      assert.equal(plugin?.enabled, false);
      assert.deepEqual(plugin?.diagnostics, []);
    } finally {
      await manager.close();
    }
  });
});

test('required dependencies activate transitively and close in reverse activation order', async () => {
  await withTempDirectory(async root => {
    const managedRoot = join(root, 'managed');
    const lifecyclePath = join(root, 'lifecycle.txt');
    await Promise.all([
      writeManagedPlugin(managedRoot, 'a-owner', {
        id: 'acme.owner',
        name: 'Owner',
        version: '1.0.0',
        requires: { 'acme.middle': '^1.0.0' },
        markerPath: lifecyclePath,
        closeMarker: true,
      }),
      writeManagedPlugin(managedRoot, 'b-middle', {
        id: 'acme.middle',
        name: 'Middle',
        version: '1.1.0',
        requires: { 'acme.leaf': '~1.2.0' },
        markerPath: lifecyclePath,
        closeMarker: true,
      }),
      writeManagedPlugin(managedRoot, 'c-leaf', {
        id: 'acme.leaf',
        name: 'Leaf',
        version: '1.2.4',
        markerPath: lifecyclePath,
        closeMarker: true,
      }),
    ]);
    const statePath = await writeState(root, 'required.yml', {
      roots: [managedRoot],
      enabled: ['acme.owner'],
    });
    const manager = managedManager(statePath);

    await manager.load();
    assert.deepEqual(await markerLines(lifecyclePath), [
      'activate:acme.leaf',
      'activate:acme.middle',
      'activate:acme.owner',
    ]);
    await manager.close();
    assert.deepEqual(await markerLines(lifecyclePath), [
      'activate:acme.leaf',
      'activate:acme.middle',
      'activate:acme.owner',
      'close:acme.owner',
      'close:acme.middle',
      'close:acme.leaf',
    ]);
  });
});

test('a selected invalid transitive dependency is projected as failed status', async () => {
  await withTempDirectory(async root => {
    const managedRoot = join(root, 'managed');
    const ownerMarker = join(root, 'owner.txt');
    await Promise.all([
      writeManagedPlugin(managedRoot, 'owner', {
        id: 'acme.owner',
        name: 'Owner',
        version: '1.0.0',
        requires: { 'acme.broken': '^1.0.0' },
        markerPath: ownerMarker,
      }),
      writePluginFixture(managedRoot, 'broken', {
        manifest: buildManagedPluginManifestV1({
          id: 'acme.broken',
          name: 'Broken dependency',
          version: '1.0.0',
          entry: './missing.mjs',
        }),
      }),
    ]);
    const statePath = await writeState(root, 'broken-transitive.yml', {
      roots: [managedRoot],
      enabled: ['acme.owner'],
    });

    await assertManagedLoadFailure(
      statePath,
      'load',
      /entry module does not exist/,
      [ownerMarker],
      status => {
        const broken = status.plugins.find(plugin => plugin.id === 'acme.broken');
        assert.equal(broken?.enabled, true);
        assert.equal(broken?.state, 'failed');
        assert.ok(broken?.diagnostics.some(diagnostic =>
          diagnostic.code === 'managed-validation-failed'));
      },
    );
  });
});

test('optional dependencies do not auto-select but order activation when enabled', async () => {
  await withTempDirectory(async root => {
    const withoutRoot = join(root, 'without-optional');
    const withoutMarker = join(root, 'without-optional.txt');
    await writeOptionalSuite(withoutRoot, withoutMarker);
    const withoutState = await writeState(root, 'without-optional.yml', {
      roots: [withoutRoot],
      enabled: ['acme.optional-owner'],
    });
    const withoutManager = managedManager(withoutState);
    try {
      await withoutManager.load();
      assert.deepEqual(await markerLines(withoutMarker), ['activate:acme.optional-owner']);
      assert.equal(withoutManager.getTool('acme.optional'), undefined);
    } finally {
      await withoutManager.close();
    }

    const withRoot = join(root, 'with-optional');
    const withMarker = join(root, 'with-optional.txt');
    await writeOptionalSuite(withRoot, withMarker);
    const withState = await writeState(root, 'with-optional.yml', {
      roots: [withRoot],
      enabled: ['acme.optional-owner', 'acme.optional'],
    });
    const withManager = managedManager(withState);
    try {
      await withManager.load();
      assert.deepEqual(await markerLines(withMarker), [
        'activate:acme.optional',
        'activate:acme.optional-owner',
      ]);
    } finally {
      await withManager.close();
    }
  });
});

test('dependency and activation policy failures happen before every managed module import', async t => {
  const cases: readonly PolicyFailureCase[] = [
    {
      name: 'missing required dependency',
      enabled: ['acme.owner'],
      manifests: [{
        directory: 'owner', id: 'acme.owner', requires: { 'acme.missing': '^1.0.0' },
      }],
      errorKind: 'load',
      error: /requires missing plugin acme\.missing/,
    },
    {
      name: 'explicitly disabled required dependency',
      enabled: ['acme.owner'],
      disabled: ['acme.dependency'],
      manifests: [
        { directory: 'owner', id: 'acme.owner', requires: { 'acme.dependency': '^1.0.0' } },
        { directory: 'dependency', id: 'acme.dependency' },
      ],
      errorKind: 'load',
      error: /explicitly disabled plugin acme\.dependency/,
    },
    {
      name: 'incompatible dependency version',
      enabled: ['acme.owner'],
      manifests: [
        { directory: 'owner', id: 'acme.owner', requires: { 'acme.dependency': '^2.0.0' } },
        { directory: 'dependency', id: 'acme.dependency', version: '1.0.0' },
      ],
      errorKind: 'load',
      error: /found 1\.0\.0/,
    },
    {
      name: 'selected conflict',
      enabled: ['acme.left', 'acme.right'],
      manifests: [
        { directory: 'left', id: 'acme.left', conflicts: { 'acme.right': '*' } },
        { directory: 'right', id: 'acme.right' },
      ],
      errorKind: 'load',
      error: /conflicts with selected plugin acme\.right/,
    },
    {
      name: 'dependency cycle',
      enabled: ['cycle.left'],
      manifests: [
        { directory: 'left', id: 'cycle.left', requires: { 'cycle.right': '*' } },
        { directory: 'right', id: 'cycle.right', requires: { 'cycle.left': '*' } },
      ],
      errorKind: 'load',
      error: /dependency cycle/,
    },
    {
      name: 'unknown enabled id',
      enabled: ['acme.unknown'],
      manifests: [{ directory: 'available', id: 'acme.available' }],
      errorKind: 'configuration',
      error: /Unknown enabled managed plugin: acme\.unknown/,
    },
    {
      name: 'core plugin disable request',
      enabled: [],
      disabled: ['pixiecore.roles'],
      manifests: [{ directory: 'available', id: 'acme.available' }],
      errorKind: 'configuration',
      error: /Core plugin cannot be disabled: pixiecore\.roles/,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      await withTempDirectory(async root => {
        const managedRoot = join(root, 'managed');
        const markers: string[] = [];
        for (const manifest of fixture.manifests) {
          const markerPath = join(root, `${manifest.id.replaceAll('.', '-')}.txt`);
          markers.push(markerPath);
          await writeManagedPlugin(managedRoot, manifest.directory, {
            id: manifest.id,
            name: manifest.id,
            version: manifest.version ?? '1.0.0',
            ...(manifest.requires === undefined ? {} : { requires: manifest.requires }),
            ...(manifest.conflicts === undefined ? {} : { conflicts: manifest.conflicts }),
            markerPath,
          });
        }
        const statePath = await writeState(root, 'failure.yml', {
          roots: [managedRoot],
          enabled: fixture.enabled,
          ...(fixture.disabled === undefined ? {} : { disabled: fixture.disabled }),
        });

        await assertManagedLoadFailure(statePath, fixture.errorKind, fixture.error, markers);
      });
    });
  }
});

test('a stale unknown disabled id is retained as a nonfatal status diagnostic', async () => {
  await withTempDirectory(async root => {
    const managedRoot = join(root, 'managed');
    const markerPath = join(root, 'available.txt');
    await writeManagedPlugin(managedRoot, 'available', {
      id: 'acme.available', name: 'Available', version: '1.0.0', markerPath,
    });
    const statePath = await writeState(root, 'stale-disabled.yml', {
      roots: [managedRoot],
      disabled: ['acme.removed'],
    });
    const manager = managedManager(statePath);

    try {
      await manager.load();
      await assertNeverImported([markerPath]);
      const status = manager.getPluginStatus();
      assert.ok(status.diagnostics.some(diagnostic =>
        /acme\.removed/.test(diagnostic.message)
        && /disabled/i.test(diagnostic.message)));
      assert.equal(
        status.plugins.find(plugin => plugin.id === 'acme.available')?.state,
        'disabled',
      );
    } finally {
      await manager.close();
    }
  });
});

test('reserved identities, trust spoofing, and duplicate ids are fatal even when disabled', async t => {
  await t.test('reserved pixiecore identity', async () => {
    await withTempDirectory(async root => {
      const managedRoot = join(root, 'managed');
      const markerPath = join(root, 'reserved.txt');
      await writeManagedPlugin(managedRoot, 'reserved', {
        id: 'pixiecore.spoof', name: 'Spoof', version: '1.0.0', markerPath,
      });
      const statePath = await writeState(root, 'reserved.yml', {
        roots: [managedRoot], disabled: ['pixiecore.spoof'],
      });

      await assertManagedLoadFailure(
        statePath,
        'load',
        /reserved pixiecore namespace/,
        [markerPath],
        status => {
          const offender = status.plugins.find(plugin => plugin.id === 'pixiecore.spoof');
          assert.ok(offender?.diagnostics.some(diagnostic =>
            diagnostic.code === 'managed-manifest-reserved-id'));
          assert.ok(status.diagnostics.some(diagnostic =>
            diagnostic.code === 'managed-manifest-reserved-id'));
        },
      );
    });
  });

  await t.test('trusted field spoof', async () => {
    await withTempDirectory(async root => {
      const managedRoot = join(root, 'managed');
      const markerPath = join(root, 'trust.txt');
      await writePluginFixture(managedRoot, 'trust', {
        manifest: `${buildManagedPluginManifestV1({
          id: 'acme.trust', name: 'Trust', version: '1.0.0',
        })}locked: true\n`,
        module: importMarkedToolModule('acme.trust', markerPath),
      });
      const statePath = await writeState(root, 'trust.yml', {
        roots: [managedRoot], disabled: ['acme.trust'],
      });

      await assertManagedLoadFailure(
        statePath,
        'load',
        /trusted field locked/,
        [markerPath],
        status => {
          const offender = status.plugins.find(plugin => plugin.id === 'acme.trust');
          assert.ok(offender?.diagnostics.some(diagnostic =>
            diagnostic.code === 'managed-manifest-trust-field'));
          assert.ok(status.diagnostics.some(diagnostic =>
            diagnostic.code === 'managed-manifest-trust-field'));
        },
      );
    });
  });

  await t.test('duplicate managed identities', async () => {
    await withTempDirectory(async root => {
      const managedRoot = join(root, 'managed');
      const firstMarker = join(root, 'duplicate-first.txt');
      const secondMarker = join(root, 'duplicate-second.txt');
      await Promise.all([
        writeManagedPlugin(managedRoot, 'first', {
          id: 'acme.duplicate', name: 'First', version: '1.0.0', markerPath: firstMarker,
        }),
        writeManagedPlugin(managedRoot, 'second', {
          id: 'acme.duplicate', name: 'Second', version: '1.0.0', markerPath: secondMarker,
        }),
      ]);
      const statePath = await writeState(root, 'duplicate.yml', {
        roots: [managedRoot], disabled: ['acme.duplicate'],
      });

      await assertManagedLoadFailure(
        statePath,
        'load',
        /Duplicate managed plugin id:? acme\.duplicate/,
        [firstMarker, secondMarker],
        status => {
          const offenders = status.plugins.filter(plugin => plugin.id === 'acme.duplicate');
          assert.equal(offenders.length, 2);
          assert.ok(offenders.every(plugin => plugin.diagnostics.some(diagnostic =>
            diagnostic.code === 'duplicate-managed-plugin-id')));
          assert.ok(status.diagnostics.some(diagnostic =>
            diagnostic.code === 'duplicate-managed-plugin-id'));
        },
      );
    });
  });

  await t.test('duplicate malformed identities', async () => {
    await withTempDirectory(async root => {
      const managedRoot = join(root, 'managed');
      const firstMarker = join(root, 'invalid-duplicate-first.txt');
      const secondMarker = join(root, 'invalid-duplicate-second.txt');
      await Promise.all([
        writeManagedPlugin(managedRoot, 'first', {
          id: 'Bad.Id', name: 'Invalid first', version: '1.0.0', markerPath: firstMarker,
        }),
        writeManagedPlugin(managedRoot, 'second', {
          id: 'Bad.Id', name: 'Invalid second', version: '1.0.0', markerPath: secondMarker,
        }),
      ]);
      const statePath = await writeState(root, 'invalid-duplicate.yml', {
        roots: [managedRoot],
      });

      await assertManagedLoadFailure(
        statePath,
        'load',
        /Duplicate managed plugin id:? Bad\.Id/,
        [firstMarker, secondMarker],
        status => {
          const offenders = status.plugins.filter(plugin => plugin.id === 'Bad.Id');
          assert.equal(offenders.length, 2);
          assert.ok(offenders.every(plugin => plugin.diagnostics.some(diagnostic =>
            diagnostic.code === 'duplicate-managed-plugin-id')));
        },
      );
    });
  });
});

test('a managed root owned by legacy loading is loaded once as legacy with legacy precedence', async () => {
  await withTempDirectory(async root => {
    const overlapRoot = join(root, 'overlap');
    const laterLegacyRoot = join(root, 'later-legacy');
    const overlapMarker = join(root, 'overlap-imported.txt');
    const overlapPluginRoot = await writeManagedPlugin(overlapRoot, 'plugin', {
      id: 'acme.overlap',
      name: 'Overlap',
      version: '1.0.0',
      markerPath: overlapMarker,
      toolName: 'overlap-precedence',
      toolResult: 'overlap',
    });
    await writePluginFixture(laterLegacyRoot, 'override', {
      manifest: buildLegacyPluginManifest({ name: 'Legacy override' }),
      module: `
export default {
  tools: [{
    name: 'overlap-precedence',
    description: 'legacy override',
    parameters: { type: 'object' },
    execute() { return 'later legacy'; },
  }],
};
`,
    });
    const statePath = await writeState(root, 'overlap.yml', {
      roots: [overlapRoot],
    });
    const manager = new PluginManager(
      [overlapRoot, laterLegacyRoot],
      {},
      { pluginConfigPath: statePath },
    );

    try {
      await manager.load();
      assert.equal(await manager.getTool('overlap-precedence')?.execute({}), 'later legacy');
      assert.deepEqual(await markerLines(overlapMarker), ['activate:acme.overlap']);

      const manifestPath = join(overlapPluginRoot, 'plugin.yml');
      const matching = manager.getPluginStatus().plugins
        .filter(plugin => plugin.manifestPath === manifestPath);
      assert.equal(matching.length, 1);
      assert.equal(matching[0]?.origin, 'legacy');
      assert.equal(matching[0]?.state, 'activated');
    } finally {
      await manager.close();
    }
  });
});

interface FailureManifest {
  readonly directory: string;
  readonly id: string;
  readonly version?: string;
  readonly requires?: Readonly<Record<string, string>>;
  readonly conflicts?: Readonly<Record<string, string>>;
}

interface PolicyFailureCase {
  readonly name: string;
  readonly enabled: readonly string[];
  readonly disabled?: readonly string[];
  readonly manifests: readonly FailureManifest[];
  readonly errorKind: 'configuration' | 'load';
  readonly error: RegExp;
}

function managedManager(statePath: string): PluginManager {
  return new PluginManager(undefined, {}, { pluginConfigPath: statePath });
}

async function writeState(
  root: string,
  filename: string,
  options: Parameters<typeof buildManagedPluginStateV1>[0],
): Promise<string> {
  const path = join(root, filename);
  await writeFile(path, buildManagedPluginStateV1(options), 'utf8');
  return path;
}

async function writeManagedPlugin(
  root: string,
  directory: string,
  options: ManagedFixtureOptions,
): Promise<string> {
  return writePluginFixture(root, directory, {
    manifest: buildManagedPluginManifestV1(options),
    module: importMarkedToolModule(
      options.id,
      options.markerPath,
      options.toolName,
      options.toolResult,
      options.closeMarker,
    ),
  });
}

function importMarkedToolModule(
  id: string,
  markerPath: string,
  toolName = id,
  toolResult = id,
  closeMarker = false,
): string {
  return `
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(markerPath)}, ${JSON.stringify(`activate:${id}\n`)});
export default {
  tools: [{
    name: ${JSON.stringify(toolName)},
    description: ${JSON.stringify(id)},
    parameters: { type: 'object' },
    execute() { return ${JSON.stringify(toolResult)}; },
  }],
  ${closeMarker
    ? `close() { appendFileSync(${JSON.stringify(markerPath)}, ${JSON.stringify(`close:${id}\n`)}); },`
    : ''}
};
`;
}

async function writeOptionalSuite(root: string, markerPath: string): Promise<void> {
  await Promise.all([
    writeManagedPlugin(root, 'a-owner', {
      id: 'acme.optional-owner',
      name: 'Optional owner',
      version: '1.0.0',
      optionalRequires: { 'acme.optional': '^2.0.0' },
      markerPath,
    }),
    writeManagedPlugin(root, 'z-optional', {
      id: 'acme.optional',
      name: 'Optional dependency',
      version: '2.1.0',
      markerPath,
    }),
  ]);
}

async function assertManagedLoadFailure(
  statePath: string,
  errorKind: 'configuration' | 'load',
  message: RegExp,
  markers: readonly string[],
  inspectStatus?: (status: PluginStatusSnapshot) => void,
): Promise<void> {
  const manager = managedManager(statePath);
  try {
    await assert.rejects(
      manager.load(),
      error => error instanceof PluginLoadError
        && message.test(error.message)
        && (errorKind === 'load' || error.cause instanceof ConfigurationError),
    );
    inspectStatus?.(manager.getPluginStatus());
  } finally {
    await manager.close();
  }
  await assertNeverImported(markers);
}

async function assertNeverImported(markers: readonly string[]): Promise<void> {
  for (const marker of markers) {
    await assert.rejects(access(marker), (error: unknown) =>
      error instanceof Error
      && 'code' in error
      && error.code === 'ENOENT');
  }
}

async function markerLines(path: string): Promise<string[]> {
  return (await readFile(path, 'utf8')).trim().split('\n');
}

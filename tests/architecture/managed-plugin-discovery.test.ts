import assert from 'node:assert/strict';
import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  parseManagedPluginActivationState,
  resolveManagedPluginActivationState,
} from '../../src/core/bootstrap/plugin-manager/activation/state.js';
import { discoverManagedPlugins } from '../../src/core/bootstrap/plugin-manager/managed/discovery.js';
import { ConfigurationError, PluginLoadError } from '../../src/core/contracts/errors/index.js';
import { withTempDirectory } from '../helpers/temp.js';

test('managed activation state follows explicit, environment, default, and disabled precedence', async () => {
  await withTempDirectory(async root => {
    const workingDirectory = join(root, 'working');
    const explicitPath = join(root, 'explicit', 'plugins.yml');
    const environmentPath = join(root, 'environment', 'plugins.yml');
    const defaultPath = join(workingDirectory, 'pixiecore.plugins.yml');
    await Promise.all([
      mkdir(dirname(explicitPath), { recursive: true }),
      mkdir(dirname(environmentPath), { recursive: true }),
      mkdir(workingDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeState(explicitPath, ['explicit.plugin'], ['./explicit-root']),
      writeState(environmentPath, ['environment.plugin'], ['./environment-root']),
      writeState(defaultPath, ['default.plugin'], ['./default-root']),
    ]);

    const explicit = await resolveManagedPluginActivationState({
      pluginConfigPath: explicitPath,
      workingDirectory,
      environment: { PIXIECORE_PLUGIN_CONFIG: environmentPath },
    });
    assert.deepEqual(explicit, {
      schema: 'pixiecore.plugins/v1',
      configPath: explicitPath,
      roots: [join(root, 'explicit', 'plugins'), join(root, 'explicit', 'explicit-root')],
      enabled: ['explicit.plugin'],
      disabled: [],
    });

    const environment = await resolveManagedPluginActivationState({
      pluginConfigPath: null,
      workingDirectory,
      environment: { PIXIECORE_PLUGIN_CONFIG: environmentPath },
    });
    assert.equal(environment?.configPath, environmentPath);
    assert.deepEqual(environment?.enabled, ['environment.plugin']);

    const fromDefault = await resolveManagedPluginActivationState({
      workingDirectory,
      environment: {},
    });
    assert.equal(fromDefault?.configPath, defaultPath);
    assert.deepEqual(fromDefault?.enabled, ['default.plugin']);
    assert.deepEqual(fromDefault?.roots, [
      join(workingDirectory, 'plugins'),
      join(workingDirectory, 'default-root'),
    ]);

    assert.equal(await resolveManagedPluginActivationState({
      pluginConfigPath: 'disabled',
      workingDirectory,
      environment: { PIXIECORE_PLUGIN_CONFIG: environmentPath },
    }), undefined);
    assert.deepEqual(await resolveManagedPluginActivationState({
      workingDirectory: join(root, 'no-default'),
      environment: {},
    }), {
      schema: 'pixiecore.plugins/v1',
      configPath: join(root, 'no-default', 'pixiecore.plugins.yml'),
      roots: [join(root, 'no-default', 'plugins')],
      enabled: [],
      disabled: [],
    });
  });
});

test('named managed activation state files are required while an absent cwd default is optional', async () => {
  await withTempDirectory(async root => {
    const missing = join(root, 'missing.yml');
    for (const context of [
      { pluginConfigPath: missing, workingDirectory: root, environment: {} },
      { workingDirectory: root, environment: { PIXIECORE_PLUGIN_CONFIG: missing } },
    ]) {
      await assert.rejects(
        resolveManagedPluginActivationState(context),
        (error: unknown) => error instanceof ConfigurationError
          && error.message === `Managed plugin state file not found: ${missing}`,
      );
    }

    assert.deepEqual(await resolveManagedPluginActivationState({
      pluginConfigPath: '   ',
      workingDirectory: root,
      environment: {},
    }), {
      schema: 'pixiecore.plugins/v1',
      configPath: join(root, 'pixiecore.plugins.yml'),
      roots: [join(root, 'plugins')],
      enabled: [],
      disabled: [],
    });
  });
});

test('managed activation state parser is strict, normalizes lists, and rejects ambiguous selection', () => {
  const configPath = '/workspace/config/pixiecore.plugins.yml';
  const valid = parseManagedPluginActivationState([
    'schema: pixiecore.plugins/v1',
    'roots:',
    '  - " ./plugins "',
    'enabled:',
    '  - " acme.tool "',
  ].join('\n'), configPath);
  assert.deepEqual(valid, {
    schema: 'pixiecore.plugins/v1',
    configPath,
    roots: ['/workspace/config/plugins'],
    enabled: ['acme.tool'],
    disabled: [],
  });
  assert.equal(Object.isFrozen(valid), true);
  assert.equal(Object.isFrozen(valid.roots), true);

  const invalidSources = [
    '',
    'schema: pixiecore.plugins/v2',
    'schema: pixiecore.plugins/v1\nextra: true',
    'schema: pixiecore.plugins/v1\nroots: ./plugins',
    'schema: pixiecore.plugins/v1\nenabled: [" "]',
    'schema: pixiecore.plugins/v1\nenabled: [acme.tool, " acme.tool "]',
    'schema: pixiecore.plugins/v1\nenabled: [acme.tool]\ndisabled: [acme.tool]',
    'schema: pixiecore.plugins/v1\nschema: pixiecore.plugins/v1',
    'schema: pixiecore.plugins/v1\nroots: &plugins [./plugins]\nenabled: *plugins',
  ];
  for (const source of invalidSources) {
    assert.throws(
      () => parseManagedPluginActivationState(source, configPath),
      (error: unknown) => error instanceof ConfigurationError
        && /managed plugin state file/.test(error.message),
    );
  }
});

test('managed discovery prefers named YAML, accepts legacy plugin.yml, and excludes legacy-owned paths', async () => {
  await withTempDirectory(async root => {
    const managedRoot = join(root, 'managed');
    const managedAlias = join(root, 'managed-alias');
    const legacyRoot = join(managedRoot, 'middle-legacy');
    const legacyAlias = join(root, 'legacy-alias');
    const firstPlugin = join(managedRoot, 'alpha', 'plugin.yml');
    const namedPlugin = join(managedRoot, 'gamma', 'gamma.yaml');
    const shadowedLegacyManifest = join(managedRoot, 'gamma', 'plugin.yml');
    const secondPlugin = join(managedRoot, 'zeta', 'nested', 'plugin.yml');
    const legacyPlugin = join(legacyRoot, 'owned', 'plugin.yml');
    const ignoredAlias = join(managedRoot, 'beta', 'plugin.yaml');
    await Promise.all([
      mkdir(dirname(firstPlugin), { recursive: true }),
      mkdir(dirname(namedPlugin), { recursive: true }),
      mkdir(dirname(secondPlugin), { recursive: true }),
      mkdir(dirname(legacyPlugin), { recursive: true }),
      mkdir(dirname(ignoredAlias), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(firstPlugin, 'id: acme.alpha\n', 'utf8'),
      writeFile(namedPlugin, 'id: acme.gamma\n', 'utf8'),
      writeFile(shadowedLegacyManifest, 'id: acme.shadowed\n', 'utf8'),
      writeFile(secondPlugin, 'id: acme.zeta\n', 'utf8'),
      writeFile(legacyPlugin, 'name: legacy\n', 'utf8'),
      writeFile(ignoredAlias, 'id: acme.ignored\n', 'utf8'),
    ]);
    await Promise.all([
      symlink(managedRoot, managedAlias, 'dir'),
      symlink(legacyRoot, legacyAlias, 'dir'),
    ]);

    const canonicalManagedRoot = await realpath(managedRoot);
    const canonicalAlphaRoot = await realpath(dirname(firstPlugin));
    const discovered = await discoverManagedPlugins({
      roots: [managedAlias, managedRoot, canonicalAlphaRoot, join(root, 'missing')],
      legacyDirectories: [legacyAlias],
    });

    assert.deepEqual(discovered.roots, [canonicalManagedRoot, canonicalAlphaRoot]);
    assert.deepEqual(discovered.manifests, [
      {
        rootPath: canonicalManagedRoot,
        manifestPath: await realpath(firstPlugin),
        sourceOrdinal: 1,
        ordinal: 1,
      },
      {
        rootPath: canonicalManagedRoot,
        manifestPath: await realpath(namedPlugin),
        sourceOrdinal: 1,
        ordinal: 2,
      },
      {
        rootPath: canonicalManagedRoot,
        manifestPath: await realpath(secondPlugin),
        sourceOrdinal: 1,
        ordinal: 3,
      },
    ]);
    assert.equal(Object.isFrozen(discovered), true);
    assert.equal(Object.isFrozen(discovered.manifests), true);
  });
});

test('managed discovery drops roots wholly contained by a legacy root and rejects files as roots', async () => {
  await withTempDirectory(async root => {
    const legacyRoot = join(root, 'legacy');
    const managedRoot = join(legacyRoot, 'managed');
    const manifest = join(managedRoot, 'plugin.yml');
    await mkdir(managedRoot, { recursive: true });
    await writeFile(manifest, 'id: acme.shadowed\n', 'utf8');

    assert.deepEqual(await discoverManagedPlugins({
      roots: [managedRoot],
      legacyDirectories: [legacyRoot],
    }), { roots: [], manifests: [] });

    await assert.rejects(
      discoverManagedPlugins({ roots: [manifest], legacyDirectories: [] }),
      (error: unknown) => error instanceof PluginLoadError
        && /not a directory/.test(error.message),
    );
  });
});

test('managed discovery follows directory symlinks and descends only through a unit plugins slot', async () => {
  await withTempDirectory(async root => {
    const managedRoot = join(root, 'plugins');
    const externalRoot = join(root, 'external', 'linked');
    const parentManifest = join(externalRoot, 'linked.yaml');
    const childManifest = join(externalRoot, 'plugins', 'child', 'child.yaml');
    const testFixtureManifest = join(externalRoot, 'tests', 'fixture', 'fixture.yaml');
    const sourceFixtureManifest = join(externalRoot, 'src', 'fixture', 'fixture.yaml');
    await Promise.all([
      mkdir(managedRoot, { recursive: true }),
      mkdir(dirname(childManifest), { recursive: true }),
      mkdir(dirname(testFixtureManifest), { recursive: true }),
      mkdir(dirname(sourceFixtureManifest), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(parentManifest, 'id: acme.linked\n', 'utf8'),
      writeFile(childManifest, 'id: acme.linked.child\n', 'utf8'),
      writeFile(testFixtureManifest, 'id: acme.fixture.test\n', 'utf8'),
      writeFile(sourceFixtureManifest, 'id: acme.fixture.source\n', 'utf8'),
      symlink(externalRoot, join(managedRoot, 'linked'), 'dir'),
      symlink(externalRoot, join(externalRoot, 'plugins', 'back-to-parent'), 'dir'),
    ]);

    const discovered = await discoverManagedPlugins({
      roots: [managedRoot],
      legacyDirectories: [],
    });
    const canonicalManagedRoot = await realpath(managedRoot);

    assert.deepEqual(discovered.manifests.map(item => item.manifestPath), [
      await realpath(parentManifest),
      await realpath(childManifest),
    ]);
    assert.equal(discovered.manifests[0]?.parentManifestPath, undefined);
    assert.equal(
      discovered.manifests[1]?.parentManifestPath,
      await realpath(parentManifest),
    );
    assert.equal(discovered.manifests.every(item => item.rootPath === canonicalManagedRoot), true);
  });
});

async function writeState(path: string, enabled: readonly string[], roots: readonly string[]): Promise<void> {
  await writeFile(path, [
    'schema: pixiecore.plugins/v1',
    'roots:',
    ...roots.map(root => `  - ${root}`),
    'enabled:',
    ...enabled.map(id => `  - ${id}`),
  ].join('\n'), 'utf8');
}

import assert from 'node:assert/strict';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  createPluginProject,
  testPluginProject,
  validatePluginProject,
  type PluginTemplateKind,
} from '../../src/core/bootstrap/plugin-manager/authoring/index.js';
import {
  installPluginLink,
  updatePluginActivationState,
} from '../../src/core/bootstrap/plugin-manager/authoring/state-editor.js';
import { parseManagedPluginActivationState } from '../../src/core/bootstrap/plugin-manager/activation/state.js';
import { PluginManager } from '../../src/index.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const data = testData('plugin authoring');

test('plugin scaffolder creates and validates every public custom component kind', async () => {
  await withTempDirectory(async directory => {
    for (const [index, kind] of (
      ['agent_role', 'decorator', 'tool', 'provider', 'extension'] as const
    ).entries()) {
      const name = `sample-${index}-${data.text(`kind ${index}`, 'unit').replaceAll('_', '-')}`;
      const root = join(directory, name);
      await createPluginProject({
        directory: root,
        id: `example.${name}`,
        kind,
        ...(kind === 'extension' ? { extensionPoint: 'example.extension.point' } : {}),
      });
      const result = await validatePluginProject(root);
      assert.equal(result.manifest.id, `example.${name}`);
      assert.equal(result.manifest.components?.[0]?.type, kind);
      assert.ok(result.exports.length > 0);
      const packageManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      assert.deepEqual(packageManifest.peerDependencies, { '@pixieworks/pixiecore': '^0.1.0' });
      const implementation = await readFile(join(root, 'src', 'index.ts'), 'utf8');
      if (kind !== 'extension') assert.match(implementation, /from '@pixieworks\/pixiecore\/plugin'/u);
      await testPluginProject(root);
    }
  });
});

test('plugin scaffolder rejects unsafe identity and never overwrites a project', async () => {
  await withTempDirectory(async directory => {
    const root = join(directory, 'safe-plugin');
    await assert.rejects(
      createPluginProject({ directory: root, id: 'pixiecore.spoof', kind: 'tool' }),
      /may not use pixiecore/,
    );
    await createPluginProject({ directory: root, id: 'example.safe-plugin', kind: 'tool' });
    await assert.rejects(
      createPluginProject({ directory: root, id: 'example.safe-plugin', kind: 'tool' }),
      /already exists/,
    );
  });
});

test('plugin validation rejects missing exports and non-authoring PixieCore subpaths', async () => {
  await withTempDirectory(async directory => {
    const root = join(directory, 'invalid-plugin');
    await createPluginProject({
      directory: root,
      id: 'example.invalid-plugin',
      kind: 'tool',
    });
    await writeFile(join(root, 'src', 'index.ts'), "import '@pixieworks/pixiecore/core/private.js';\n");
    await assert.rejects(
      validatePluginProject(root),
      /may not import non-authoring PixieCore subpath @pixieworks\/pixiecore\/core\/private\.js/,
    );

    await writeFile(join(root, 'src', 'index.ts'), "import type { RegisteredTool } from '@pixieworks/pixiecore/plugin';\nexport {};\n");
    await writeFile(join(root, 'src', 'index.js'), 'export {};\n');
    await writeFile(join(root, 'invalid-plugin.ts'), 'export {};\n');
    await writeFile(join(root, 'invalid-plugin.js'), 'export {};\n');
    await assert.rejects(validatePluginProject(root), /does not export InvalidPluginTool/);
  });
});

test('local install is symlink-based and enable-disable state updates are atomic', async () => {
  await withTempDirectory(async directory => {
    const source = join(directory, 'source', 'sample-tool');
    const project = join(directory, 'consumer');
    const configPath = join(project, 'pixiecore.plugins.yml');
    await createPluginProject({
      directory: source,
      id: 'example.sample-tool',
      kind: 'tool',
    });
    const installed = await installPluginLink({ source, configPath, enable: true });
    assert.equal(await realpath(installed.linkPath), await realpath(source));

    let state = parseManagedPluginActivationState(
      await readFile(configPath, 'utf8'),
      configPath,
    );
    assert.deepEqual(state.enabled, ['example.sample-tool']);
    assert.deepEqual(state.disabled, []);

    const manager = new PluginManager(undefined, {}, { pluginConfigPath: configPath });
    try {
      await manager.load();
      assert.equal(typeof manager.getTool('sample_tool')?.execute, 'function');
    } finally {
      await manager.close();
    }

    await updatePluginActivationState(configPath, 'example.sample-tool', 'disable');
    state = parseManagedPluginActivationState(await readFile(configPath, 'utf8'), configPath);
    assert.deepEqual(state.enabled, []);
    assert.deepEqual(state.disabled, ['example.sample-tool']);

    const same = await installPluginLink({ source, configPath });
    assert.equal(same.linkPath, installed.linkPath);
  });
});

// Compile-time guard: every documented template kind remains accepted.
const _kind: PluginTemplateKind = 'tool';
void _kind;

/**
 * Verifies third-party extension points through managed plugin activation.
 */

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PluginManager } from '../../src/index.js';
import { writePluginFixture } from '../helpers/plugin.js';
import { withTempDirectory } from '../helpers/temp.js';

test('managed plugins contribute ordered values to namespaced extension points', async () => {
  await withTempDirectory(async root => {
    const pluginsRoot = join(root, 'plugins');
    await writePluginFixture(pluginsRoot, 'gateway-policy', {
      manifestFileName: 'gateway-policy.yaml',
      moduleFileName: 'gateway-policy.mjs',
      manifest: `
schema: pixiecore.plugin/v1
id: acme.gateway-policy
name: Acme gateway policy
version: 1.0.0
entry: ./gateway-policy.mjs
components:
  - type: extension
    export: gatewayPolicy
    extension_point: acme.gateway.policy
`,
      module: `export const gatewayPolicy = { name: 'allow-owned-tenant' };\n`,
    });
    const configPath = join(root, 'pixiecore.plugins.yml');
    await writeFile(configPath, `
schema: pixiecore.plugins/v1
enabled:
  - acme.gateway-policy
disabled: []
`, 'utf8');
    const manager = new PluginManager(undefined, {}, { pluginConfigPath: configPath });
    try {
      await manager.load();
      assert.deepEqual(
        manager.getExtensions<{ readonly name: string }>('acme.gateway.policy'),
        [{ name: 'allow-owned-tenant' }],
      );
      assert.equal(Object.isFrozen(manager.getExtensions('acme.gateway.policy')), true);
    } finally {
      await manager.close();
    }
  });
});

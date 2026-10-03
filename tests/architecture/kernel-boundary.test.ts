import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginManager as PublicPluginManager } from '../../src/index.js';
import { PluginHost } from '../../src/core/bootstrap/plugin-manager/manager.js';

test('bootstrap plugin host has no bundled plugin knowledge', async () => {
  const manager = new PluginHost(undefined, {}, {
    pluginConfigPath: 'disabled',
  });
  try {
    assert.deepEqual(manager.getPluginStatus().plugins, []);
    assert.deepEqual([...manager.agentRoles], []);
    assert.deepEqual([...manager.providers], []);
    assert.deepEqual([...manager.tools], []);
  } finally {
    await manager.close();
  }
});

test('public plugin manager applies the bundled standard Recipe', async () => {
  const manager = new PublicPluginManager(undefined, {}, {
    pluginConfigPath: 'disabled',
  });
  try {
    assert.equal(manager.getPluginStatus().plugins.length, 24);
    assert.ok(manager.getAgentRole('default'));
    assert.ok(manager.getProvider('openai'));
  } finally {
    await manager.close();
  }
});

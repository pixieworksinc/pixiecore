import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PluginManager } from '../../src/index.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const pluginConfigPath = join(projectRoot, 'examples', 'plugin-project', 'pixiecore.plugins.yml');

test('repository converter and classifier examples activate through managed policy', async () => {
  const manager = new PluginManager(undefined, {}, { pluginConfigPath });
  try {
    await manager.load();

    const converter = manager.getAgentRole('converter');
    const classifier = manager.getAgentRole('classifier');
    assert.ok(converter);
    assert.ok(classifier);

    const converterResult = await converter.apply('convert this', {} as never, {});
    const classifierResult = await classifier.apply('classify this', {} as never, {});
    assert.equal(converterResult.messages.at(-1)?.content, 'convert this');
    assert.equal(classifierResult.messages.at(-1)?.content, 'classify this');

    const status = new Map(
      manager.getPluginStatus().plugins.map(plugin => [plugin.id, plugin]),
    );
    assert.equal(status.get('example.converter')?.state, 'activated');
    assert.equal(status.get('example.classifier')?.state, 'activated');
  } finally {
    await manager.close();
  }
});

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PromptRuntime } from '../../../../index.js';
import { ScriptedProvider } from '../../../../../tests/helpers/fake-provider.js';
import { testData } from '../../../../../tests/helpers/test-data.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';

const data = testData('runtime integration');

test('runtime validates a Blueprint file and allows inputs without declarations', async () => {
  await withTempDirectory(async directory => {
    const name = data.person('input name');
    const result = data.text('result');
    const path = join(directory, 'blueprint.yaml');
    await writeFile(path, `
name: No placeholders
version: '1.0'
role: assistant
prompt: "{{ name }}"
output_schema: '{"type":"object","properties":{"result":{"type":"string"}},"required":["result"]}'
`, 'utf8');
    const provider = new ScriptedProvider([{ content: JSON.stringify({ result }) }]);
    const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' });
    try {
      assert.deepEqual(await runtime.execute(path, { name }), { result });
      const content = provider.calls[0]!.messages.at(-1)!.content;
      assert.ok(typeof content === 'string');
      assert.match(content, new RegExp(name));
    } finally { await runtime.close(); }
  });
});

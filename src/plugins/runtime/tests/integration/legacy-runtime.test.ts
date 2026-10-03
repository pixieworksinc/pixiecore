import test from 'node:test';
import assert from 'node:assert/strict';
import { PromptRuntime } from '../../../../index.js';
import { ScriptedProvider } from '../../../../../tests/helpers/fake-provider.js';
import { testData } from '../../../../../tests/helpers/test-data.js';

const data = testData('legacy runtime smoke');
const yaml = `
name: Greeting
version: '1.0'
role: assistant
input_placeholders:
  - name: name
    type: string
    required: true
prompt: Greet {name}
output_schema: |
  {"type":"object","properties":{"greeting":{"type":"string"}},"required":["greeting"]}
`;
test('executes inline YAML and validates structured output', async () => {
  const name = data.person('inline name');
  const greeting = `Hello ${name}`;
  const provider = new ScriptedProvider([{ content: JSON.stringify({ greeting }) }]); const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' });
  assert.deepEqual(await runtime.executeYaml(yaml, { name }), { greeting });
  const content = provider.calls[0]!.messages.at(-1)!.content;
  assert.ok(typeof content === 'string');
  assert.match(content, new RegExp(name)); await runtime.close();
});
test('executes a tool round before returning output', async () => {
  const name = data.person('tool name');
  const operand = data.integer('tool operand', 2, 100);
  const greeting = String(operand * 2);
  const provider = new ScriptedProvider([{ toolCalls: [{ id: '1', name: 'double', arguments: { n: operand } }] }, { content: JSON.stringify({ greeting }) }]);
  const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' }).registerTool({ name: 'double', description: 'Double', parameters: { type: 'object' }, execute: a => Number(a.n) * 2 });
  assert.deepEqual(await runtime.executeYaml(yaml, { name }), { greeting });
  const content = provider.calls[1]!.messages.at(-1)!.content;
  assert.ok(typeof content === 'string');
  assert.match(content, new RegExp(greeting)); await runtime.close();
});

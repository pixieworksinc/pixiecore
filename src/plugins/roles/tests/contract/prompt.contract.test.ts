import test from 'node:test';
import assert from 'node:assert/strict';
import { PromptRuntime } from '../../../../index.js';
import { ScriptedProvider } from '../../../../../tests/helpers/fake-provider.js';

test('prompt construction orders localization, examples, history, and current user input deterministically', async () => {
  const provider = new ScriptedProvider([{ content: '{"result":"ok"}' }]);
  const history = [
    { role: 'user' as const, content: 'Earlier question' },
    { role: 'assistant' as const, content: 'Earlier answer' },
  ];
  const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled', logToConsole: false });
  try {
    await runtime.executeYaml(`
name: Localized prompt
version: '1.0'
role: assistant
localization:
  language: '{language}'
  currency: USD
prompt: Answer {question}
examples:
  - input: { question: First example }
    output: { result: First answer }
  - input: { question: Second example }
    output: { result: Second answer }
output_schema: '{"type":"object","properties":{"result":{"type":"string"}},"required":["result"]}'
`, { language: 'ja', question: 'Current question' }, { messages: history });

    const messages = provider.calls[0]?.messages ?? [];
    assert.deepEqual(messages.map(message => message.role), [
      'system', 'system', 'user', 'user', 'user', 'assistant', 'user',
    ]);
    assert.match(String(messages[1]?.content), /language: ja/);
    assert.match(String(messages[1]?.content), /currency: USD/);
    assert.match(String(messages[2]?.content), /First example/);
    assert.match(String(messages[3]?.content), /Second example/);
    assert.equal(messages[4]?.content, 'Earlier question');
    assert.equal(messages[5]?.content, 'Earlier answer');
    assert.equal(messages[6]?.content, 'Answer Current question');
    assert.deepEqual(history, [
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: 'Earlier answer' },
    ]);
  } finally { await runtime.close(); }
});

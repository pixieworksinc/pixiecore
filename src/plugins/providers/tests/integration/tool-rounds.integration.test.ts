import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, PromptRuntime } from '../../../../index.js';
import type { ProviderName } from '../../../../index.js';
import { withEnvironment } from '../../../../../tests/helpers/environment.js';

interface HttpCall { url: string; body: Record<string, any> }

function sequenceFetch(responses: unknown[]): { fetcher: typeof globalThis.fetch; calls: HttpCall[] } {
  const calls: HttpCall[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof init?.body !== 'string') assert.fail('Expected a JSON string request body');
    calls.push({ url: input instanceof Request ? input.url : String(input), body: JSON.parse(init.body) as Record<string, any> });
    const response = responses.shift();
    if (response === undefined) return new Response('No scripted response', { status: 500 });
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetcher, calls };
}

const blueprint = `
name: HTTP tool round
version: '1.0'
role: assistant
prompt: Run the tools
output_schema: '{"type":"object","properties":{"result":{"type":"string"}},"required":["result"]}'
`;

test('OpenAI, Anthropic, and Gemini complete HTTP-mocked multi-tool rounds with one failed tool', async () => {
  const cases: Array<{
    name: ProviderName;
    env: Record<string, string | undefined>;
    responses: unknown[];
    assertSecondRequest(body: Record<string, any>): void;
  }> = [
    {
      name: 'openai',
      env: { OPENAI_API_KEY: 'test-key' },
      responses: [
        { choices: [{ message: { content: null, tool_calls: openAIToolCalls() } }] },
        { choices: [{ message: { content: '{"result":"openai"}' } }] },
      ],
      assertSecondRequest(body) {
        assert.equal(body.messages[2].tool_calls.length, 2);
        assert.equal(body.messages[3].tool_call_id, 'call_ok');
        assert.equal(body.messages[4].tool_call_id, 'call_fail');
        assert.match(body.messages[4].content, /boom/);
      },
    },
    {
      name: 'anthropic',
      env: { ANTHROPIC_API_KEY: 'test-key' },
      responses: [
        { content: anthropicToolCalls() },
        { content: [{ type: 'text', text: '{"result":"anthropic"}' }] },
      ],
      assertSecondRequest(body) {
        assert.equal(body.messages[1].content.filter((part: any) => part.type === 'tool_use').length, 2);
        assert.equal(body.messages[2].content[0].tool_use_id, 'call_ok');
        assert.equal(body.messages[2].content[1].tool_use_id, 'call_fail');
        assert.equal(body.messages[2].content[1].is_error, true);
      },
    },
    {
      name: 'gemini_native',
      env: { GEMINI_NATIVE_API_KEY: 'test-key' },
      responses: [
        { candidates: [{ content: { parts: geminiToolCalls() } }] },
        { candidates: [{ content: { parts: [{ text: '{"result":"gemini"}' }] } }] },
      ],
      assertSecondRequest(body) {
        assert.equal(body.contents[1].parts.filter((part: any) => part.functionCall).length, 2);
        assert.equal(body.contents[2].parts[0].functionResponse.id, 'call_ok');
        assert.equal(body.contents[2].parts[1].functionResponse.id, 'call_fail');
        assert.match(body.contents[2].parts[1].functionResponse.response.error, /boom/);
      },
    },
  ];

  for (const item of cases) {
    await withEnvironment(item.env, async () => {
      const http = sequenceFetch([...item.responses]);
      const provider = createProvider(item.name, { fetch: http.fetcher });
      const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' })
        .registerTool({ name: 'succeed', description: 'Succeed', parameters: { type: 'object' }, execute: () => ({ value: 1 }) })
        .registerTool({ name: 'fail', description: 'Fail', parameters: { type: 'object' }, execute: () => { throw new Error('boom'); } });
      try {
        assert.deepEqual(await runtime.executeYaml(blueprint), { result: item.name === 'gemini_native' ? 'gemini' : item.name });
        assert.equal(http.calls.length, 2);
        item.assertSecondRequest(http.calls[1]!.body);
      } finally { await runtime.close(); }
    });
  }
});

function openAIToolCalls(): unknown[] {
  return [
    { id: 'call_ok', type: 'function', function: { name: 'succeed', arguments: '{}' } },
    { id: 'call_fail', type: 'function', function: { name: 'fail', arguments: '{}' } },
  ];
}
function anthropicToolCalls(): unknown[] {
  return [
    { type: 'tool_use', id: 'call_ok', name: 'succeed', input: {} },
    { type: 'tool_use', id: 'call_fail', name: 'fail', input: {} },
  ];
}
function geminiToolCalls(): unknown[] {
  return [
    { functionCall: { id: 'call_ok', name: 'succeed', args: {} }, thoughtSignature: 'signature-ok' },
    { functionCall: { id: 'call_fail', name: 'fail', args: {} }, thoughtSignature: 'signature-fail' },
  ];
}

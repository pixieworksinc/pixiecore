import test from 'node:test';
import assert from 'node:assert/strict';
import { PromptRuntime, ToolExecutionError } from '../../../../index.js';
import { withEnvironment } from '../../../../../tests/helpers/environment.js';
import { ScriptedProvider } from '../../../../../tests/helpers/fake-provider.js';

const blueprint = `
name: Tool contract
version: '1.0'
role: assistant
prompt: Complete the task
output_schema: '{"type":"object","properties":{"result":{"type":"string"}},"required":["result"]}'
`;

test('standard tool rounds retain assistant calls and return every result, including failures', async () => {
  const provider = new ScriptedProvider([
    {
      content: '',
      toolCalls: [
        { id: 'call_double', name: 'double', arguments: { n: 2 } },
        { id: 'call_fail', name: 'explode', arguments: {} },
      ],
    },
    { content: '{"result":"done"}' },
  ]);
  const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' })
    .registerTool({ name: 'double', description: 'Double a number', parameters: { type: 'object' }, execute: args => Number(args.n) * 2 })
    .registerTool({ name: 'explode', description: 'Fail', parameters: { type: 'object' }, execute: () => { throw new Error('boom'); } });
  try {
    assert.deepEqual(await runtime.executeYaml(blueprint), { result: 'done' });
    const messages = provider.calls[1]!.messages;
    const assistant = messages.find(message => message.role === 'assistant' && message.toolCalls?.length);
    assert.deepEqual(assistant && assistant.role === 'assistant' ? assistant.toolCalls : undefined, [
      { id: 'call_double', name: 'double', arguments: { n: 2 } },
      { id: 'call_fail', name: 'explode', arguments: {} },
    ]);
    const results = messages.filter(message => message.role === 'tool');
    assert.equal(results.length, 2);
    assert.deepEqual(results[0], { role: 'tool', toolCallId: 'call_double', name: 'double', content: '4' });
    assert.equal(results[1]!.toolCallId, 'call_fail');
    assert.equal(results[1]!.isError, true);
    assert.match(results[1]!.content, /Error executing tool explode: .*boom/);
  } finally { await runtime.close(); }
});

test('pseudo tool calling embeds results in user messages', async () => {
  await withEnvironment({ PROMPT_RUNTIME_USE_PSEUDO_TOOL_CALLING: 'true' }, async () => {
    const provider = new ScriptedProvider([
      { toolCalls: [{ id: 'call_echo', name: 'echo', arguments: { value: 'tool result' } }] },
      { content: '{"result":"final"}' },
    ]);
    const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' })
      .registerTool({ name: 'echo', description: 'Echo', parameters: { type: 'object' }, execute: args => args.value });
    try {
      assert.deepEqual(await runtime.executeYaml(blueprint), { result: 'final' });
      const messages = provider.calls[1]!.messages;
      assert.equal(messages.some(message => message.role === 'tool'), false);
      const embedded = messages.find(message => message.role === 'user' && message.content === 'Tool echo returned: tool result');
      assert.ok(embedded);
    } finally { await runtime.close(); }
  });
});

test('per-call tool settings override runtime defaults', async () => {
  const provider = new ScriptedProvider([
    { toolCalls: [{ id: 'required', name: 'echo', arguments: {} }] },
    { content: '{"result":"required"}' },
    { content: '{"result":"none"}' },
    { toolCalls: [{ id: 'first', name: 'echo', arguments: {} }] },
    { toolCalls: [{ id: 'second', name: 'echo', arguments: {} }] },
  ]);
  const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled', toolChoice: 'required', maxToolRounds: 5 })
    .registerTool({ name: 'echo', description: 'Echo', parameters: { type: 'object' }, execute: () => 'ok' });
  try {
    assert.deepEqual(await runtime.executeYaml(blueprint), { result: 'required' });
    assert.deepEqual(await runtime.executeYaml(blueprint, {}, { toolChoice: 'none' }), { result: 'none' });
    assert.equal(provider.calls[0]!.toolChoice, 'required');
    assert.equal(provider.calls[1]!.toolChoice, 'auto');
    assert.equal(provider.calls[2]!.toolChoice, 'none');
    await assert.rejects(
      runtime.executeYaml(blueprint, {}, { maxToolRounds: 1 }),
      (error: unknown) => error instanceof ToolExecutionError && /\(1\)/.test(error.message),
    );
  } finally { await runtime.close(); }
});

test('required tool choice rejects a provider response without a tool call', async () => {
  const provider = new ScriptedProvider([{ content: '{"result":"not enough"}' }]);
  const runtime = new PromptRuntime({
    provider,
    mcpConfigPath: 'disabled',
    toolChoice: 'required',
  }).registerTool({
    name: 'echo',
    description: 'Echo',
    parameters: { type: 'object' },
    execute: () => 'ok',
  });
  try {
    await assert.rejects(
      runtime.executeYaml(blueprint),
      (error: unknown) => error instanceof ToolExecutionError
        && /returned no tool call/.test(error.message),
    );
    assert.equal(provider.calls.length, 1);
  } finally { await runtime.close(); }
});

test('required tool choice becomes auto after a failed tool execution and stays auto on validation retry', async () => {
  const provider = new ScriptedProvider([
    { toolCalls: [{ id: 'failed', name: 'explode', arguments: {} }] },
    { content: '{"result":1}' },
    { content: '{"result":"recovered"}' },
  ]);
  const runtime = new PromptRuntime({
    provider,
    mcpConfigPath: 'disabled',
    toolChoice: 'required',
  }).registerTool({
    name: 'explode',
    description: 'Fails',
    parameters: { type: 'object' },
    execute: () => { throw new Error('expected'); },
  });
  try {
    assert.deepEqual(await runtime.executeYaml(blueprint), { result: 'recovered' });
    assert.deepEqual(provider.calls.map(call => call.toolChoice), ['required', 'auto', 'auto']);
  } finally { await runtime.close(); }
});

test('required tool choice fails before generation when tools cannot run', async () => {
  const withoutTools = new ScriptedProvider([]);
  const noRounds = new ScriptedProvider([]);
  const first = new PromptRuntime({
    provider: withoutTools,
    mcpConfigPath: 'disabled',
    toolChoice: 'required',
  });
  const second = new PromptRuntime({
    provider: noRounds,
    mcpConfigPath: 'disabled',
    toolChoice: 'required',
    maxToolRounds: 0,
  }).registerTool({
    name: 'echo',
    description: 'Echo',
    parameters: { type: 'object' },
    execute: () => 'ok',
  });
  try {
    await assert.rejects(first.executeYaml(blueprint), /at least one available tool/);
    await assert.rejects(second.executeYaml(blueprint), /maxToolRounds greater than zero/);
    assert.equal(withoutTools.calls.length, 0);
    assert.equal(noRounds.calls.length, 0);
  } finally {
    await first.close();
    await second.close();
  }
});

test('an explicit standard mode overrides a pseudo-mode environment default', async () => {
  await withEnvironment({ PROMPT_RUNTIME_USE_PSEUDO_TOOL_CALLING: 'true' }, async () => {
    const provider = new ScriptedProvider([
      { toolCalls: [{ id: 'call_echo', name: 'echo', arguments: {} }] },
      { content: '{"result":"done"}' },
    ]);
    const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' })
      .registerTool({ name: 'echo', description: 'Echo', parameters: { type: 'object' }, execute: () => 'ok' });
    try {
      await runtime.executeYaml(blueprint, {}, { usePseudoToolCalling: false });
      assert.equal(provider.calls[1]!.messages.some(message => message.role === 'tool'), true);
    } finally { await runtime.close(); }
  });
});

test('sanitized provider names stay on the wire while original names route execution', async () => {
  let executed = false;
  const provider = new ScriptedProvider([
    request => ({ toolCalls: [{ id: 'call_mcp', name: request.tools![0]!.name, arguments: {} }] }),
    { content: '{"result":"done"}' },
  ]);
  const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' })
    .registerTool({
      name: 'mcp.server.echo',
      description: 'Echo through MCP',
      parameters: { type: 'object' },
      execute: () => { executed = true; return 'ok'; },
    });
  try {
    await runtime.executeYaml(blueprint);
    assert.equal(executed, true);
    const safeName = provider.calls[0]!.tools![0]!.name;
    assert.notEqual(safeName, 'mcp.server.echo');
    const assistant = provider.calls[1]!.messages.find(message => message.role === 'assistant' && message.toolCalls?.length);
    const result = provider.calls[1]!.messages.find(message => message.role === 'tool');
    assert.equal(assistant?.role === 'assistant' ? assistant.toolCalls?.[0]?.name : undefined, safeName);
    assert.equal(result?.role === 'tool' ? result.name : undefined, safeName);
  } finally { await runtime.close(); }
});

test('tool arguments are validated before execution without modifying caller data', async () => {
  let executions = 0;
  let received: Record<string, unknown> | undefined;
  const invalidArgs = { count: '2', unexpected: true };
  const provider = new ScriptedProvider([
    {
      toolCalls: [{
        id: 'invalid_arguments',
        name: 'typed',
        arguments: invalidArgs,
      }],
    },
    { content: '{"result":"recovered"}' },
  ]);
  const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' })
    .registerTool({
      name: 'typed',
      description: 'Requires an integer',
      parameters: {
        type: 'object',
        properties: { count: { type: 'integer', default: 1 } },
        required: ['count'],
        additionalProperties: false,
      },
      execute: args => {
        executions += 1;
        received = args;
        return 'should not run';
      },
    });
  try {
    assert.deepEqual(await runtime.executeYaml(blueprint), { result: 'recovered' });
    assert.equal(executions, 0);
    assert.equal(received, undefined);
    assert.deepEqual(provider.calls[0]!.messages.length > 0, true);
    const result = provider.calls[1]!.messages.find(message => message.role === 'tool');
    assert.equal(result?.role === 'tool' ? result.toolCallId : undefined, 'invalid_arguments');
    assert.equal(result?.role === 'tool' ? result.name : undefined, 'typed');
    assert.equal(result?.role === 'tool' ? result.isError : undefined, true);
    assert.match(result?.role === 'tool' ? result.content : '', /arguments do not match schema/);
    assert.deepEqual(invalidArgs, {
      count: '2',
      unexpected: true,
    });
  } finally { await runtime.close(); }
});

test('valid tool arguments reach the handler by identity', async () => {
  const args = { count: 2 };
  let received: Record<string, unknown> | undefined;
  const provider = new ScriptedProvider([
    { toolCalls: [{ id: 'valid_arguments', name: 'typed', arguments: args }] },
    { content: '{"result":"done"}' },
  ]);
  const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' })
    .registerTool({
      name: 'typed',
      description: 'Requires an integer',
      parameters: {
        type: 'object',
        properties: { count: { type: 'integer' } },
        required: ['count'],
        additionalProperties: false,
      },
      execute: receivedArgs => {
        received = receivedArgs;
        return receivedArgs.count;
      },
    });
  try {
    assert.deepEqual(await runtime.executeYaml(blueprint), { result: 'done' });
    assert.equal(received, args);
  } finally { await runtime.close(); }
});

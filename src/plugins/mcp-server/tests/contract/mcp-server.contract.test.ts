import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type {
  McpServerRuntimePort,
  PixieCoreMcpServer,
} from '../../../../core/contracts/mcp/server.js';
import type { ExecuteOptions } from '../../../../core/contracts/types/index.js';
import {
  createPixieCoreMcpServer,
  PIXIECORE_MCP_TOOL_NAMES,
} from '../../../../core/kernel/mcp-server/index.js';
import { testData } from '../../../../../tests/helpers/test-data.js';

const data = testData('MCP server contract');

test('MCP server lists and executes file and inline blueprint tools', async () => {
  const runtime = new RecordingRuntime();
  const server = createPixieCoreMcpServer({ runtime, environment: {} });
  const client = await connectClient(server);
  const path = `${data.text('blueprint path', 'blueprint')}.yaml`;
  const yaml = `name: ${data.text('inline blueprint name', 'blueprint')}`;
  const inputs = { subject: data.person('input subject') };
  const maxTokens = data.integer('max tokens', 32, 512);
  const maxToolRounds = data.integer('max tool rounds', 1, 8);

  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map(tool => tool.name),
      [PIXIECORE_MCP_TOOL_NAMES.execute, PIXIECORE_MCP_TOOL_NAMES.executeYaml],
    );

    const fileResult = await client.callTool({
      name: PIXIECORE_MCP_TOOL_NAMES.execute,
      arguments: {
        blueprint_path: path,
        inputs,
        options: {
          tool_choice: 'required',
          max_tool_rounds: maxToolRounds,
          use_pseudo_tool_calling: true,
          max_tokens: maxTokens,
        },
      },
    });
    assert.deepEqual(fileResult.structuredContent, runtime.result);
    assert.deepEqual(fileResult.content, [{
      type: 'text',
      text: JSON.stringify(runtime.result),
    }]);

    const yamlResult = await client.callTool({
      name: PIXIECORE_MCP_TOOL_NAMES.executeYaml,
      arguments: { blueprint_yaml: yaml, inputs },
    });
    assert.deepEqual(yamlResult.structuredContent, runtime.result);
    assert.deepEqual(runtime.calls.map(call => ({
      operation: call.operation,
      source: call.source,
      inputs: call.inputs,
      options: withoutSignal(call.options),
      aborted: call.options.signal?.aborted,
    })), [
      {
        operation: 'execute',
        source: path,
        inputs,
        options: {
          toolChoice: 'required',
          maxToolRounds,
          usePseudoToolCalling: true,
          maxTokens,
        },
        aborted: false,
      },
      {
        operation: 'executeYaml',
        source: yaml,
        inputs,
        options: {},
        aborted: false,
      },
    ]);
  } finally {
    await client.close();
    await server.close();
  }

  assert.equal(runtime.closeCount, 1);
});

test('MCP server rejects invalid tool arguments before invoking PixieCore', async () => {
  const runtime = new RecordingRuntime();
  const server = createPixieCoreMcpServer({ runtime, environment: {} });
  const client = await connectClient(server);

  try {
    const result = await client.callTool({
      name: PIXIECORE_MCP_TOOL_NAMES.execute,
      arguments: { blueprint_path: '' },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /Invalid arguments for tool execute/);
    assert.deepEqual(runtime.calls, []);
  } finally {
    await client.close();
    await server.close();
  }
});

interface RuntimeCall {
  readonly operation: 'execute' | 'executeYaml';
  readonly source: string;
  readonly inputs: Record<string, unknown>;
  readonly options: ExecuteOptions;
}

class RecordingRuntime implements McpServerRuntimePort {
  readonly calls: RuntimeCall[] = [];
  readonly result = { value: data.text('runtime result', 'result') };
  closeCount = 0;

  async execute(
    path: string,
    inputs: Record<string, unknown> = {},
    options: ExecuteOptions = {},
  ): Promise<Record<string, unknown>> {
    this.calls.push({ operation: 'execute', source: path, inputs, options });
    return this.result;
  }

  async executeYaml(
    yaml: string,
    inputs: Record<string, unknown> = {},
    options: ExecuteOptions = {},
  ): Promise<Record<string, unknown>> {
    this.calls.push({ operation: 'executeYaml', source: yaml, inputs, options });
    return this.result;
  }

  close(): void { this.closeCount++; }
}

async function connectClient(server: PixieCoreMcpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'pixiecore-test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function withoutSignal(options: ExecuteOptions): Omit<ExecuteOptions, 'signal'> {
  const { signal: _signal, ...rest } = options;
  return rest;
}

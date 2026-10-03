import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { PIXIECORE_MCP_TOOL_NAMES } from '../../../../core/kernel/mcp-server/index.js';
import { testCliNodeArguments } from '../../../../../tests/helpers/cli.js';
import { testData } from '../../../../../tests/helpers/test-data.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';

const data = testData('MCP server integration');

test('CLI stdio server executes a blueprint without corrupting protocol stdout', async () => {
  await withTempDirectory(async directory => {
    const pluginDirectory = join(directory, 'plugins', 'fixture');
    await mkdir(pluginDirectory, { recursive: true });
    await writeFile(join(pluginDirectory, 'plugin.yml'), `
name: MCP server fixture
module: ./provider.mjs
`, 'utf8');
    await writeFile(join(pluginDirectory, 'provider.mjs'), `
export default {
  providers: [{
    name: 'mcp_server_fixture', model: 'mcp-server-fixture-1', supportsTools: true, supportsMultimodal: true,
    supportsVision() { return true; }, supportsFileInput() { return true; },
    async getModelList() { return ['mcp-server-fixture-1']; },
    async generate(request) {
      const prompt = [...request.messages].reverse().find(message => message.role === 'user')?.content ?? '';
      return { content: JSON.stringify({ greeting: String(prompt) }) };
    },
  }],
};
`, 'utf8');

    const name = data.person('input name');
    const blueprint = `
name: MCP CLI
version: '1.0'
role: assistant
prompt: Hello {{ name }}
input_placeholders:
  - name: name
    type: string
    required: true
output_schema: '{"type":"object","properties":{"greeting":{"type":"string"}},"required":["greeting"]}'
`;
    const environment = stringEnvironment({
      ...process.env,
      PROMPT_RUNTIME_PROVIDER: 'mcp_server_fixture',
      PROMPT_RUNTIME_PLUGINS_DIR: join(directory, 'plugins'),
      PROMPT_RUNTIME_LOG_TO_FILE: 'false',
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: testCliNodeArguments(['mcp', 'serve']),
      cwd: resolve('.'),
      env: environment,
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', chunk => { stderr += String(chunk); });
    const client = new Client({ name: 'pixiecore-integration-test', version: '1.0.0' });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: PIXIECORE_MCP_TOOL_NAMES.executeYaml,
        arguments: { blueprint_yaml: blueprint, inputs: { name } },
      });
      assert.equal(result.isError, undefined);
      assert.deepEqual(result.structuredContent, { greeting: `Hello ${name}` });
    } finally {
      await client.close();
    }

    assert.equal(stderr, '');
  });
});

function stringEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment)
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

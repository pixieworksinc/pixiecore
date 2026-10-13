import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const cliPath = fileURLToPath(new URL('../../dist/core/kernel/cli/index.js', import.meta.url));
const client = new Client({ name: 'pixiecore-integration-example', version: '0.1.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [cliPath, 'mcp', 'serve'],
  cwd: projectRoot,
  env: stringEnvironment(process.env),
  stderr: 'inherit',
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  console.log(JSON.stringify({ tools: listed.tools.map(tool => tool.name) }, null, 2));

  if (process.env.PIXIECORE_EXAMPLE_EXECUTE === 'true') {
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        blueprint_path: 'examples/hello.yaml',
        inputs: { name: 'MCP client' },
      },
    });
    console.log(JSON.stringify(result.structuredContent ?? result.content, null, 2));
  }
} finally {
  await client.close();
}

function stringEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => (
      entry[1] !== undefined
    )),
  );
}

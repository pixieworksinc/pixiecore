import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = join(process.cwd(), 'examples', 'integrations');

test('MCP integration uses the official client and closes its child boundary', async () => {
  const source = await readFile(join(root, 'mcp-client.ts'), 'utf8');
  assert.match(source, /@modelcontextprotocol\/client/);
  assert.match(source, /client\.listTools\(\)/);
  assert.match(source, /client\.callTool\(/);
  assert.match(source, /finally \{/);
  assert.match(source, /await client\.close\(\)/);
});

test('LangChain integration stays dependency-isolated behind MCP', async () => {
  const source = await readFile(join(root, 'langchain', 'agent.mjs.example'), 'utf8');
  assert.match(source, /@langchain\/mcp-adapters/);
  assert.match(source, /MultiServerMCPClient/);
  assert.match(source, /args: \['--package', '@pixieworks\/pixiecore', 'pixiecore', 'mcp', 'serve'\]/u);
  assert.match(source, /client\.getTools\(\)/);
});

test('Drupal integration owns HTTP wiring without self-asserting caller identity', async () => {
  const moduleRoot = join(root, 'drupal', 'pixiecore_integration');
  const [info, services, source, ownedTest] = await Promise.all([
    readFile(join(moduleRoot, 'pixiecore_integration.info.yml'), 'utf8'),
    readFile(join(moduleRoot, 'pixiecore_integration.services.yml'), 'utf8'),
    readFile(join(moduleRoot, 'src', 'PixieCoreClient.php'), 'utf8'),
    readFile(join(moduleRoot, 'tests', 'src', 'Unit', 'PixieCoreClientTest.php'), 'utf8'),
  ]);
  assert.match(info, /core_version_requirement: \^10\.3 \|\| \^11/);
  assert.match(services, /@http_client/);
  assert.match(source, /'blueprint' => \$blueprintYaml/);
  assert.match(source, /'inputs' => \$inputs/);
  assert.doesNotMatch(source, /['"]user_(?:role|id|scopes)['"]\s*=>/);
  assert.match(ownedTest, /testExecuteSendsOnlyBlueprintAndBusinessInputs/);
});

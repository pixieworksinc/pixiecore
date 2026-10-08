import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { McpManager, McpToolError, PromptRuntime } from '../../../../index.js';
import { readPixieCoreVersion } from '../../../../core/component/package-root/index.js';
import { ScriptedProvider } from '../../../../../tests/helpers/fake-provider.js';
import { writeFakeMcpServer } from '../../../../../tests/helpers/fake-mcp-server.js';
import { testData } from '../../../../../tests/helpers/test-data.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';

const data = testData('MCP integration');

test('official MCP stdio client lazily aggregates tool pages, drains stderr, calls tools, and closes its child', async () => {
  await withTempDirectory(async root => {
    const pidFile = join(root, 'server.pid');
    const shutdownFile = join(root, 'server.closed');
    const clientInfoFile = join(root, 'client-info.json');
    const script = await writeFakeMcpServer(root, [
      { name: 'echo', description: 'Echo arguments' },
      { name: 'fail', result: 'expected failure', isError: true },
      { name: 'protocol_fail', protocolError: 'protocol failure' },
    ], { pageSize: 1, stderrBytes: 512 * 1024, pidFile, shutdownFile, clientInfoFile });
    const config = await writeConfig(root, {
      main: { command: process.execPath, args: [script], timeout_seconds: 2 },
    });
    const manager = await McpManager.fromConfigPath(config, { environment: process.env });
    let pid: number | undefined;
    try {
      assert.equal(manager.isLoaded, false);
      assert.equal(manager.connectionCount, 0);
      const echo = await manager.getTool('mcp.main.echo');
      assert.equal(echo?.description, 'Echo arguments');
      const tools = await manager.getTools();
      assert.deepEqual(JSON.parse(await readFile(clientInfoFile, 'utf8')), {
        name: 'pixiecore',
        version: readPixieCoreVersion(new URL('../../src/connection.ts', import.meta.url)),
      });
      assert.deepEqual(tools.map(tool => tool.name), [
        'mcp.main.echo',
        'mcp.main.fail',
        'mcp.main.protocol_fail',
      ]);
      assert.equal(manager.connectionCount, 1);
      pid = Number(await readFile(pidFile, 'utf8'));
      assert.deepEqual(manager.childProcessIds, [pid]);
      assert.equal(await echo?.execute({ value: 7 }), '{"value":7}');
      await assert.rejects(manager.callTool('mcp.main.fail', {}), (error: unknown) =>
        error instanceof McpToolError && /expected failure/.test(error.message));
      await assert.rejects(manager.callTool('mcp.main.protocol_fail', {}), (error: unknown) =>
        error instanceof McpToolError && /protocol failure/.test(error.message));
      await assert.rejects(manager.callTool('mcp.main.missing', {}), /Unknown MCP tool/);
      await manager.close();
      assert.equal(manager.connectionCount, 0);
      await waitForProcessExit(pid);
      assert.equal(await readFile(shutdownFile, 'utf8'), 'closed');
      await manager.close();
    } finally {
      await manager.close();
      if (pid !== undefined) await waitForProcessExit(pid);
    }
  });
});

test('one failed MCP server does not prevent other configured servers from loading', async () => {
  await withTempDirectory(async root => {
    const alpha = await writeFakeMcpServer(root, [{ name: 'alpha' }], { filename: 'alpha.mjs' });
    const beta = await writeFakeMcpServer(root, [{ name: 'beta' }], { filename: 'beta.mjs' });
    const exitingPidFile = join(root, 'exiting.pid');
    const exiting = await writeFakeMcpServer(root, [], { filename: 'exiting.mjs', exitOnInitialize: true, pidFile: exitingPidFile });
    const config = await writeConfig(root, {
      missing: { command: join(root, 'does-not-exist'), args: [], timeout_seconds: 0.2 },
      exiting: { command: process.execPath, args: [exiting], timeout_seconds: 2 },
      alpha: { command: process.execPath, args: [alpha], timeout_seconds: 2 },
      beta: { command: process.execPath, args: [beta], timeout_seconds: 2 },
    });
    const warnings: string[] = [];
    const manager = await McpManager.fromConfigPath(config, { onWarning: warning => warnings.push(warning) });
    try {
      const tools = await manager.getTools();
      assert.deepEqual(tools.map(tool => tool.name), ['mcp.alpha.alpha', 'mcp.beta.beta']);
      assert.equal(manager.connectionCount, 2);
      assert.equal(warnings.length, 2);
      assert.match(warnings[0]!, /MCP server "missing" was skipped/);
      assert.match(warnings[1]!, /MCP server "exiting" was skipped/);
      await waitForProcessExit(Number(await readFile(exitingPidFile, 'utf8')));
    } finally {
      const pids = [...manager.childProcessIds];
      await manager.close();
      await Promise.all(pids.map(waitForProcessExit));
    }
  });
});

test('an MCP initialization timeout is recoverable and reaps the partially started child', async () => {
  await withTempDirectory(async root => {
    const pidFile = join(root, 'hanging.pid');
    const script = await writeFakeMcpServer(root, [], { hangOnInitialize: true, pidFile });
    const config = await writeConfig(root, {
      hanging: { command: process.execPath, args: [script], timeout_seconds: 0.5 },
    });
    const warnings: string[] = [];
    const manager = await McpManager.fromConfigPath(config, { onWarning: warning => warnings.push(warning) });
    try {
      assert.deepEqual(await manager.getTools(), []);
      assert.equal(manager.connectionCount, 0);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /hanging/);
      await waitForFile(pidFile);
      const pid = Number(await readFile(pidFile, 'utf8'));
      await waitForProcessExit(pid);
    } finally { await manager.close(); }
  });
});

test('a malformed MCP response is isolated, sanitized, and does not hide a healthy server', async () => {
  await withTempDirectory(async root => {
    const secret = data.text('malformed response secret', 'secret');
    const malformedPidFile = join(root, 'malformed.pid');
    const healthyPidFile = join(root, 'healthy.pid');
    const malformed = await writeFakeMcpServer(root, [], {
      filename: 'malformed.mjs',
      malformedToolsResponse: `{not-json:${secret}`,
      pidFile: malformedPidFile,
    });
    const toolName = data.text('healthy tool name', 'healthy');
    const healthy = await writeFakeMcpServer(root, [{ name: toolName }], {
      filename: 'healthy.mjs',
      pidFile: healthyPidFile,
    });
    const config = await writeConfig(root, {
      malformed: { command: process.execPath, args: [malformed], timeout_seconds: 0.1 },
      healthy: { command: process.execPath, args: [healthy], timeout_seconds: 2 },
    });
    const warnings: string[] = [];
    const manager = await McpManager.fromConfigPath(config, { onWarning: warning => warnings.push(warning) });
    try {
      assert.deepEqual((await manager.getTools()).map(tool => tool.name), [`mcp.healthy.${toolName}`]);
      assert.equal(manager.connectionCount, 1);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /^\[PixieCore\] MCP server "malformed" was skipped:/);
      assert.doesNotMatch(warnings[0]!, new RegExp(secret));
      await waitForProcessExit(Number(await readFile(malformedPidFile, 'utf8')));
    } finally {
      const healthyPid = Number(await readFile(healthyPidFile, 'utf8'));
      await manager.close();
      await waitForProcessExit(healthyPid);
    }
  });
});

test('duplicate tool names collapse deterministically to the first advertised definition', async () => {
  await withTempDirectory(async root => {
    const toolName = data.text('duplicate tool name', 'duplicate');
    const firstResult = data.text('duplicate first result');
    const finalResult = data.text('duplicate final result');
    const script = await writeFakeMcpServer(root, [
      { name: toolName, description: 'first definition', result: firstResult },
      { name: toolName, description: 'final definition', result: finalResult },
    ]);
    const config = await writeConfig(root, {
      duplicate: { command: process.execPath, args: [script], timeout_seconds: 2 },
    });
    const manager = await McpManager.fromConfigPath(config);
    try {
      const tools = await manager.getTools();
      assert.equal(tools.length, 1);
      assert.equal(tools[0]?.name, `mcp.duplicate.${toolName}`);
      assert.equal(tools[0]?.description, 'first definition');
      assert.equal(await tools[0]?.execute({}), JSON.stringify(firstResult));
    } finally {
      const pids = [...manager.childProcessIds];
      await manager.close();
      await Promise.all(pids.map(waitForProcessExit));
    }
  });
});

test('close during MCP initialization aborts and reaps the child, then remains idempotent', async () => {
  await withTempDirectory(async root => {
    const pidFile = join(root, 'closing.pid');
    const initializeFile = join(root, 'closing.initialized');
    const script = await writeFakeMcpServer(root, [], {
      hangOnInitialize: true,
      pidFile,
      initializeFile,
    });
    const config = await writeConfig(root, {
      closing: { command: process.execPath, args: [script], timeout_seconds: 2 },
    });
    const manager = await McpManager.fromConfigPath(config);
    const loading = manager.getTools();
    await waitForFile(initializeFile);
    const pid = Number(await readFile(pidFile, 'utf8'));

    await Promise.all([manager.close(), manager.close()]);
    assert.deepEqual(await loading, []);
    assert.equal(manager.connectionCount, 0);
    await waitForProcessExit(pid);
    await manager.close();
    await assert.rejects(manager.load(), /MCP manager is closed/);
    await assert.rejects(manager.getTools(), /MCP manager is closed/);
    await assert.rejects(manager.callTool('mcp.closing.missing', {}), /MCP manager is closed/);
  });
});

test('MCP tool failures become recoverable tool results in PromptRuntime rounds', async () => {
  await withTempDirectory(async root => {
    const script = await writeFakeMcpServer(root, [
      { name: 'fail', result: 'remote boom', isError: true },
    ]);
    const config = await writeConfig(root, {
      remote: { command: process.execPath, args: [script], timeout_seconds: 2 },
    });
    const provider = new ScriptedProvider([
      { toolCalls: [{ id: 'mcp-call', name: 'mcp.remote.fail', arguments: {} }] },
      { content: '{"result":"recovered"}' },
    ]);
    const runtime = new PromptRuntime({ provider, mcpConfigPath: config });
    try {
      assert.deepEqual(await runtime.executeYaml(BLUEPRINT), { result: 'recovered' });
      const toolMessage = provider.calls[1]!.messages.find(message => message.role === 'tool');
      assert.equal(toolMessage?.role, 'tool');
      if (toolMessage?.role !== 'tool') assert.fail('Expected an MCP tool result message');
      assert.equal(toolMessage.isError, true);
      assert.match(toolMessage.content, /remote boom/);
    } finally {
      const pids = [...runtime.mcpManager.childProcessIds];
      await runtime.close();
      await Promise.all(pids.map(waitForProcessExit));
    }
  });
});

test('a broken explicit MCP server cannot crash ordinary PromptRuntime execution', async () => {
  await withTempDirectory(async root => {
    const config = await writeConfig(root, {
      broken: { command: join(root, 'missing-command'), args: [], timeout_seconds: 0.1 },
    });
    const provider = new ScriptedProvider([{ content: '{"result":"ok"}' }]);
    const runtime = new PromptRuntime({ provider, mcpConfigPath: config });
    try {
      assert.deepEqual(await runtime.executeYaml(BLUEPRINT), { result: 'ok' });
    } finally { await runtime.close(); }
  });
});

const BLUEPRINT = `
name: MCP integration
version: '1.0'
role: assistant
prompt: Complete the request
output_schema: '{"type":"object","properties":{"result":{"type":"string"}},"required":["result"]}'
`;

async function writeConfig(root: string, mcpServers: Record<string, unknown>): Promise<string> {
  const path = join(root, 'mcp.json');
  await writeFile(path, JSON.stringify({ mcpServers }), 'utf8');
  return path;
}

async function waitForProcessExit(pid: number, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid)) {
    if (Date.now() >= deadline) assert.fail(`MCP child process ${pid} did not exit`);
    await delay(20);
  }
}

async function waitForFile(path: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await readFile(path, 'utf8');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (Date.now() >= deadline) assert.fail(`Timed out waiting for ${path}`);
    await delay(20);
  }
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

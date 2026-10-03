import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { McpConfigError, McpManager } from '../../../../index.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';

const server = (label: string) => ({ command: process.execPath, args: ['-e', `/* ${label} */`] });

test('MCP config factories validate without starting a server', async () => {
  await withTempDirectory(async root => {
    const path = join(root, 'mcp.json');
    await writeJson(path, { mcpServers: { sample: server('sample') } });
    const manager = await McpManager.fromConfigPath(path, { environment: {} });
    try {
      assert.equal(manager.isLoaded, false);
      assert.equal(manager.connectionCount, 0);
      assert.deepEqual(manager.config.mcpServers.sample, server('sample'));
      assert.deepEqual(manager.configPaths, [path]);
    } finally { await manager.close(); }
  });
});

test('MCP config rejects malformed public fields with stable errors', async () => {
  await withTempDirectory(async root => {
    const cases: Array<[string, unknown, RegExp]> = [
      ['root', [], /must be a JSON object/],
      ['servers', { mcpServers: 'invalid' }, /mcpServers must be a JSON object/],
      ['command', { mcpServers: { bad: { args: [] } } }, /command is required/],
      ['args-required', { mcpServers: { bad: { command: 'node' } } }, /args must be a list/],
      ['args-type', { mcpServers: { bad: { command: 'node', args: '--help' } } }, /args must be a list/],
      ['args-item', { mcpServers: { bad: { command: 'node', args: [1] } } }, /only strings/],
      ['env', { mcpServers: { bad: { command: 'node', args: [], env: { TOKEN: 1 } } } }, /env must be a string map/],
      ['cwd', { mcpServers: { bad: { command: 'node', args: [], cwd: '' } } }, /cwd must be a non-empty string/],
      ['timeout', { mcpServers: { bad: { command: 'node', args: [], timeout_seconds: 0 } } }, /timeout_seconds must be a positive number/],
    ];
    for (const [name, value, pattern] of cases) {
      const path = join(root, `${name}.json`);
      await writeJson(path, value);
      await assert.rejects(
        McpManager.fromConfigPath(path, { environment: {} }),
        (error: unknown) => error instanceof McpConfigError && error.code === 'mcp_config_error' && pattern.test(error.message),
      );
    }
  });
});

test('multiple MCP configs merge in order, expand env, and resolve relative cwd from the winning file', async () => {
  await withTempDirectory(async root => {
    const firstDir = join(root, 'first');
    const secondDir = join(root, 'second');
    await Promise.all([mkdir(firstDir), mkdir(secondDir)]);
    const first = join(firstDir, 'mcp.json');
    const second = join(secondDir, 'mcp.json');
    await writeJson(first, {
      mcpServers: {
        shared: { ...server('first'), env: { TOKEN: '${MCP_TOKEN}' } },
        firstOnly: server('first-only'),
      },
    });
    await writeJson(second, {
      mcpServers: {
        shared: { ...server('second'), cwd: './workspace', env: { TOKEN: '${MCP_TOKEN}', UNKNOWN: '${NOT_SET}' } },
        secondOnly: server('second-only'),
      },
    });
    const manager = await McpManager.fromConfigPaths([first, second], {
      environment: { MCP_TOKEN: 'expanded-secret' },
    });
    try {
      assert.deepEqual(Object.keys(manager.config.mcpServers), ['shared', 'firstOnly', 'secondOnly']);
      assert.deepEqual(manager.config.mcpServers.shared?.args, server('second').args);
      assert.equal(manager.config.mcpServers.shared?.cwd, resolve(secondDir, 'workspace'));
      assert.deepEqual(manager.config.mcpServers.shared?.env, {
        TOKEN: 'expanded-secret',
        UNKNOWN: '${NOT_SET}',
      });
      assert.deepEqual(manager.configPaths, [first, second]);
      assert.equal(manager.connectionCount, 0);
    } finally { await manager.close(); }
  });
});

test('MCP auto-discovery uses explicit, environment, cwd, then package-root precedence', async () => {
  await withTempDirectory(async root => {
    const cwd = join(root, 'project');
    const packageRoot = join(root, 'package');
    const explicit = join(root, 'explicit.json');
    const environment = join(root, 'environment.json');
    await Promise.all([mkdir(cwd), mkdir(packageRoot)]);
    await writeJson(join(cwd, 'mcp.json'), { mcpServers: { cwd: server('cwd') } });
    await writeJson(join(packageRoot, 'mcp.json'), { mcpServers: { package: server('package') } });
    await writeJson(explicit, { mcpServers: { explicit: server('explicit') } });
    await writeJson(environment, { mcpServers: { environment: server('environment') } });

    const explicitManager = await McpManager.fromAutoDiscovery(explicit, {
      cwd, packageRoot, environment: { MCP_CONFIG_PATH: environment },
    });
    const environmentManager = await McpManager.fromAutoDiscovery(undefined, {
      cwd, packageRoot, environment: { MCP_CONFIG_PATH: environment },
    });
    const cwdManager = await McpManager.fromAutoDiscovery(undefined, { cwd, packageRoot, environment: {} });
    const packageManager = await McpManager.fromAutoDiscovery(undefined, {
      cwd: join(root, 'empty'), packageRoot, environment: {},
    });
    try {
      assert.deepEqual(Object.keys(explicitManager.config.mcpServers), ['explicit']);
      assert.deepEqual(Object.keys(environmentManager.config.mcpServers), ['environment']);
      assert.deepEqual(Object.keys(cwdManager.config.mcpServers), ['cwd']);
      assert.deepEqual(Object.keys(packageManager.config.mcpServers), ['package']);
    } finally {
      await Promise.all([
        explicitManager.close(), environmentManager.close(), cwdManager.close(), packageManager.close(),
      ]);
    }
  });
});

test('environment config paths merge and runtime loading degrades safely when config is absent or invalid', async () => {
  await withTempDirectory(async root => {
    const first = join(root, 'first.json');
    const second = join(root, 'second.json');
    const invalid = join(root, 'invalid.json');
    await writeJson(first, { mcpServers: { shared: server('first') } });
    await writeJson(second, { mcpServers: { shared: server('second'), extra: server('extra') } });
    await writeFile(invalid, '{', 'utf8');

    const discovered = await McpManager.fromAutoDiscovery(undefined, {
      cwd: root,
      packageRoot: join(root, 'none'),
      environment: { MCP_CONFIG_PATH: `${first}${process.platform === 'win32' ? ';' : ':'}${second}` },
    });
    const warnings: string[] = [];
    const absent = new McpManager({ cwd: join(root, 'missing'), packageRoot: join(root, 'none'), environment: {}, onWarning: warning => warnings.push(warning) });
    const malformed = new McpManager({ environment: {}, onWarning: warning => warnings.push(warning) });
    try {
      assert.deepEqual(discovered.config.mcpServers.shared?.args, server('second').args);
      assert.ok(discovered.config.mcpServers.extra);
      assert.deepEqual(await absent.load(), []);
      assert.deepEqual(await malformed.load(invalid), []);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /^\[PixieCore\] MCP configuration was ignored:/);
      await assert.rejects(
        McpManager.fromAutoDiscovery(undefined, { cwd: join(root, 'missing'), packageRoot: join(root, 'none'), environment: {} }),
        /No MCP configuration file was found/,
      );
    } finally {
      await Promise.all([discovered.close(), absent.close(), malformed.close()]);
    }
  });
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value), 'utf8');
}

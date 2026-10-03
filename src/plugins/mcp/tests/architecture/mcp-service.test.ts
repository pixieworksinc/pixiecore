import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { McpManagerPort } from '../../../../core/contracts/mcp/index.js';
import { McpManager as InternalMcpManager } from '../../../../plugins/mcp/src/mcp-manager.js';
import { createMcpService } from '../../../../plugins/mcp/src/service.js';
import { McpManager as PublicMcpManager } from '../../../../index.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';

test('MCP compatibility facade preserves the concrete class and static factory identity', async () => {
  assert.equal(PublicMcpManager, InternalMcpManager);
  assert.equal(PublicMcpManager.name, 'McpManager');
  assert.equal(PublicMcpManager.length, 0);

  await withTempDirectory(async root => {
    const path = join(root, 'mcp.json');
    await writeFile(path, JSON.stringify({ mcpServers: {} }), 'utf8');
    const manager = await PublicMcpManager.fromConfigPath(path, { environment: {} });
    try {
      assert.ok(manager instanceof InternalMcpManager);
      assert.deepEqual(manager.configPaths, [path]);
    } finally {
      await manager.close();
    }
  });
});

test('standalone MCP construction retains lazy owning-package fallback', async () => {
  await withTempDirectory(async cwd => {
    const warnings: string[] = [];
    const manager = new PublicMcpManager({
      cwd,
      environment: {},
      onWarning: warning => warnings.push(warning),
    });
    try {
      assert.deepEqual(await manager.load(), []);
      assert.deepEqual(manager.configPaths, []);
      assert.deepEqual(warnings, []);
    } finally {
      await manager.close();
    }
  });
});

test('MCP service injects package-root discovery lazily after higher-precedence sources', async () => {
  await withTempDirectory(async root => {
    const empty = join(root, 'empty');
    const cwd = join(root, 'cwd');
    const packageRoot = join(root, 'package');
    const explicit = join(root, 'explicit.json');
    const environment = join(root, 'environment.json');
    await Promise.all([mkdir(empty), mkdir(cwd), mkdir(packageRoot)]);
    await Promise.all([
      writeFile(explicit, JSON.stringify({ mcpServers: {} }), 'utf8'),
      writeFile(environment, JSON.stringify({ mcpServers: {} }), 'utf8'),
      writeFile(join(cwd, 'mcp.json'), JSON.stringify({ mcpServers: {} }), 'utf8'),
      writeFile(join(packageRoot, 'mcp.json'), JSON.stringify({ mcpServers: {} }), 'utf8'),
    ]);

    let packageRootResolutions = 0;
    const service = createMcpService(() => {
      packageRootResolutions += 1;
      return packageRoot;
    });
    const managers: McpManagerPort[] = [];
    try {
      const disabled = service.createManager({ cwd: empty, environment: {} });
      managers.push(disabled);
      assert.ok(disabled instanceof PublicMcpManager);
      assert.deepEqual(await disabled.load('disabled'), []);
      assert.equal(packageRootResolutions, 0);

      const explicitManager = service.createManager({
        cwd,
        environment: { MCP_CONFIG_PATH: environment },
      });
      managers.push(explicitManager);
      await explicitManager.load(explicit);
      assert.deepEqual(explicitManager.configPaths, [explicit]);
      assert.equal(packageRootResolutions, 0);

      const environmentManager = service.createManager({
        cwd,
        environment: { MCP_CONFIG_PATH: environment },
      });
      managers.push(environmentManager);
      await environmentManager.load();
      assert.deepEqual(environmentManager.configPaths, [environment]);
      assert.equal(packageRootResolutions, 0);

      const cwdManager = service.createManager({ cwd, environment: {} });
      managers.push(cwdManager);
      await cwdManager.load();
      assert.deepEqual(cwdManager.configPaths, [join(cwd, 'mcp.json')]);
      assert.equal(packageRootResolutions, 0);

      const packageManager = service.createManager({ cwd: empty, environment: {} });
      managers.push(packageManager);
      await packageManager.load();
      assert.deepEqual(packageManager.configPaths, [join(packageRoot, 'mcp.json')]);
      assert.equal(packageRootResolutions, 1);
    } finally {
      await Promise.all(managers.map(manager => manager.close()));
    }
  });
});

/**
 * Coordinates mcp server responsibilities inside the PixieCore kernel.
 */

import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import {
  activateCorePluginRoots,
  PluginManager,
  resolvePluginService,
} from '../plugin/manager.js';
import type {
  McpServerCompositionPort,
  PixieCoreMcpServer,
  PixieCoreMcpServerOptions,
} from '../../contracts/mcp/server.js';
import { MCP_SERVER_SERVICE } from '../../contracts/plugin/services.js';
import { errorMessage } from '../../component/diagnostics/index.js';
import { getRuntimeEnvironment } from '../config/index.js';
import { PromptRuntime } from '../runtime/index.js';

export type {
  McpServerCompositionPort,
  McpServerRuntimePort,
  PixieCoreMcpServer,
  PixieCoreMcpServerOptions,
} from '../../contracts/mcp/server.js';
export {
  PIXIECORE_MCP_SERVER_INFO,
  PIXIECORE_MCP_TOOL_NAMES,
} from '../../../plugins/mcp-server/mcp-server.js';

/** Public synchronous MCP server facade backed by one plugin-manager scope. */
export function createPixieCoreMcpServer(
  options: PixieCoreMcpServerOptions = {},
): PixieCoreMcpServer {
  const { runtime: injectedRuntime, ...runtimeOptions } = options;
  const environment = getRuntimeEnvironment(options.environment);
  const runtime = injectedRuntime
    ?? new PromptRuntime({ ...runtimeOptions, environment });
  const runtimeOwnsBootstrap = runtime instanceof PromptRuntime;
  const pluginManager = runtimeOwnsBootstrap
    ? runtime.pluginManager
    : new PluginManager(options.pluginsDir, environment, options);

  activateCorePluginRoots(pluginManager, 'pixiecore.mcp-server');
  const service = resolvePluginService(pluginManager, MCP_SERVER_SERVICE);
  const composition: McpServerCompositionPort = {
    runtime,
    ...(runtimeOwnsBootstrap
      ? {}
      : { closeBootstrap: () => pluginManager.close() }),
  };
  return service.createServer(composition);
}

/** Starts a local stdio MCP server. stdout remains reserved for MCP frames. */
export function servePixieCoreMcpStdio(
  options: PixieCoreMcpServerOptions = {},
): StdioServerHandle {
  const stdioOptions = options.runtime
    ? options
    : { ...options, logToConsole: false };
  return serveStdio(
    () => createPixieCoreMcpServer(stdioOptions),
    { onerror: error => { console.error(`PixieCore MCP: ${errorMessage(error)}`); } },
  );
}

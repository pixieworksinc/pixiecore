/**
 * Implements connection behavior for the mcp plugin.
 */

import { Client, type CallToolResult, type Tool } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { errorMessage } from '../../../core/component/diagnostics/index.js';
import { readPixieCoreVersion } from '../../../core/component/package-root/index.js';
import { McpConnectionError, McpToolError } from '../../../core/contracts/errors/index.js';
import type { McpServerConfig } from '../../../core/contracts/mcp/index.js';

const DEFAULT_TIMEOUT_SECONDS = 30;
const CLIENT_INFO = {
  name: 'pixiecore',
  version: readPixieCoreVersion(import.meta.url),
} as const;

/**
 * Encapsulates mcp connection behavior and lifecycle.
 */
export class McpConnection {
  readonly client = new Client(CLIENT_INFO, { listMaxPages: 64 });
  readonly transport: StdioClientTransport;
  private closed = false;

  /**
   * Creates a McpConnection and establishes its initial state.
   */
  constructor(
    readonly serverName: string,
    private readonly config: McpServerConfig,
    inheritedEnvironment: Record<string, string>,
    private readonly signal: AbortSignal,
  ) {
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...inheritedEnvironment, ...config.env },
      stderr: 'pipe',
      ...(config.cwd ? { cwd: config.cwd } : {}),
    });
    // MCP servers may write arbitrarily much diagnostic output. Always consume
    // it, but do not forward it because it can contain credentials or payloads.
    this.transport.stderr?.on('data', () => undefined);
  }

  /**
   * Returns pid from the McpConnection state.
   */
  get pid(): number | null { return this.transport.pid; }

  /**
   * Connects and discovers and list tools according to the McpConnection contract.
   */
  async connectAndListTools(): Promise<Tool[]> {
    const requestOptions = this.requestOptions();
    try {
      await this.client.connect(this.transport, requestOptions);
      const result = await this.client.listTools(undefined, requestOptions);
      return result.tools;
    } catch (error) {
      await this.closeSuppressingErrors();
      throw new McpConnectionError(
        `MCP server "${this.serverName}" could not be initialized: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Calls tool according to the McpConnection contract.
   */
  async callTool(tool: Tool, args: Record<string, unknown>): Promise<unknown> {
    try {
      const result = await this.client.callTool(
        { name: tool.name, arguments: args },
        { ...this.requestOptions(), toolDefinition: tool },
      );
      if (result.isError) {
        throw new McpToolError(
          `MCP tool "mcp.${this.serverName}.${tool.name}" failed: ${resultErrorMessage(result)}`,
        );
      }
      return resultValue(result);
    } catch (error) {
      if (error instanceof McpToolError) throw error;
      throw new McpToolError(
        `MCP tool "mcp.${this.serverName}.${tool.name}" failed: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Releases resources owned by the McpConnection.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.client.close();
    } finally {
      // connect() may fail after spawning but before Client owns the transport.
      await this.transport.close();
    }
  }

  /**
   * Requests options according to the McpConnection contract.
   */
  private requestOptions(): { signal: AbortSignal; timeout: number; maxTotalTimeout: number } {
    const timeout = (this.config.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
    return { signal: this.signal, timeout, maxTotalTimeout: timeout };
  }

  /**
   * Releases resources owned by the McpConnection.
   */
  private async closeSuppressingErrors(): Promise<void> {
    try { await this.close(); }
    catch { /* preserve the startup error */ }
  }
}

function resultValue(result: CallToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  if (result.content.length === 1 && result.content[0]?.type === 'text') return result.content[0].text;
  return result.content;
}

function resultErrorMessage(result: CallToolResult): string {
  const text = result.content
    .filter((item): item is Extract<typeof item, { type: 'text' }> => item.type === 'text')
    .map(item => item.text)
    .join('\n');
  return text || 'the server returned an error result';
}

/**
 * Defines server contracts shared across PixieCore boundaries.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { ExecuteOptions, RuntimeOptions } from '../types/index.js';

/** Runtime capabilities exposed through PixieCore's MCP server tools. */
export interface McpServerRuntimePort {
  /**
   * Executes the requested operation through its public boundary.
   */
  execute(
    path: string,
    inputs?: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<Record<string, unknown>>;
  /**
   * Executes yaml through its public boundary.
   */
  executeYaml(
    yaml: string,
    inputs?: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<Record<string, unknown>>;
  /**
   * Releases resources owned by the implementation.
   */
  close(): void | Promise<void>;
}

/**
 * Configures type core mcp server behavior.
 */
export interface PixieCoreMcpServerOptions extends RuntimeOptions {
  /** Uses an application-owned runtime instead of constructing PromptRuntime. */
  runtime?: McpServerRuntimePort;
}

/** Composition supplied by the public facade after selecting one runtime scope. */
export interface McpServerCompositionPort {
  readonly runtime: McpServerRuntimePort;
  /** Present only when the selected runtime does not own the bootstrap scope. */
  readonly closeBootstrap?: () => void | Promise<void>;
}

/** MCP server with explicit ownership of its PixieCore resources. */
export interface PixieCoreMcpServer extends McpServer {
  readonly runtime: McpServerRuntimePort;
  /**
   * Closes resources for the owning PixieCore boundary.
   */
  closeResources(): Promise<void>;
}

/** Stateless MCP server factory registered by the MCP server core plugin. */
export interface McpServerServicePort {
  /**
   * Creates server after validating the supplied contract.
   */
  createServer(composition: McpServerCompositionPort): PixieCoreMcpServer;
}

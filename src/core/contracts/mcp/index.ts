/**
 * Defines mcp contracts shared across PixieCore boundaries.
 */

import type { RegisteredTool } from '../types/index.js';

/** Configuration contracts for the MCP core plugin and runtime facade. */
export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout_seconds?: number;
}

/**
 * Describes the mcp config contract.
 */
export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

/**
 * Configures mcp manager behavior.
 */
export interface McpManagerOptions {
  /** Directory used for relative explicit paths and current-directory discovery. */
  cwd?: string;
  /** Runtime package root used as the final auto-discovery location. */
  packageRoot?: string;
  /** Environment used for config-path discovery, expansion, and child processes. */
  environment?: NodeJS.ProcessEnv;
  /** Receives sanitized recoverable-error messages. Defaults to console.warn. */
  onWarning?: (message: string) => void;
}

/** Runtime-facing MCP manager capabilities independent of its implementation class. */
export interface McpManagerPort extends AsyncDisposable {
  readonly config: McpConfig;
  readonly configPaths: readonly string[];
  readonly isLoaded: boolean;
  readonly connectionCount: number;
  readonly childProcessIds: readonly number[];
  /**
   * Returns the requested operation without exposing mutable internal state.
   */
  load(configPath?: string | 'disabled' | null): Promise<RegisteredTool[]>;
  /**
   * Returns tools without exposing mutable internal state.
   */
  getTools(): Promise<RegisteredTool[]>;
  /**
   * Returns tool without exposing mutable internal state.
   */
  getTool(name: string): Promise<RegisteredTool | undefined>;
  /**
   * Calls tool for the owning PixieCore boundary.
   */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /**
   * Releases resources owned by the implementation.
   */
  close(): Promise<void>;
}

/** Scope-local factory registered by the MCP core plugin. */
export interface McpServicePort {
  /**
   * Creates manager after validating the supplied contract.
   */
  createManager(options?: McpManagerOptions): McpManagerPort;
}

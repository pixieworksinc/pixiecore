/**
 * Implements mcp manager behavior for the mcp plugin.
 */

import { resolve } from 'node:path';
import { errorMessage } from '../../../core/component/diagnostics/index.js';
import {
  OwningPackageRootError,
  resolveOwningPackageRoot,
} from '../../../core/component/package-root/index.js';
import {
  ConfigurationError,
  McpConfigError,
  McpConnectionError,
  McpToolError,
} from '../../../core/contracts/errors/index.js';
import type {
  McpConfig,
  McpManagerOptions,
  McpManagerPort,
  McpServerConfig,
} from '../../../core/contracts/mcp/index.js';
import type { PackageRootResolver } from '../../../core/contracts/plugin/services.js';
import type { RegisteredTool } from '../../../core/contracts/types/index.js';
import { cloneMcpConfig, loadMcpConfigs, stringEnvironment } from './config.js';
import { McpConnection } from './connection.js';
import { discoverMcpConfigPaths } from './discovery.js';
import { createMcpToolRegistrations, type McpToolBinding } from './tool-binding.js';

/**
 * Discovers and exposes stdio MCP tools. Configuration factories are strict;
 * load() is the runtime-facing, recoverable entry point.
 */
const PIXIECORE_PACKAGE_NAME = '@pixieworks/pixiecore';
const MCP_MANAGER_DEPENDENCIES = Symbol('pixiecore.mcp-manager.dependencies');

interface McpManagerDependencies {
  readonly resolvePackageRoot: PackageRootResolver;
}

type InternalMcpManagerOptions = McpManagerOptions & {
  readonly [MCP_MANAGER_DEPENDENCIES]?: McpManagerDependencies;
};

/** Internal service seam that leaves the public constructor signature unchanged. */
export function createMcpManager(
  options: McpManagerOptions,
  resolvePackageRoot: PackageRootResolver,
): McpManager {
  return new McpManager({
    ...options,
    [MCP_MANAGER_DEPENDENCIES]: { resolvePackageRoot },
  } as McpManagerOptions);
}

/**
 * Discovers MCP configuration, lazily connects servers, binds advertised tools,
 * and owns connection and child-process cleanup for one runtime scope.
 */
export class McpManager implements McpManagerPort {
  private readonly workingDirectory: string;
  private readonly packageRoot: string | undefined;
  private readonly resolvePackageRoot: PackageRootResolver;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly inheritedEnvironment: Record<string, string>;
  private readonly warn: (message: string) => void;
  private readonly shutdown = new AbortController();
  private readonly connections = new Map<string, McpConnection>();
  private readonly bindings = new Map<string, McpToolBinding>();
  private configValue: McpConfig = { mcpServers: {} };
  private sourcePathsValue: string[] = [];
  private configured = false;
  private disabled = false;
  private toolsPromise?: Promise<RegisteredTool[]>;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private closeFinished = false;

  /** Initializes an unconfigured manager from an isolated environment snapshot. */
  constructor(options: McpManagerOptions = {}) {
    const dependencies = (options as InternalMcpManagerOptions)[MCP_MANAGER_DEPENDENCIES];
    this.workingDirectory = resolve(options.cwd ?? process.cwd());
    this.packageRoot = options.packageRoot === undefined ? undefined : resolve(options.packageRoot);
    this.resolvePackageRoot = dependencies?.resolvePackageRoot ?? resolveStandalonePackageRoot;
    this.environment = { ...(options.environment ?? process.env) };
    this.inheritedEnvironment = stringEnvironment(this.environment);
    this.warn = options.onWarning ?? (message => console.warn(message));
  }

  /** Validated, merged configuration. Later config paths override earlier ones. */
  get config(): McpConfig { return cloneMcpConfig(this.configValue); }
  /** Returns defensive copies of the configuration files merged by the manager. */
  get configPaths(): readonly string[] { return [...this.sourcePathsValue]; }
  /** Reports whether lazy tool loading has started. */
  get isLoaded(): boolean { return this.toolsPromise !== undefined; }
  /**
   * Returns connection count from the McpManager state.
   */
  get connectionCount(): number { return this.connections.size; }
  /**
   * Returns child process ids from the McpManager state.
   */
  get childProcessIds(): readonly number[] {
    return [...this.connections.values()]
      .map(connection => connection.pid)
      .filter((pid): pid is number => pid !== null);
  }

  /** Creates and configures a manager from one explicit path. */
  static async fromConfigPath(path: string, options: McpManagerOptions = {}): Promise<McpManager> {
    return this.fromConfigPaths([path], options);
  }

  /** Creates and configures a manager by merging paths in caller order. */
  static async fromConfigPaths(paths: readonly string[], options: McpManagerOptions = {}): Promise<McpManager> {
    if (paths.length === 0) throw new McpConfigError('At least one MCP config path is required');
    const manager = new McpManager(options);
    await manager.configureFromPaths(paths);
    return manager;
  }

  /** Creates a manager from the first applicable explicit or discovered paths. */
  static async fromAutoDiscovery(explicitPath?: string | null, options: McpManagerOptions = {}): Promise<McpManager> {
    const manager = new McpManager(options);
    const paths = await manager.discoverConfigPaths(explicitPath);
    if (paths.length === 0) throw new McpConfigError('No MCP configuration file was found');
    await manager.configureFromPaths(paths);
    return manager;
  }

  /**
   * Runtime-facing entry point. Missing auto-discovery config and malformed or
   * unavailable servers degrade to an empty/partial tool set.
   */
  async load(configPath?: string | 'disabled' | null): Promise<RegisteredTool[]> {
    this.assertOpen();
    if (!this.configured) return this.loadUnconfigured(configPath);
    if (this.disabled) return [];
    return this.getTools();
  }

  /** Connects configured servers on first use and caches the resulting tools. */
  async getTools(): Promise<RegisteredTool[]> {
    this.assertOpen();
    if (!this.configured) return this.load();
    if (this.disabled) return [];
    return this.toolsPromise ??= this.connectConfiguredServers();
  }

  /** Looks up one registered tool, triggering lazy discovery when necessary. */
  async getTool(name: string): Promise<RegisteredTool | undefined> {
    return (await this.getTools()).find(tool => tool.name === name);
  }

  /** Invokes one bound MCP tool after lazy discovery and duplicate resolution. */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.assertOpen();
    await this.getTools();
    const binding = this.bindings.get(name);
    if (!binding) throw new McpToolError(`Unknown MCP tool: ${name}`);
    return binding.connection.callTool(binding.tool, args);
  }

  /**
   * Releases resources owned by the McpManager.
   */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.closeFinished) return Promise.resolve();
    this.closed = true;
    this.shutdown.abort();
    const closing = this.closeConnections();
    this.closePromise = closing;
    void closing.then(
      () => { this.closeFinished = true; this.closePromise = undefined; },
      () => { this.closeFinished = true; this.closePromise = undefined; },
    );
    return closing;
  }

  /**
   * Releases resources owned by the McpManager.
   */
  private async closeConnections(): Promise<void> {
    await this.toolsPromise?.catch(() => undefined);
    const connections = [...this.connections.values()];
    this.connections.clear();
    this.bindings.clear();
    const results = await Promise.allSettled(connections.map(connection => connection.close()));
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Failed to close one or more MCP connections');
  }

  /**
   * Releases resources through the asynchronous disposal hook.
   */
  async [Symbol.asyncDispose](): Promise<void> { await this.close(); }

  /** Converts absent or invalid optional configuration into an empty tool set. */
  private async loadUnconfigured(configPath?: string | 'disabled' | null): Promise<RegisteredTool[]> {
    if (configPath === 'disabled') {
      this.configured = true;
      this.disabled = true;
      return [];
    }
    try {
      const paths = await this.discoverConfigPaths(configPath);
      if (paths.length === 0) {
        this.configured = true;
        return [];
      }
      await this.configureFromPaths(paths);
      return this.getTools();
    } catch (error) {
      this.configured = true;
      this.configValue = { mcpServers: {} };
      this.sourcePathsValue = [];
      this.warn(`[PixieCore] MCP configuration was ignored: ${errorMessage(error)}`);
      return [];
    }
  }

  /** Loads and freezes the ordered configuration paths exactly once. */
  private async configureFromPaths(paths: readonly string[]): Promise<void> {
    this.assertOpen();
    if (this.configured) throw new McpConfigError('MCP manager is already configured');
    const loaded = await loadMcpConfigs(paths, this.workingDirectory, this.environment);
    this.configValue = loaded.config;
    this.sourcePathsValue = loaded.paths;
    this.configured = true;
  }

  /**
   * Resolves config paths without mutating caller-owned input.
   */
  private discoverConfigPaths(explicitPath?: string | null): Promise<string[]> {
    return discoverMcpConfigPaths(explicitPath, {
      workingDirectory: this.workingDirectory,
      environment: this.environment,
      resolvePackageRoot: this.resolvePackageRoot,
      ...(this.packageRoot === undefined ? {} : { packageRoot: this.packageRoot }),
    });
  }

  /** Connects configured servers, keeping the first definition of duplicate tools. */
  private async connectConfiguredServers(): Promise<RegisteredTool[]> {
    const registered = new Map<string, RegisteredTool>();
    for (const [serverName, serverConfig] of Object.entries(this.configValue.mcpServers)) {
      if (this.closed) break;
      const connection = this.createConnection(serverName, serverConfig);
      try {
        const tools = await connection.connectAndListTools();
        if (this.closed) {
          await connection.close();
          break;
        }
        this.connections.set(serverName, connection);
        for (const registration of createMcpToolRegistrations(
          serverName,
          connection,
          tools,
          (name, args) => this.callTool(name, args),
        )) {
          // A tool call contains only its name, so duplicate advertisements
          // cannot be routed to distinct implementations. Keep the first
          // definition to make listed metadata match the server's call target.
          if (registered.has(registration.name)) continue;
          this.bindings.set(registration.name, registration.binding);
          registered.set(registration.name, registration.definition);
        }
      } catch (error) {
        try { await connection.close(); }
        catch { /* connection already reported the primary failure */ }
        if (!this.closed) {
          this.warn(`[PixieCore] MCP server "${serverName}" was skipped: ${errorMessage(error)}`);
        }
      }
    }
    return [...registered.values()];
  }

  /**
   * Creates connection according to the McpManager contract.
   */
  private createConnection(serverName: string, config: McpServerConfig): McpConnection {
    return new McpConnection(serverName, config, this.inheritedEnvironment, this.shutdown.signal);
  }

  /**
   * Validates open and rejects unsupported state.
   */
  private assertOpen(): void {
    if (this.closed) throw new McpConnectionError('MCP manager is closed');
  }
}

function resolveStandalonePackageRoot(): string {
  try {
    return resolveOwningPackageRoot(import.meta.url, PIXIECORE_PACKAGE_NAME);
  } catch (cause) {
    if (!(cause instanceof OwningPackageRootError)) throw cause;
    throw packageRootConfigurationError(cause);
  }
}

function packageRootConfigurationError(error: OwningPackageRootError): ConfigurationError {
  if (error.failure === 'unexpected-package') {
    return new ConfigurationError(
      `Expected owning package "${PIXIECORE_PACKAGE_NAME}" but found "${error.actualName}" at ${error.path}`,
    );
  }
  if (error.failure === 'missing-package') {
    return new ConfigurationError(
      `Could not find the owning PixieCore package from ${error.path}`,
    );
  }
  const action = error.failure === 'read-manifest' ? 'Failed to read' : 'Invalid';
  return new ConfigurationError(`${action} PixieCore package manifest: ${error.path}`, {
    cause: error.cause,
  });
}

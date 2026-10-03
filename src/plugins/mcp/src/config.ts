/**
 * Implements config behavior for the mcp plugin.
 */

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { errorMessage } from '../../../core/component/diagnostics/index.js';
import { McpConfigError } from '../../../core/contracts/errors/index.js';
import type { McpConfig, McpServerConfig } from '../../../core/contracts/mcp/index.js';

/**
 * Describes the loaded mcp config contract.
 */
export interface LoadedMcpConfig {
  readonly config: McpConfig;
  readonly paths: string[];
}

/**
 * Returns mcp configs without exposing mutable internal state.
 */
export async function loadMcpConfigs(
  candidates: readonly string[],
  workingDirectory: string,
  environment: NodeJS.ProcessEnv,
): Promise<LoadedMcpConfig> {
  const merged: Record<string, McpServerConfig> = {};
  const paths: string[] = [];
  for (const candidate of candidates) {
    const path = resolveConfigPath(candidate, workingDirectory);
    const config = await readMcpConfig(path, environment);
    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      merged[serverName] = serverConfig;
    }
    if (!paths.includes(path)) paths.push(path);
  }
  return { config: { mcpServers: merged }, paths };
}

/**
 * Clones MCP config for the owning PixieCore boundary.
 */
export function cloneMcpConfig(config: McpConfig): McpConfig {
  return {
    mcpServers: Object.fromEntries(Object.entries(config.mcpServers).map(([name, server]) => [name, {
      command: server.command,
      args: [...server.args],
      ...(server.env ? { env: { ...server.env } } : {}),
      ...(server.cwd ? { cwd: server.cwd } : {}),
      ...(server.timeout_seconds !== undefined ? { timeout_seconds: server.timeout_seconds } : {}),
    }])),
  };
}

/**
 * Handles string environment for the owning PixieCore boundary.
 */
export function stringEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function resolveConfigPath(candidate: string, workingDirectory: string): string {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new McpConfigError('MCP config paths must be non-empty strings');
  }
  return isAbsolute(candidate) ? resolve(candidate) : resolve(workingDirectory, candidate);
}

async function readMcpConfig(path: string, environment: NodeJS.ProcessEnv): Promise<McpConfig> {
  let source: string;
  try { source = await readFile(path, 'utf8'); }
  catch (error) {
    throw new McpConfigError(`Could not read MCP config "${path}": ${errorMessage(error)}`, { cause: error });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(source); }
  catch (error) {
    throw new McpConfigError(`MCP config "${path}" is not valid JSON: ${errorMessage(error)}`, { cause: error });
  }
  return validateMcpConfig(parsed, path, environment);
}

function validateMcpConfig(value: unknown, path: string, environment: NodeJS.ProcessEnv): McpConfig {
  if (!isRecord(value)) throw new McpConfigError(`MCP config "${path}" must be a JSON object`);
  const servers = value.mcpServers;
  if (servers === undefined) return { mcpServers: {} };
  if (!isRecord(servers)) throw new McpConfigError('mcpServers must be a JSON object');
  const result: Record<string, McpServerConfig> = {};
  for (const [serverName, raw] of Object.entries(servers)) {
    if (!serverName.trim()) throw new McpConfigError('MCP server names must not be empty');
    if (!isRecord(raw)) throw new McpConfigError(`MCP server "${serverName}" must be a JSON object`);
    result[serverName] = validateServerConfig(raw, serverName, path, environment);
  }
  return { mcpServers: result };
}

function validateServerConfig(
  value: Record<string, unknown>,
  serverName: string,
  configPath: string,
  environment: NodeJS.ProcessEnv,
): McpServerConfig {
  const command = value.command;
  if (typeof command !== 'string' || !command.trim()) {
    throw new McpConfigError(`command is required for MCP server "${serverName}"`);
  }
  const args = value.args;
  if (!Array.isArray(args)) throw new McpConfigError(`args must be a list for MCP server "${serverName}"`);
  if (!args.every(argument => typeof argument === 'string')) {
    throw new McpConfigError(`args must contain only strings for MCP server "${serverName}"`);
  }
  const stringArgs = args.filter((argument): argument is string => typeof argument === 'string');
  const env = serverEnvironment(value.env, serverName, environment);
  const cwd = serverWorkingDirectory(value.cwd, serverName, configPath);
  const timeoutSeconds = serverTimeout(value.timeout_seconds, serverName);
  return {
    command,
    args: stringArgs,
    ...(env ? { env } : {}),
    ...(cwd ? { cwd } : {}),
    ...(timeoutSeconds !== undefined ? { timeout_seconds: timeoutSeconds } : {}),
  };
}

function serverEnvironment(
  value: unknown,
  serverName: string,
  environment: NodeJS.ProcessEnv,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new McpConfigError(`env must be a string map for MCP server "${serverName}"`);
  const entries = Object.entries(value);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === 'string')) {
    throw new McpConfigError(`env must be a string map for MCP server "${serverName}"`);
  }
  return Object.fromEntries(entries.map(([name, item]) => [name, expandEnvironment(item, environment)]));
}

function serverWorkingDirectory(value: unknown, serverName: string, configPath: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new McpConfigError(`cwd must be a non-empty string for MCP server "${serverName}"`);
  }
  return isAbsolute(value) ? resolve(value) : resolve(dirname(configPath), value);
}

function serverTimeout(value: unknown, serverName: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new McpConfigError(`timeout_seconds must be a positive number for MCP server "${serverName}"`);
  }
  return value;
}

function expandEnvironment(value: string, environment: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, name: string) => environment[name] ?? match);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

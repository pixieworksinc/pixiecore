/**
 * Implements discovery behavior for the mcp plugin.
 */

import { access } from 'node:fs/promises';
import { delimiter, resolve } from 'node:path';

/**
 * Carries mcp discovery state across a boundary.
 */
export interface McpDiscoveryContext {
  readonly workingDirectory: string;
  readonly packageRoot?: string;
  readonly resolvePackageRoot: () => string;
  readonly environment: NodeJS.ProcessEnv;
}

/**
 * Discovers MCP config paths for the owning PixieCore boundary.
 */
export async function discoverMcpConfigPaths(
  explicitPath: string | null | undefined,
  context: McpDiscoveryContext,
): Promise<string[]> {
  if (explicitPath !== undefined && explicitPath !== null) return [explicitPath];
  const environmentPath = context.environment.MCP_CONFIG_PATH;
  if (environmentPath?.trim()) {
    return environmentPath.split(delimiter).map(path => path.trim()).filter(Boolean);
  }
  const current = resolve(context.workingDirectory, 'mcp.json');
  if (await exists(current)) return [current];
  const packageRoot = context.packageRoot ?? context.resolvePackageRoot();
  const packageConfig = resolve(packageRoot, 'mcp.json');
  if (packageConfig !== current && await exists(packageConfig)) return [packageConfig];
  return [];
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch { return false; }
}

/**
 * Implements tool binding behavior for the mcp plugin.
 */

import type { Tool } from '@modelcontextprotocol/client';
import type { RegisteredTool } from '../../../core/contracts/types/index.js';
import type { McpConnection } from './connection.js';

/**
 * Describes the mcp tool binding contract.
 */
export interface McpToolBinding {
  readonly connection: McpConnection;
  readonly tool: Tool;
}

/**
 * Describes the mcp tool registration contract.
 */
export interface McpToolRegistration {
  readonly name: string;
  readonly binding: McpToolBinding;
  readonly definition: RegisteredTool;
}

/**
 * Creates mcp tool registrations after validating the supplied contract.
 */
export function createMcpToolRegistrations(
  serverName: string,
  connection: McpConnection,
  tools: readonly Tool[],
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): McpToolRegistration[] {
  return tools.map(tool => {
    const name = `mcp.${serverName}.${tool.name}`;
    return {
      name,
      binding: { connection, tool },
      definition: {
        name,
        description: tool.description ?? '',
        parameters: tool.inputSchema as Record<string, unknown>,
        execute: args => execute(name, args),
      },
    };
  });
}

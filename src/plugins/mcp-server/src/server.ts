/**
 * Implements server behavior for the mcp server plugin.
 */

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type {
  McpServerCompositionPort,
  PixieCoreMcpServer,
} from '../../../core/contracts/mcp/server.js';
import type { ExecuteOptions } from '../../../core/contracts/types/index.js';
import {
  PIXIECORE_MCP_SERVER_INFO,
  PIXIECORE_MCP_TOOL_NAMES,
} from './constants.js';

const executionOptionsSchema = z.object({
  tool_choice: z.enum(['auto', 'required', 'none']).optional(),
  max_tool_rounds: z.number().int().nonnegative().optional(),
  use_pseudo_tool_calling: z.boolean().optional(),
  max_tokens: z.number().int().positive().optional(),
}).strict();

const executeInputSchema = z.object({
  blueprint_path: z.string().trim().min(1),
  inputs: z.record(z.string(), z.unknown()).optional(),
  options: executionOptionsSchema.optional(),
}).strict();

const executeYamlInputSchema = z.object({
  blueprint_yaml: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()).optional(),
  options: executionOptionsSchema.optional(),
}).strict();

type McpExecutionOptions = z.output<typeof executionOptionsSchema>;

/**
 * Creates type core mcp protocol server after validating the supplied contract.
 */
export function createPixieCoreMcpProtocolServer(
  composition: McpServerCompositionPort,
): PixieCoreMcpServer {
  const protocol = new McpServer(PIXIECORE_MCP_SERVER_INFO);
  const { runtime } = composition;

  protocol.registerTool(
    PIXIECORE_MCP_TOOL_NAMES.execute,
    {
      title: 'Execute PixieCore blueprint',
      description: 'Execute a PixieCore blueprint file with JSON inputs.',
      inputSchema: executeInputSchema,
    },
    async ({ blueprint_path, inputs, options }, context) => toolResult(
      await runtime.execute(
        blueprint_path,
        inputs ?? {},
        executeOptions(options, context.mcpReq.signal),
      ),
    ),
  );

  protocol.registerTool(
    PIXIECORE_MCP_TOOL_NAMES.executeYaml,
    {
      title: 'Execute PixieCore blueprint YAML',
      description: 'Execute an inline PixieCore blueprint YAML document with JSON inputs.',
      inputSchema: executeYamlInputSchema,
    },
    async ({ blueprint_yaml, inputs, options }, context) => toolResult(
      await runtime.executeYaml(
        blueprint_yaml,
        inputs ?? {},
        executeOptions(options, context.mcpReq.signal),
      ),
    ),
  );

  let closePromise: Promise<void> | undefined;
  const closeProtocol = protocol.close.bind(protocol);
  const closeResources = (): Promise<void> => closePromise ??= closeOwnedResources(
    runtime,
    composition.closeBootstrap,
  );
  Object.defineProperties(protocol, {
    runtime: { value: runtime, enumerable: true },
    closeResources: { value: closeResources, enumerable: false },
    close: {
      value: async (): Promise<void> => {
        const results = await Promise.allSettled([
          closeProtocol(),
          closeResources(),
        ]);
        const errors = rejectedReasons(results);
        if (errors.length) {
          throw new AggregateError(errors, 'Failed to close PixieCore MCP server resources');
        }
      },
    },
  });
  return protocol as PixieCoreMcpServer;
}

function executeOptions(
  options: McpExecutionOptions | undefined,
  signal: AbortSignal,
): ExecuteOptions {
  return {
    signal,
    ...(options?.tool_choice ? { toolChoice: options.tool_choice } : {}),
    ...(options?.max_tool_rounds !== undefined
      ? { maxToolRounds: options.max_tool_rounds }
      : {}),
    ...(options?.use_pseudo_tool_calling !== undefined
      ? { usePseudoToolCalling: options.use_pseudo_tool_calling }
      : {}),
    ...(options?.max_tokens !== undefined ? { maxTokens: options.max_tokens } : {}),
  };
}

function toolResult(result: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

async function closeOwnedResources(
  runtime: McpServerCompositionPort['runtime'],
  closeBootstrap?: () => void | Promise<void>,
): Promise<void> {
  const tasks = [Promise.resolve().then(() => runtime.close())];
  if (closeBootstrap) tasks.push(Promise.resolve().then(() => closeBootstrap()));
  const errors = rejectedReasons(await Promise.allSettled(tasks));
  if (errors.length) {
    throw new AggregateError(errors, 'Failed to close one or more PixieCore MCP resources');
  }
}

function rejectedReasons(results: readonly PromiseSettledResult<void>[]): unknown[] {
  return results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason);
}

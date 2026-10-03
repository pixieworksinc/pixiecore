/**
 * Executes registered tools for the runtime plugin.
 */

import { elapsedMilliseconds, errorMessage } from '../../../core/component/diagnostics/index.js';
import { ToolExecutionError } from '../../../core/contracts/errors/index.js';
import type { LoggerPort } from '../../../core/contracts/logging/index.js';
import type { RuntimeProcessorServicesPort } from '../../../core/contracts/runtime/index.js';
import type {
  RegisteredTool,
  ToolCall,
  ToolExecutionResult,
} from '../../../core/contracts/types/index.js';
import { formatToolResult } from './messages.js';

/** Owns the tool registry, argument validation, execution, and telemetry. */
export class RuntimeToolExecutor {
  readonly tools = new Map<string, RegisteredTool>();

  /** Creates a tool executor backed by scope-local runtime services. */
  constructor(
    private readonly services: RuntimeProcessorServicesPort,
    private readonly logger?: LoggerPort,
  ) {}

  /** Registers or replaces a tool by its canonical public name. */
  register(tool: RegisteredTool): void { this.tools.set(tool.name, tool); }

  /** Executes one registered tool after validating its arguments. */
  async execute(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const started = performance.now();
    const tool = this.tools.get(name);
    if (!tool) {
      const message = name.startsWith('mcp.')
        ? `MCP tool not found: ${name}. Check that its MCP server is configured.`
        : `Tool not found: ${name}`;
      this.log(name, args, undefined, started, message);
      throw new ToolExecutionError(message);
    }
    try {
      const validation = this.services.tools.validateArguments(tool.parameters, args);
      if (!validation.valid) {
        throw new ToolExecutionError(
          `Tool ${name} arguments do not match schema: ${validation.errors.join('; ')}`,
        );
      }
      const result = await tool.execute(args);
      this.log(name, args, result, started);
      return result;
    } catch (cause) {
      if (cause instanceof ToolExecutionError) {
        this.log(name, args, undefined, started, cause.message);
        throw cause;
      }
      const message = `Tool ${name} failed: ${errorMessage(cause)}`;
      this.log(name, args, undefined, started, message);
      throw new ToolExecutionError(message, { cause });
    }
  }

  /** Executes tool calls and converts failures into provider-facing results. */
  async executeCalls(calls: readonly ToolCall[]): Promise<ToolExecutionResult[]> {
    return Promise.all(calls.map(async call => {
      try {
        const value = await this.execute(call.name, call.arguments);
        return {
          id: call.id,
          name: call.name,
          content: formatToolResult(value),
          isError: false,
        };
      } catch (error) {
        const prefix = call.name.startsWith('mcp.')
          ? `MCP tool ${call.name} execution failed`
          : `Error executing tool ${call.name}`;
        return {
          id: call.id,
          name: call.name,
          content: `${prefix}: ${errorMessage(error)}`,
          isError: true,
        };
      }
    }));
  }

  /** Records one tool execution when a logger is configured. */
  private log(
    name: string,
    args: Record<string, unknown>,
    result: unknown,
    started: number,
    error?: string,
  ): void {
    if (!this.logger) return;
    this.services.logging.logToolExecution(
      name,
      args,
      result,
      elapsedMilliseconds(started),
      error,
      this.logger,
    );
  }
}

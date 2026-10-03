/**
 * Defines tools contracts shared across PixieCore boundaries.
 */

import type { ToolCall, ToolDefinition } from '../types/index.js';

/**
 * Describes the sanitized tool names contract.
 */
export interface SanitizedToolNames {
  readonly tools: ToolDefinition[];
  readonly mapping: Map<string, string>;
}

/**
 * Describes the result of tool argument validation.
 */
export interface ToolArgumentValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/** Scope-local tool-name capabilities supplied by the tools core plugin. */
export interface ToolServicePort {
  /**
   * Creates safe tool name for the owning PixieCore boundary.
   */
  makeSafeToolName(
    name: string,
    existing?: Set<string>,
    maxLength?: number,
  ): string;
  /**
   * Normalizes tool names while preserving caller-owned input.
   */
  sanitizeToolNames(tools: ToolDefinition[]): SanitizedToolNames;
  /**
   * Normalizes tool call names while preserving caller-owned input.
   */
  convertToolCallNames(
    calls: ToolCall[],
    mapping: Map<string, string>,
  ): ToolCall[];
  /**
   * Validates arguments and rejects unsupported input.
   */
  validateArguments(
    parameters: Record<string, unknown>,
    args: unknown,
  ): ToolArgumentValidationResult;
}

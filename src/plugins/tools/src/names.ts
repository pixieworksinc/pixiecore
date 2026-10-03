/**
 * Implements names behavior for the tools plugin.
 */

import { createHash } from 'node:crypto';
import type { ToolCall, ToolDefinition } from '../../../core/contracts/types/index.js';

/**
 * Creates safe tool name for the owning PixieCore boundary.
 */
export function makeSafeToolName(name: string, existing = new Set<string>(), maxLength = 64): string {
  if (/^[a-zA-Z0-9_-]+$/.test(name) && name.length <= maxLength && !existing.has(name)) { existing.add(name); return name; }
  const hash = createHash('sha256').update(name).digest('hex').slice(0, Math.max(1, maxLength - 5)); let candidate = `tool_${hash}`.slice(0, maxLength); let i = 1;
  while (existing.has(candidate)) { const suffix = `_${i++}`; candidate = `${`tool_${hash}`.slice(0, maxLength - suffix.length)}${suffix}`; }
  existing.add(candidate); return candidate;
}
/**
 * Normalizes tool names while preserving caller-owned input.
 */
export function sanitizeToolNames(tools: ToolDefinition[]): { tools: ToolDefinition[]; mapping: Map<string, string> } {
  const existing = new Set<string>(), mapping = new Map<string, string>();
  return { tools: tools.map(tool => { const safe = makeSafeToolName(tool.name, existing); if (safe !== tool.name) mapping.set(safe, tool.name); return { ...tool, name: safe }; }), mapping };
}
/**
 * Normalizes tool call names while preserving caller-owned input.
 */
export function convertToolCallNames(calls: ToolCall[], mapping: Map<string, string>): ToolCall[] { return calls.map(call => ({ ...call, name: mapping.get(call.name) ?? call.name })); }

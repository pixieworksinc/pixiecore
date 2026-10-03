/**
 * Implements messages behavior for the runtime plugin.
 */

import { renderInstructionTemplate } from '../../../core/component/instruction-template/index.js';
import { ConfigurationError } from '../../../core/contracts/errors/index.js';
import type { MultimodalServicePort } from '../../../core/contracts/multimodal/index.js';
import type {
  AgentRoleResult,
  Blueprint,
  Message,
  Provider,
  ToolCall,
  ToolExecutionResult,
} from '../../../core/contracts/types/index.js';

/**
 * Renders prompt for the owning PixieCore boundary.
 */
export function renderPrompt(
  template: string,
  inputs: Readonly<Record<string, unknown>>,
): string {
  return renderInstructionTemplate(template, inputs);
}

/**
 * Validates agent role result and rejects unsupported input.
 */
export function validateAgentRoleResult(
  value: unknown,
  role: string,
): asserts value is AgentRoleResult {
  if (!value || typeof value !== 'object' || !Array.isArray(
    (value as { messages?: unknown }).messages,
  )) {
    throw new ConfigurationError(`Agent role ${role} must return a messages array`);
  }
  const result = value as { messages: unknown[]; model?: unknown; temperature?: unknown };
  if (result.model !== undefined && (typeof result.model !== 'string' || !result.model)) {
    throw new ConfigurationError(`Agent role ${role} returned an invalid model`);
  }
  if (result.temperature !== undefined
    && (typeof result.temperature !== 'number' || !Number.isFinite(result.temperature))) {
    throw new ConfigurationError(`Agent role ${role} returned an invalid temperature`);
  }
  for (const message of result.messages) validateRoleMessage(message, role);
}

/**
 * Assembles prompt messages for the owning PixieCore boundary.
 */
export function assemblePromptMessages(
  roleResult: AgentRoleResult,
  blueprint: Blueprint,
  inputs: Readonly<Record<string, unknown>>,
  history: readonly Message[],
  provider: Provider,
  multimodal: MultimodalServicePort,
): Message[] {
  const localized = applyLocalization(roleResult.messages, blueprint.localization, inputs);
  const withExamples = insertExamples(localized, blueprint.examples ?? []);
  const withHistory = mergeHistory(withExamples, history);
  return multimodal.enhanceMessagesWithMultimodal(withHistory, inputs, provider);
}

/**
 * Appends tool round for the owning PixieCore boundary.
 */
export function appendToolRound(
  messages: Message[],
  assistantContent: string,
  providerCalls: readonly ToolCall[],
  results: readonly ToolExecutionResult[],
  pseudo: boolean,
): void {
  if (pseudo) {
    if (assistantContent) messages.push({ role: 'assistant', content: assistantContent });
    for (const result of results) {
      messages.push({
        role: 'user',
        content: `Tool ${result.name} returned: ${result.content}`,
      });
    }
    return;
  }
  messages.push({ role: 'assistant', content: assistantContent, toolCalls: providerCalls });
  results.forEach((result, index) => {
    const providerCall = providerCalls[index]!;
    messages.push({
      role: 'tool',
      toolCallId: providerCall.id,
      name: providerCall.name,
      content: result.content,
      ...(result.isError ? { isError: true } : {}),
    });
  });
}

/**
 * Appends validation retry for the owning PixieCore boundary.
 */
export function appendValidationRetry(
  messages: Message[],
  assistantContent: string,
  message: string,
): void {
  messages.push(
    { role: 'assistant', content: assistantContent },
    {
      role: 'user',
      content: `Your response was invalid: ${message}. Return corrected JSON only.`,
    },
  );
}

/**
 * Formats tool result for the owning PixieCore boundary.
 */
export function formatToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'null';
  const serialized = JSON.stringify(value);
  return serialized ?? String(value);
}

function mergeHistory(roleMessages: readonly Message[], history: readonly Message[]): Message[] {
  const promptIndex = lastUserMessageIndex(roleMessages);
  if (promptIndex < 0) {
    throw new ConfigurationError('Agent role must return at least one user message');
  }
  return [
    ...roleMessages.slice(0, promptIndex),
    ...history,
    ...roleMessages.slice(promptIndex),
  ];
}

function insertExamples(
  messages: readonly Message[],
  examples: Blueprint['examples'],
): Message[] {
  if (!examples?.length) return [...messages];
  const promptIndex = lastUserMessageIndex(messages);
  if (promptIndex < 0) {
    throw new ConfigurationError('Cannot insert examples without a user message');
  }
  const formatted: Message[] = examples.map(example => ({
    role: 'user',
    content: `input: ${JSON.stringify(example.input)}\noutput: ${JSON.stringify(example.output)}`,
  }));
  return [
    ...messages.slice(0, promptIndex),
    ...formatted,
    ...messages.slice(promptIndex),
  ];
}

function applyLocalization(
  messages: readonly Message[],
  localization: Blueprint['localization'],
  inputs: Readonly<Record<string, unknown>>,
): Message[] {
  if (!localization || Object.keys(localization).length === 0) return [...messages];
  const content = [
    'Localization requirements:',
    ...Object.entries(localization).map(([name, value]) =>
      `- ${name}: ${renderPrompt(value, inputs)}`),
  ].join('\n');
  let index = 0;
  while (messages[index]?.role === 'system') index++;
  return [
    ...messages.slice(0, index),
    { role: 'system', content },
    ...messages.slice(index),
  ];
}

function lastUserMessageIndex(messages: readonly Message[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') return index;
  }
  return -1;
}

function validateRoleMessage(message: unknown, role: string): void {
  if (!message
    || typeof message !== 'object'
    || !['system', 'user', 'assistant', 'tool'].includes(
      String((message as { role?: unknown }).role),
    )
    || !('content' in message)) {
    throw new ConfigurationError(`Agent role ${role} returned an invalid message`);
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content !== 'string' && !Array.isArray(content)) {
    throw new ConfigurationError(`Agent role ${role} returned invalid message content`);
  }
  if ((message as { role?: unknown }).role === 'tool'
    && (typeof content !== 'string'
      || typeof (message as { toolCallId?: unknown }).toolCallId !== 'string')) {
    throw new ConfigurationError(`Agent role ${role} returned an invalid tool message`);
  }
}

/**
 * Implements codec behavior for the providers plugin.
 */

import type { MultimodalServicePort } from '../../../../../../core/contracts/multimodal/index.js';
import type {
  FileContentPart,
  GenerateRequest,
  GenerateResponse,
  GenerationUsage,
  ImageContentPart,
  Message,
  MessageContent,
  ToolCall,
  ToolChoice,
  ToolMessage,
} from '../../../../../../core/contracts/types/index.js';
import { objectValue } from '../../../../providers.js';

const STRUCTURED_RESPONSE_TOOL = 'emit_structured_response';

type ConvertAttachment = (
  part: ImageContentPart | FileContentPart,
) => Promise<Record<string, unknown>>;

/**
 * Creates anthropic request body after validating the supplied contract.
 */
export async function buildAnthropicRequestBody(
  request: GenerateRequest,
  defaultModel: string,
  defaultMaxOutputTokens: number,
  convertAttachment: ConvertAttachment,
  multimodal: MultimodalServicePort,
): Promise<Record<string, unknown>> {
  const system = request.messages
    .filter(message => message.role === 'system')
    .map(message => multimodal.contentText(message.content))
    .join('\n\n');
  const schemaTool = request.schema ? {
    name: STRUCTURED_RESPONSE_TOOL,
    description: 'Emit the final response matching the required JSON Schema.',
    input_schema: request.schema,
  } : undefined;
  const tools = [
    ...(request.tools?.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    })) ?? []),
    ...(schemaTool ? [schemaTool] : []),
  ];
  return {
    model: request.model ?? defaultModel,
    max_tokens: request.maxTokens ?? defaultMaxOutputTokens,
    temperature: request.temperature,
    ...(system ? { system } : {}),
    messages: await toAnthropicMessages(request.messages, convertAttachment, multimodal),
    ...(tools.length ? {
      tools,
      tool_choice: requestToolChoice(request, Boolean(schemaTool)),
    } : {}),
  };
}

/**
 * Parses anthropic response for the owning PixieCore boundary.
 */
export function parseAnthropicResponse(raw: unknown): GenerateResponse {
  const data = objectValue(raw);
  const blocks = Array.isArray(data.content) ? data.content.map(objectValue) : [];
  const structured = blocks.find(
    block => block.type === 'tool_use' && block.name === STRUCTURED_RESPONSE_TOOL,
  );
  const responseText = blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');
  const toolCalls: ToolCall[] = blocks
    .filter(block => block.type === 'tool_use' && block.name !== STRUCTURED_RESPONSE_TOOL)
    .map(toAnthropicToolCall);
  const content = structured ? JSON.stringify(structured.input) : responseText;
  return {
    ...(content ? { content } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
    ...anthropicUsage(data.usage),
    raw,
  };
}

function anthropicUsage(raw: unknown): { usage?: GenerationUsage } {
  const value = objectValue(raw);
  const inputTokens = tokenCount(value.input_tokens);
  const outputTokens = tokenCount(value.output_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return {};
  return {
    usage: {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(inputTokens === undefined || outputTokens === undefined
        ? {}
        : { totalTokens: inputTokens + outputTokens }),
    },
  };
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

async function toAnthropicMessages(
  messages: readonly Message[],
  convertAttachment: ConvertAttachment,
  multimodal: MultimodalServicePort,
): Promise<Array<Record<string, unknown>>> {
  const converted: Array<Record<string, unknown>> = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      const results: Array<Record<string, unknown>> = [];
      let cursor = index;
      while (cursor < messages.length && messages[cursor]!.role === 'tool') {
        const tool = messages[cursor]! as ToolMessage;
        results.push({
          type: 'tool_result',
          tool_use_id: tool.toolCallId,
          content: tool.content,
          ...(tool.isError ? { is_error: true } : {}),
        });
        cursor++;
      }
      converted.push({ role: 'user', content: results });
      index = cursor - 1;
      continue;
    }
    if (message.role === 'assistant') {
      converted.push({
        role: 'assistant',
        content: [
          ...textBlocks(message.content, multimodal),
          ...(message.toolCalls?.map(call => ({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.arguments,
          })) ?? []),
        ],
      });
      continue;
    }
    converted.push({
      role: 'user',
      content: await Promise.all(multimodal.contentParts(message.content).map(async part => part.type === 'text'
        ? { type: 'text', text: part.text }
        : convertAttachment(part))),
    });
  }
  return converted;
}

function toAnthropicToolCall(block: Record<string, unknown>): ToolCall {
  return {
    id: String(block.id),
    name: String(block.name),
    arguments: objectValue(block.input),
  };
}

function textBlocks(
  content: MessageContent,
  multimodal: MultimodalServicePort,
): Array<Record<string, string>> {
  return multimodal.contentParts(content)
    .filter(part => part.type === 'text')
    .map(part => ({ type: 'text', text: part.text }));
}

function requestToolChoice(
  request: GenerateRequest,
  hasSchemaTool: boolean,
): Record<string, string> {
  if (!hasSchemaTool) return toAnthropicToolChoice(request.toolChoice);
  if (request.tools?.length && request.toolChoice !== 'none') return { type: 'any' };
  return { type: 'tool', name: STRUCTURED_RESPONSE_TOOL };
}

function toAnthropicToolChoice(choice: ToolChoice | undefined): Record<string, string> {
  if (choice === 'required') return { type: 'any' };
  if (choice === 'none') return { type: 'none' };
  return { type: 'auto' };
}

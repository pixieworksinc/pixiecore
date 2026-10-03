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

type ConvertAttachment = (
  part: ImageContentPart | FileContentPart,
) => Promise<Record<string, unknown>>;

/**
 * Creates gemini request body after validating the supplied contract.
 */
export async function buildGeminiRequestBody(
  request: GenerateRequest,
  convertAttachment: ConvertAttachment,
  multimodal: MultimodalServicePort,
): Promise<Record<string, unknown>> {
  const system = request.messages
    .filter(message => message.role === 'system')
    .map(message => multimodal.contentText(message.content))
    .join('\n');
  return {
    contents: await toGeminiContents(request.messages, convertAttachment, multimodal),
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      temperature: request.temperature,
      ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
      ...(request.schema ? {
        responseMimeType: 'application/json',
        responseSchema: cleanGeminiSchema(request.schema),
      } : {}),
    },
    ...(request.tools?.length ? {
      tools: [{
        functionDeclarations: request.tools.map(tool => ({
          ...tool,
          parameters: cleanGeminiSchema(tool.parameters),
        })),
      }],
      toolConfig: { functionCallingConfig: { mode: toGeminiToolChoice(request.toolChoice) } },
    } : {}),
  };
}

/**
 * Parses gemini response for the owning PixieCore boundary.
 */
export function parseGeminiResponse(raw: unknown): GenerateResponse {
  const data = objectValue(raw);
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const content = objectValue(objectValue(candidates[0]).content);
  const parts = Array.isArray(content.parts) ? content.parts.map(objectValue) : [];
  const toolCalls: ToolCall[] = parts
    .filter(part => part.functionCall)
    .map(toGeminiToolCall);
  return {
    content: parts
      .filter(part => typeof part.text === 'string')
      .map(part => part.text)
      .join(''),
    ...(toolCalls.length ? { toolCalls } : {}),
    ...geminiUsage(data.usageMetadata),
    raw,
  };
}

function geminiUsage(raw: unknown): { usage?: GenerationUsage } {
  const value = objectValue(raw);
  const inputTokens = tokenCount(value.promptTokenCount);
  const outputTokens = tokenCount(value.candidatesTokenCount);
  const totalTokens = tokenCount(value.totalTokenCount);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return {};
  return {
    usage: {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(totalTokens === undefined ? {} : { totalTokens }),
    },
  };
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Removes unsupported fields from gemini schema for the owning PixieCore boundary.
 */
export function cleanGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanGeminiSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'additionalProperties' && key !== 'format')
    .map(([key, item]) => [key, cleanGeminiSchema(item)]));
}

async function toGeminiContents(
  messages: readonly Message[],
  convertAttachment: ConvertAttachment,
  multimodal: MultimodalServicePort,
): Promise<Array<Record<string, unknown>>> {
  const converted: Array<Record<string, unknown>> = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      const parts: Array<Record<string, unknown>> = [];
      let cursor = index;
      while (cursor < messages.length && messages[cursor]!.role === 'tool') {
        const tool = messages[cursor]! as ToolMessage;
        parts.push({
          functionResponse: {
            id: tool.toolCallId,
            name: tool.name ?? 'unknown_tool',
            response: tool.isError ? { error: tool.content } : responseObject(tool.content),
          },
        });
        cursor++;
      }
      converted.push({ role: 'user', parts });
      index = cursor - 1;
      continue;
    }
    if (message.role === 'assistant') {
      converted.push({
        role: 'model',
        parts: [
          ...geminiTextParts(message.content, multimodal),
          ...(message.toolCalls?.map(call => ({
            functionCall: { id: call.id, name: call.name, args: call.arguments },
            ...(typeof call.providerMetadata?.thoughtSignature === 'string'
              ? { thoughtSignature: call.providerMetadata.thoughtSignature }
              : {}),
          })) ?? []),
        ],
      });
      continue;
    }
    converted.push({
      role: 'user',
      parts: await Promise.all(multimodal.contentParts(message.content).map(async part => part.type === 'text'
        ? { text: part.text }
        : convertAttachment(part))),
    });
  }
  return converted;
}

function toGeminiToolCall(part: Record<string, unknown>, index: number): ToolCall {
  const functionCall = objectValue(part.functionCall);
  return {
    id: String(functionCall.id ?? `gemini-${index}`),
    name: String(functionCall.name),
    arguments: objectValue(functionCall.args),
    ...(part.thoughtSignature
      ? { providerMetadata: { thoughtSignature: part.thoughtSignature } }
      : {}),
  };
}

function geminiTextParts(
  content: MessageContent,
  multimodal: MultimodalServicePort,
): Array<Record<string, string>> {
  return multimodal.contentParts(content)
    .filter(part => part.type === 'text')
    .map(part => ({ text: part.text }));
}

function toGeminiToolChoice(choice: ToolChoice | undefined): 'AUTO' | 'ANY' | 'NONE' {
  if (choice === 'required') return 'ANY';
  if (choice === 'none') return 'NONE';
  return 'AUTO';
}

function responseObject(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { result: content };
  }
}

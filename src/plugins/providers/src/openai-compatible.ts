/**
 * Implements openai compatible behavior for the providers plugin.
 */

import { MultimodalNotSupportedError } from '../../../core/contracts/errors/index.js';
import type { MultimodalServicePort, ResolvedAttachment } from '../../../core/contracts/multimodal/index.js';
import type {
  GenerateRequest,
  GenerateResponse,
  GenerationUsage,
  Message,
  MessageContent,
  MessageContentPart,
  ToolCall,
} from '../../../core/contracts/types/index.js';
import {
  assertImageSupported,
  HttpTransport,
  objectValue,
  parseArgs,
  uniqueStrings,
  type Fetcher,
  type HeaderProvider,
} from './shared.js';
import type { ProviderServices } from './services.js';

interface OpenAICompatibleCapabilities {
  readonly tools: boolean;
  readonly vision: boolean;
  readonly fileInput: boolean;
}

const DEFAULT_CAPABILITIES: OpenAICompatibleCapabilities = Object.freeze({
  tools: true,
  vision: true,
  fileInput: true,
});

/**
 * Provides open ai compatible operations through a stable contract.
 */
export class OpenAICompatibleProvider {
  private readonly transport: HttpTransport;

  /**
   * Creates a OpenAICompatibleProvider and establishes its initial state.
   */
  constructor(
    readonly name: string,
    readonly model: string,
    private readonly completionUrl: string,
    private readonly modelsUrl: string | undefined,
    private readonly headerProvider: HeaderProvider,
    private readonly modelListFallback: readonly string[] = [],
    private readonly services: ProviderServices,
    private readonly fetcher: Fetcher = globalThis.fetch,
    timeout = 60,
    private readonly capabilities: OpenAICompatibleCapabilities = DEFAULT_CAPABILITIES,
  ) {
    this.transport = new HttpTransport(name, services, this.fetcher, timeout);
  }

  /** Reports whether the provider accepts tool definitions. */
  get supportsTools(): boolean { return this.capabilities.tools; }

  /** Reports whether the provider accepts any multimodal input. */
  get supportsMultimodal(): boolean {
    return this.capabilities.vision || this.capabilities.fileInput;
  }

  /** Reports whether the provider accepts visual content. */
  supportsVision(): boolean { return this.capabilities.vision; }

  /** Reports whether the provider accepts file attachments. */
  supportsFileInput(): boolean { return this.capabilities.fileInput; }

  /**
   * Returns model list from the OpenAICompatibleProvider state.
   */
  async getModelList(signal?: AbortSignal): Promise<string[]> {
    if (!this.modelsUrl) return uniqueStrings(this.modelListFallback.length ? this.modelListFallback : [this.model]);
    const data = objectValue(await this.transport.getJson(
      this.modelsUrl,
      await this.headerProvider(),
      signal,
    ));
    const models = Array.isArray(data.data)
      ? data.data
          .map(item => objectValue(item).id)
          .filter((id): id is string => typeof id === 'string')
      : [];
    return uniqueStrings(models.length ? models : [...this.modelListFallback, this.model]);
  }

  /**
   * Creates the requested operation according to the OpenAICompatibleProvider contract.
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const tools = request.tools?.map(tool => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      messages: await Promise.all(request.messages.map(message => toOpenAIMessage(
        message,
        this.fetcher,
        this.name,
        this.services.multimodal,
      ))),
      temperature: request.temperature,
    };
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = request.toolChoice ?? 'auto';
    }
    if (request.schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'pixiecore_output',
          strict: true,
          schema: normalizeOpenAIResponseSchema(request.schema),
        },
      };
    }
    const raw = await this.transport.postJson(
      this.completionUrl,
      await this.headerProvider(),
      body,
      request.signal,
    );
    const data = objectValue(raw);
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const message = objectValue(objectValue(choices[0]).message);
    const toolCalls: ToolCall[] = Array.isArray(message.tool_calls)
      ? message.tool_calls.map(toOpenAIToolCall)
      : [];
    return {
      ...(message.content == null ? {} : { content: String(message.content) }),
      ...(toolCalls.length ? { toolCalls } : {}),
      ...usageProperty(data.usage, 'prompt_tokens', 'completion_tokens', 'total_tokens'),
      raw,
    };
  }
}

function normalizeOpenAIResponseSchema(value: unknown): unknown {
  return flattenRootObjectUnion(normalizeOpenAISchemaNode(value));
}

function normalizeOpenAISchemaNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeOpenAISchemaNode);
  if (value === null || typeof value !== 'object') return value;
  const normalized = Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'uniqueItems')
    .map(([key, child]) => [
      key === 'oneOf' ? 'anyOf' : key,
      normalizeOpenAISchemaNode(child),
    ]));
  if (
    normalized.type === 'array'
    && normalized.maxItems === 0
    && !Object.hasOwn(normalized, 'items')
  ) {
    return { ...normalized, items: { type: 'null' } };
  }
  if (!Object.hasOwn(normalized, 'type') && Object.hasOwn(normalized, 'const')) {
    return { type: jsonSchemaTypeOf(normalized.const), ...normalized };
  }
  return normalized;
}

function flattenRootObjectUnion(value: unknown): unknown {
  const schema = schemaObject(value);
  if (!schema || !Array.isArray(schema.anyOf)) return value;
  const definitions = schemaObject(schema.$defs) ?? {};
  const branches = schema.anyOf.map(branch => resolveRootBranch(branch, definitions));
  if (branches.some(branch => !isClosedObjectSchema(branch))) return value;
  const objects = branches as Record<string, unknown>[];
  const firstProperties = schemaObject(objects[0]?.properties);
  const firstRequired = stringArray(objects[0]?.required);
  if (!firstProperties || !firstRequired) return value;
  const propertyNames = Object.keys(firstProperties);
  if (!objects.every(branch => sameStrings(Object.keys(schemaObject(branch.properties) ?? {}), propertyNames))) {
    return value;
  }
  if (!objects.every(branch => sameStrings(stringArray(branch.required) ?? [], firstRequired))) {
    return value;
  }
  const properties = Object.fromEntries(propertyNames.map(name => {
    const variants = uniqueSchemaVariants(objects.map(branch => schemaObject(branch.properties)![name]));
    return [name, variants.length === 1 ? variants[0] : { anyOf: variants }];
  }));
  const siblings = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'anyOf'));
  return {
    ...siblings,
    type: 'object',
    additionalProperties: false,
    required: firstRequired,
    properties,
  };
}

function resolveRootBranch(
  value: unknown,
  definitions: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const branch = schemaObject(value);
  if (!branch) return undefined;
  if (typeof branch.$ref !== 'string') return branch;
  const match = /^#\/\$defs\/([^/]+)$/u.exec(branch.$ref);
  if (!match) return undefined;
  return schemaObject(definitions[match[1]!.replaceAll('~1', '/').replaceAll('~0', '~')]);
}

function isClosedObjectSchema(value: Record<string, unknown> | undefined): boolean {
  return value?.type === 'object'
    && value.additionalProperties === false
    && schemaObject(value.properties) !== undefined
    && stringArray(value.required) !== undefined;
}

function schemaObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? [...value]
    : undefined;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(value => right.includes(value));
}

function uniqueSchemaVariants(values: readonly unknown[]): unknown[] {
  const indexed = new Map<string, unknown>();
  for (const value of values) indexed.set(JSON.stringify(value), value);
  return [...indexed.values()];
}

function jsonSchemaTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function usageProperty(
  raw: unknown,
  inputKey: string,
  outputKey: string,
  totalKey: string,
): { usage?: GenerationUsage } {
  const value = objectValue(raw);
  const inputTokens = tokenCount(value[inputKey]);
  const outputTokens = tokenCount(value[outputKey]);
  const totalTokens = tokenCount(value[totalKey]);
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

function toOpenAIToolCall(value: unknown): ToolCall {
  const call = objectValue(value);
  const functionCall = objectValue(call.function);
  return {
    id: String(call.id),
    name: String(functionCall.name),
    arguments: parseArgs(functionCall.arguments),
  };
}

async function toOpenAIMessage(
  message: Message,
  fetcher: Fetcher,
  providerName: string,
  multimodal: MultimodalServicePort,
): Promise<Record<string, unknown>> {
  if (message.role === 'tool') {
    return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
  }
  if (message.role === 'assistant') {
    const toolCalls = message.toolCalls?.map(call => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    }));
    const text = multimodal.contentText(message.content);
    return {
      role: 'assistant',
      content: toolCalls?.length && !text ? null : text,
      ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
    };
  }
  if (message.role === 'system') {
    return { role: 'system', content: multimodal.contentText(message.content) };
  }
  return {
    role: 'user',
    content: await toOpenAIUserContent(message.content, fetcher, providerName, multimodal),
  };
}

async function toOpenAIUserContent(
  content: MessageContent,
  fetcher: Fetcher,
  providerName: string,
  multimodal: MultimodalServicePort,
): Promise<unknown> {
  if (typeof content === 'string') return content;
  return Promise.all(content.map(part => (
    toOpenAIContentPart(part, fetcher, providerName, multimodal)
  )));
}

async function toOpenAIContentPart(
  part: MessageContentPart,
  fetcher: Fetcher,
  providerName: string,
  multimodal: MultimodalServicePort,
): Promise<Record<string, unknown>> {
  if (part.type === 'text') return { type: 'text', text: part.text };
  const attachment = await multimodal.resolveAttachment(part, fetcher);
  if (part.type === 'image') {
    return toOpenAIImagePart(attachment, fetcher, providerName, multimodal);
  }
  if (attachment.fileId) return { type: 'file', file: { file_id: attachment.fileId } };
  if (attachment.mediaType !== 'application/pdf') {
    throw new MultimodalNotSupportedError(
      `${providerName} accepts PDF files for Chat Completions; received ${attachment.mediaType}.`,
    );
  }
  const fileData = attachment.dataUrl ?? multimodal.makeDataUrl(
    attachment.mediaType,
    await multimodal.attachmentBytes(attachment, fetcher),
  );
  return {
    type: 'file',
    file: { filename: attachment.filename, file_data: fileData },
  };
}

async function toOpenAIImagePart(
  attachment: ResolvedAttachment,
  fetcher: Fetcher,
  providerName: string,
  multimodal: MultimodalServicePort,
): Promise<Record<string, unknown>> {
  assertImageSupported(attachment, providerName);
  const url = attachment.url ?? attachment.dataUrl
    ?? multimodal.makeDataUrl(
      attachment.mediaType,
      await multimodal.attachmentBytes(attachment, fetcher),
    );
  return {
    type: 'image_url',
    image_url: { url, ...(attachment.detail ? { detail: attachment.detail } : {}) },
  };
}

/**
 * Defines types contracts shared across PixieCore boundaries.
 */

import type { LoggerPort, LoggingOptions } from '../logging/index.js';

/**
 * Defines the supported json primitive values.
 */
export type JsonPrimitive = string | number | boolean | null;
/**
 * Defines the supported json value values.
 */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
/**
 * Defines the supported json object values.
 */
export type JsonObject = { [key: string]: JsonValue };

/**
 * Defines the supported jit fallback reason values.
 */
export type JitFallbackReason =
  | 'artifact_unavailable'
  | 'artifact_invalid'
  | 'promotion_missing'
  | 'source_changed'
  | 'model_changed'
  | 'program_error';

/**
 * Describes a jit execution event.
 */
export type JitExecutionEvent =
  | {
      readonly outcome: 'compiled';
      readonly blueprint: string;
      readonly version: string;
      readonly model: string;
      readonly artifact: string;
    }
  | {
      readonly outcome: 'fallback';
      readonly blueprint: string;
      readonly version: string;
      readonly model: string;
      readonly reason: JitFallbackReason;
    };

/**
 * Defines the supported input type values.
 */
export type InputType = 'string' | 'integer' | 'float' | 'number' | 'boolean' | 'array' | 'object' | 'file' | 'image';

/**
 * Describes the input placeholder contract.
 */
export interface InputPlaceholder {
  name: string;
  type: InputType;
  required?: boolean;
  default?: unknown;
  description?: string;
}

/**
 * Describes the blueprint contract.
 */
export interface Blueprint {
  name: string;
  version: string;
  role: string;
  prompt: string;
  input_schema?: string | Record<string, unknown>;
  output_schema: string | Record<string, unknown>;
  input_placeholders?: InputPlaceholder[] | string[];
  localization?: Record<string, string>;
  permissions?: BlueprintPermissions;
  examples?: Array<{ input: Record<string, unknown>; output: Record<string, unknown> }>;
  model?: string;
  temperature?: number;
  tools?: string[];
  [key: string]: unknown;
}

/**
 * Describes the blueprint permissions contract.
 */
export interface BlueprintPermissions {
  allow_roles?: string[];
  deny_roles?: string[];
  allow_users?: string[];
  deny_users?: string[];
  allow_scopes?: string[];
  deny_scopes?: string[];
  [key: string]: string[] | undefined;
}

/**
 * Describes the text content part contract.
 */
export interface TextContentPart { readonly type: 'text'; readonly text: string }
/**
 * Describes the image content part contract.
 */
export interface ImageContentPart {
  readonly type: 'image';
  /** Local path, data URL, or HTTPS URL. */
  readonly source: string;
  readonly mediaType?: string;
  readonly filename?: string;
  readonly detail?: 'auto' | 'low' | 'high';
}
/**
 * Describes the file content part contract.
 */
export interface FileContentPart {
  readonly type: 'file';
  /** Local path, data URL, HTTPS URL, or provider file ID. */
  readonly source: string;
  readonly mediaType?: string;
  readonly filename?: string;
}
/**
 * Defines the supported message content part values.
 */
export type MessageContentPart = TextContentPart | ImageContentPart | FileContentPart;
/**
 * Defines the supported message content values.
 */
export type MessageContent = string | readonly MessageContentPart[];

/**
 * Describes the tool definition contract.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}
/**
 * Describes the tool call contract.
 */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly providerMetadata?: Record<string, unknown>;
}
/**
 * Describes the system message contract.
 */
export interface SystemMessage { readonly role: 'system'; readonly content: MessageContent }
/**
 * Describes the user message contract.
 */
export interface UserMessage { readonly role: 'user'; readonly content: MessageContent }
/**
 * Describes the assistant message contract.
 */
export interface AssistantMessage {
  readonly role: 'assistant';
  readonly content: MessageContent;
  readonly toolCalls?: readonly ToolCall[];
}
/**
 * Describes the tool message contract.
 */
export interface ToolMessage {
  readonly role: 'tool';
  readonly content: string;
  readonly toolCallId: string;
  readonly name?: string;
  readonly isError?: boolean;
}
/**
 * Defines the supported message values.
 */
export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;
/**
 * Describes the result of tool execution.
 */
export interface ToolExecutionResult {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly isError: boolean;
}
/**
 * Defines the supported tool handler values.
 */
export type ToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;
/**
 * Describes the registered tool contract.
 */
export interface RegisteredTool extends ToolDefinition { execute: ToolHandler }
/**
 * Defines the supported tool choice values.
 */
export type ToolChoice = 'auto' | 'required' | 'none';

/**
 * Describes the generate request contract.
 */
export interface GenerateRequest {
  messages: readonly Message[];
  schema?: Record<string, unknown>;
  tools?: readonly ToolDefinition[];
  toolChoice?: ToolChoice;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}
/**
 * Describes the generation usage contract.
 */
export interface GenerationUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}
/**
 * Describes the generate response contract.
 */
export interface GenerateResponse {
  content?: string;
  toolCalls?: ToolCall[];
  usage?: GenerationUsage;
  raw?: unknown;
}
/**
 * Describes the provider contract.
 */
export interface Provider {
  readonly name: string;
  readonly model: string;
  readonly supportsTools: boolean;
  /** @deprecated Use supportsVision() and supportsFileInput(). */
  readonly supportsMultimodal: boolean;
  /**
   * Reports whether the provider accepts visual content.
   */
  supportsVision(): boolean;
  /**
   * Reports whether the provider accepts file attachments.
   */
  supportsFileInput(): boolean;
  /**
   * Returns model list without exposing mutable internal state.
   */
  getModelList(signal?: AbortSignal): Promise<string[]>;
  /**
   * Creates the requested operation after validating the supplied contract.
   */
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  /**
   * Releases resources owned by the implementation.
   */
  close?(): void | Promise<void>;
}

/**
 * Describes the result of agent role.
 */
export interface AgentRoleResult {
  readonly messages: readonly Message[];
  readonly model?: string;
  readonly temperature?: number;
}

/**
 * Describes the agent role plugin contract.
 */
export interface AgentRolePlugin {
  readonly supportedRoles: readonly string[];
  /**
   * Applies the contribution without mutating caller-owned input.
   */
  apply(
    renderedPrompt: string,
    blueprint: Blueprint,
    inputs: Readonly<Record<string, unknown>>,
  ): AgentRoleResult | Promise<AgentRoleResult>;
  /**
   * Releases resources owned by the implementation.
   */
  close?(): void | Promise<void>;
}

/**
 * Defines the supported decorator stage values.
 */
export type DecoratorStage = 'before' | 'after' | 'both';

/**
 * Carries decorator state across a boundary.
 */
export interface DecoratorContext {
  readonly blueprint: Blueprint;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly schema?: Record<string, unknown>;
  readonly provider: Provider;
  readonly request?: GenerateRequest;
  readonly attempt: number;
  readonly output?: unknown;
}

/**
 * Describes the output decorator contract.
 */
export interface OutputDecorator {
  readonly priority?: number;
  /** Defaults to `after`. Permission-style guards use `before`. */
  readonly stage?: DecoratorStage;
  /**
   * Validates the requested operation and rejects unsupported input.
   */
  validate(context: DecoratorContext): DecoratorContext | void | Promise<DecoratorContext | void>;
  /**
   * Releases resources owned by the implementation.
   */
  close?(): void | Promise<void>;
}

/**
 * Describes the provider factory contract.
 */
export interface ProviderFactory {
  readonly name: string;
  /**
   * Creates the requested operation after validating the supplied contract.
   */
  create(options: RuntimeOptions): Provider | Promise<Provider>;
  /**
   * Releases resources owned by the implementation.
   */
  close?(): void | Promise<void>;
}

/**
 * Defines the supported provider plugin values.
 */
export type ProviderPlugin = Provider | ProviderFactory;

/**
 * Describes the type core plugin contract.
 */
export interface PixieCorePlugin {
  readonly extensions?: readonly import('../plugin/extension.js').PluginExtension[];
  readonly agentRoles?: readonly AgentRolePlugin[];
  readonly decorators?: readonly OutputDecorator[];
  readonly tools?: readonly RegisteredTool[];
  readonly providers?: readonly ProviderPlugin[];
  /**
   * Releases resources owned by the implementation.
   */
  close?(): void | Promise<void>;
}

/**
 * Defines the supported azure token provider values.
 */
export type AzureTokenProvider = () => string | Promise<string>;

/**
 * Configures execute behavior.
 */
export interface ExecuteOptions {
  messages?: Message[];
  toolChoice?: ToolChoice;
  maxToolRounds?: number;
  usePseudoToolCalling?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Configures runtime behavior.
 */
export interface RuntimeOptions extends LoggingOptions {
  /** Complete environment snapshot. Supplying it disables automatic `.env` discovery. */
  environment?: NodeJS.ProcessEnv;
  provider?: Provider | ProviderName;
  model?: string;
  temperature?: number;
  maxRetry?: number;
  maxToolRounds?: number;
  toolChoice?: ToolChoice;
  usePseudoToolCalling?: boolean;
  requestTimeout?: number;
  strictValidation?: boolean;
  pluginsDir?: string | string[];
  /** Managed custom-plugin state file. Use `disabled` to bypass discovery. */
  pluginConfigPath?: string | 'disabled' | null;
  mcpConfigPath?: string | 'disabled' | null;
  /** Explicit opt-in path to an evidence-admitted deterministic promotion artifact. */
  promotionsPath?: string | 'disabled' | null;
  /** Value-free observation callback for compiled execution and model fallback. */
  onJitEvent?: (event: JitExecutionEvent) => void;
  /** Overrides network transport for testing or host-managed HTTP policy. */
  fetch?: typeof globalThis.fetch;
  /** Uses an application-owned logger instead of creating a runtime logger. */
  logger?: LoggerPort;
  /** Overrides DefaultAzureCredential for Azure AD authentication. */
  azureTokenProvider?: AzureTokenProvider;
}
/**
 * Defines the supported built in provider name values.
 */
export type BuiltInProviderName =
  | 'openai'
  | 'anthropic'
  | 'azure_openai'
  | 'azure_native'
  | 'gemini_native'
  | 'gemini_openai'
  | 'apisix';
/** Built-in names plus names supplied by provider plugins. */
export type ProviderName = string;

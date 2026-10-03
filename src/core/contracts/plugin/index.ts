/**
 * Supported authoring contracts for trusted third-party PixieCore plugins.
 *
 * Bootstrap activators, scoped service tokens, manager state, and core-only
 * service/command components are intentionally not part of this subpath.
 */
export type {
  AgentRolePlugin,
  AgentRoleResult,
  AssistantMessage,
  AzureTokenProvider,
  Blueprint,
  BlueprintPermissions,
  DecoratorContext,
  DecoratorStage,
  FileContentPart,
  GenerateRequest,
  GenerateResponse,
  ImageContentPart,
  InputPlaceholder,
  InputType,
  Message,
  MessageContent,
  MessageContentPart,
  OutputDecorator,
  Provider,
  ProviderFactory,
  ProviderName,
  ProviderPlugin,
  RegisteredTool,
  RuntimeOptions,
  SystemMessage,
  TextContentPart,
  ToolCall,
  ToolChoice,
  ToolDefinition,
  ToolHandler,
  ToolMessage,
  PixieCorePlugin,
  UserMessage,
} from '../types/index.js';

export type {
  LoggerPort,
  LoggingOptions,
  LogLevel,
  LogRecord,
} from '../logging/index.js';

export type { PluginExtension } from './extension.js';

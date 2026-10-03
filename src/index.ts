/**
 * Public runtime, plugin, validation, logging, tool, and multimodal contracts
 * for PixieCore applications.
 *
 * @packageDocumentation
 */

export { PromptRuntime } from './core/kernel/runtime/index.js';
export { PromptProcessor } from './core/kernel/processor/index.js';
export { BlueprintValidator, InputValidator, OutputValidator } from './plugins/validation/validation.js';
export { PluginManager } from './core/kernel/plugin/manager.js';
export { DefaultAgentRole } from './plugins/roles/roles.js';
export { PermissionGuard } from './plugins/permissions/permissions.js';
export { SchemaGuard } from './plugins/validation/validation.js';
export { SelfEvalDecorator } from './plugins/self-evaluation/self-evaluation.js';
export { McpManager } from './plugins/mcp/mcp.js';
export type { McpConfig, McpManagerOptions, McpServerConfig } from './core/contracts/mcp/index.js';
export {
  createPixieCoreMcpServer,
  servePixieCoreMcpStdio,
  PIXIECORE_MCP_SERVER_INFO,
  PIXIECORE_MCP_TOOL_NAMES,
} from './core/kernel/mcp-server/index.js';
export type {
  McpServerCompositionPort,
  McpServerRuntimePort,
  PixieCoreMcpServer,
  PixieCoreMcpServerOptions,
} from './core/kernel/mcp-server/index.js';
export { BUILT_IN_PROVIDER_NAMES, cleanGeminiSchema, createProvider, isBuiltInProviderName, shouldUseAnthropicPdfTextFallback } from './core/kernel/providers/index.js';
export { getConfig, getLoggingConfig, getRuntimeEnvironment } from './core/kernel/config/index.js';
export {
  LoggingConfig,
  PixieCoreLogger,
  captureLogs,
  configureLogging,
  generateTraceId,
  getLogger,
  getTraceId,
  logExecutionComplete,
  logExecutionRetry,
  logExecutionStart,
  logLlmRequest,
  logLlmResponse,
  logToolExecution,
  logValidationResult,
  runWithTraceId,
  sanitizeLogMessage,
  sanitizePayload,
  setTraceId,
  truncatePayload,
} from './plugins/logging/logging.js';
export type { LoggingOptions, LogLevel, LogRecord, SanitizationOptions, TruncatedPayload } from './plugins/logging/logging.js';
export { makeSafeToolName, sanitizeToolNames, convertToolCallNames } from './plugins/tools/tools.js';
export {
  attachmentBytes,
  contentParts,
  contentText,
  enhanceMessagesWithMultimodal,
  extractPdfText,
  makeDataUrl,
  mimeFromName,
  normalizeAttachmentInput,
  parseDataUrl,
  resolveAttachment,
} from './plugins/multimodal/multimodal.js';
export type { ResolvedAttachment } from './core/contracts/multimodal/index.js';
export * from './core/contracts/errors/index.js';
export type * from './core/contracts/index.js';

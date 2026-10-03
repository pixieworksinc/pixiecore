/**
 * Defines the stable error hierarchy and machine-readable codes exposed by
 * PixieCore boundaries.
 */

/**
 * Provides the common message, error code, cause, and runtime class name used
 * by every PixieCore domain error.
 */
export class PixieCoreError extends Error {
  /** Creates a typed failure without exposing implementation details. */
  constructor(message: string, public readonly code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Reports a Blueprint that does not satisfy its structural contract. */
export class BlueprintValidationError extends PixieCoreError {
  /** Creates a Blueprint validation failure while preserving its cause. */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'blueprint_validation_error', options);
  }
}

/** Reports invalid or incomplete runtime configuration. */
export class ConfigurationError extends PixieCoreError {
  /** Creates a configuration failure while preserving its cause. */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'configuration_error', options);
  }
}

/** Reports input that cannot cross a runtime validation boundary. */
export class InputValidationError extends PixieCoreError {
  /** Creates an input failure with a caller-selectable specialized code. */
  constructor(message: string, code = 'input_validation_error', options?: ErrorOptions) {
    super(message, code, options);
  }
}

/** Reports input whose JavaScript value has the wrong top-level type. */
export class InputTypeError extends InputValidationError {
  /** Creates a top-level input type failure. */
  constructor(message: string) {
    super(message, 'input_type_error');
  }
}

/** Reports data that does not satisfy a JSON Schema contract. */
export class SchemaValidationError extends PixieCoreError {
  /** Creates a schema validation failure. */
  constructor(message: string) {
    super(message, 'schema_validation_error');
  }
}

/** Reports a provider API request or response failure. */
export class LLMAPIError extends PixieCoreError {
  /** Creates a provider API failure while preserving its cause. */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'llm_api_error', options);
  }
}

/** Reports exhaustion of the configured correction retry budget. */
export class MaxRetryExceededError extends PixieCoreError {
  /** Creates a retry exhaustion failure. */
  constructor(message: string) {
    super(message, 'max_retry_exceeded');
  }
}

/** Reports a tool invocation that failed before producing a valid result. */
export class ToolExecutionError extends PixieCoreError {
  /** Creates a tool execution failure while preserving its cause. */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'tool_execution_error', options);
  }
}

/** Reports a plugin that could not be discovered, loaded, or activated. */
export class PluginLoadError extends PixieCoreError {
  /** Creates a plugin loading failure while preserving its cause. */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'plugin_load_error', options);
  }
}

/** Reports malformed MCP server configuration. */
export class McpConfigError extends PixieCoreError {
  /** Creates an MCP configuration failure while preserving its cause. */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'mcp_config_error', options);
  }
}

/** Reports an MCP transport or server connection failure. */
export class McpConnectionError extends PixieCoreError {
  /** Creates an MCP connection failure while preserving its cause. */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'mcp_connection_error', options);
  }
}

/** Reports an MCP tool discovery, binding, or invocation failure. */
export class McpToolError extends PixieCoreError {
  /** Creates an MCP tool failure while preserving its cause. */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'mcp_tool_error', options);
  }
}

/** Reports an attachment that requires unsupported multimodal capability. */
export class MultimodalNotSupportedError extends PixieCoreError {
  /** Creates an unsupported multimodal input failure. */
  constructor(message: string) {
    super(message, 'multimodal_not_supported');
  }
}

/** Reports a Blueprint role for which no role plugin is registered. */
export class AgentRoleNotFoundError extends PixieCoreError {
  /** Creates a missing role plugin failure. */
  constructor(message: string) {
    super(message, 'agent_role_not_found');
  }
}

/** Reports denial by a role-based permission rule. */
export class RolePermissionError extends PixieCoreError {
  /** Creates a role permission denial. */
  constructor(message: string) {
    super(message, 'role_permission_error');
  }
}

/** Reports denial by a user-based permission rule. */
export class UserPermissionError extends PixieCoreError {
  /** Creates a user permission denial. */
  constructor(message: string) {
    super(message, 'user_permission_error');
  }
}

/** Reports denial by a scope-based permission rule. */
export class ScopePermissionError extends PixieCoreError {
  /** Creates a scope permission denial. */
  constructor(message: string) {
    super(message, 'scope_permission_error');
  }
}

/** Reports failure of a configured self-evaluation contract. */
export class SelfEvaluationError extends PixieCoreError {
  /** Creates a self-evaluation failure. */
  constructor(message: string) {
    super(message, 'self_evaluation_error');
  }
}

/** Reports an invalid or unsafe deterministic JIT program. */
export class JitProgramError extends PixieCoreError {
  /** Creates a JIT program failure while preserving its cause. */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'jit_program_error', options);
  }
}

/** Reports an invalid, stale, or unverifiable JIT promotion artifact. */
export class JitPromotionError extends PixieCoreError {
  /** Creates a JIT promotion failure while preserving its cause. */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'jit_promotion_error', options);
  }
}

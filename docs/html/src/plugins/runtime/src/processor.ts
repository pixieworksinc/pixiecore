/**
 * Implements processor behavior for the runtime plugin.
 */

import { elapsedMilliseconds, errorMessage } from '../../../core/component/diagnostics/index.js';
import { AgentRoleNotFoundError, ConfigurationError, MaxRetryExceededError, ToolExecutionError } from '../../../core/contracts/errors/index.js';
import type { LoggerPort } from '../../../core/contracts/logging/index.js';
import type { RuntimeProcessorServicesPort } from '../../../core/contracts/runtime/index.js';
import type { OutputValidatorPort } from '../../../core/contracts/validation/index.js';
import {
  appendToolRound,
  appendValidationRetry,
  assemblePromptMessages,
  renderPrompt,
  validateAgentRoleResult,
} from './messages.js';
import { validateProviderOutput } from './output.js';
import { OutputDecoratorPipeline } from './decorator-pipeline.js';
import { RuntimeToolExecutor } from './tool-executor.js';
import type {
  AgentRolePlugin,
  AgentRoleResult,
  Blueprint,
  DecoratorContext,
  ExecuteOptions,
  GenerateRequest,
  GenerateResponse,
  Message,
  OutputDecorator,
  Provider,
  RegisteredTool,
  ToolCall,
  ToolChoice,
  ToolDefinition,
  ToolExecutionResult,
} from '../../../core/contracts/types/index.js';

interface PreparedExecution {
  readonly blueprint: Blueprint;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly schema: Record<string, unknown>;
  readonly providerOutputValidator: OutputValidatorPort;
  readonly messages: Message[];
  readonly tools: ToolDefinition[];
  readonly toolNameMapping: Map<string, string>;
  readonly maxToolRounds: number;
  readonly usePseudoToolCalling: boolean;
  readonly toolChoice: ToolChoice | undefined;
  readonly temperature: number;
  readonly model: string | undefined;
  readonly maxTokens: number | undefined;
  readonly signal: AbortSignal | undefined;
}

interface CompiledPreparedExecution {
  readonly compiled: Record<string, unknown>;
}

interface PreparedRoleExecution {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly result: AgentRoleResult;
  readonly effectiveModel: string;
}

interface PreparedToolExecution {
  readonly tools: ToolDefinition[];
  readonly toolNameMapping: Map<string, string>;
  readonly maxToolRounds: number;
  readonly toolChoice: ToolChoice | undefined;
}

interface ExecutionProgress {
  toolRounds: number;
  requiredToolObserved: boolean;
}

/** Internal dependencies supplied by either a bootstrap scope or the legacy facade. */
export type PromptProcessorServices = RuntimeProcessorServicesPort;

type AttemptResult =
  | { readonly status: 'success'; readonly output: Record<string, unknown> }
  | { readonly status: 'retry'; readonly error: Error };

/**
 * Interprets one validated Blueprint, applies its role, tools, provider, output
 * validation, ordered decorators, and runtime-owned correction loop.
 */
export class PromptProcessor {
  readonly tools: Map<string, RegisteredTool>;
  readonly agentRoles = new Map<string, AgentRolePlugin>();
  private readonly decoratorPipeline = new OutputDecoratorPipeline();
  private readonly toolExecutor: RuntimeToolExecutor;
  /** Initializes processor services and bounded retry and tool-loop policies. */
  constructor(
    public provider: Provider,
    private readonly services: PromptProcessorServices,
    private readonly maxRetry = 3,
    private readonly maxToolRounds = 10,
    private readonly defaultTemperature = 0.7,
    private readonly defaultToolChoice?: ToolChoice,
    private readonly defaultUsePseudoToolCalling = false,
    private readonly logger?: LoggerPort,
  ) {
    this.toolExecutor = new RuntimeToolExecutor(services, logger);
    this.tools = this.toolExecutor.tools;
  }
  /** Registers or replaces a tool by its canonical public name. */
  registerTool(tool: RegisteredTool): void { this.toolExecutor.register(tool); }
  /** Registers one role implementation under every role name it supports. */
  registerAgentRole(role: AgentRolePlugin): void { for (const name of role.supportedRoles) this.agentRoles.set(name, role); }
  /** Registers an output decorator with stable priority and insertion ordering. */
  registerDecorator(decorator: OutputDecorator, priority = decorator.priority ?? 100): void {
    this.decoratorPipeline.register(decorator, priority);
  }
  /**
   * Executes one Blueprint and retries only provider output-validation failures.
   *
   * @param blueprint - Prepared Blueprint contract to interpret.
   * @param inputs - Validated business inputs and authorization context.
   * @param options - Per-call model, message, and cancellation overrides.
   * @returns Validated and decorated structured output.
   */
  async execute(
    blueprint: Blueprint,
    inputs: Record<string, unknown>,
    options: ExecuteOptions = {},
  ): Promise<Record<string, unknown>> {
    options.signal?.throwIfAborted();
    const execution = await this.prepareExecution(blueprint, inputs, options);
    if ('compiled' in execution) return execution.compiled;
    execution.signal?.throwIfAborted();
    const progress: ExecutionProgress = {
      toolRounds: 0,
      requiredToolObserved: false,
    };
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.maxRetry + 1; attempt++) {
      execution.signal?.throwIfAborted();
      const result = await this.runAttempt(execution, attempt, progress);
      if (result.status === 'success') return result.output;
      lastError = result.error;
      if (this.logger && attempt <= this.maxRetry) {
        this.services.logging.logExecutionRetry(
          'runtime',
          'output_validation',
          attempt,
          this.logger,
        );
      }
    }
    throw new MaxRetryExceededError(
      `Maximum retries exceeded: ${lastError?.message ?? 'invalid output'}`,
    );
  }

  /** Resolves schema, role, optional JIT execution, messages, tools, and model. */
  private async prepareExecution(
    blueprint: Blueprint,
    inputs: Record<string, unknown>,
    options: ExecuteOptions,
  ): Promise<PreparedExecution | CompiledPreparedExecution> {
    const schema = typeof blueprint.output_schema === 'string' ? JSON.parse(blueprint.output_schema) : blueprint.output_schema;
    const providerOutputValidator = this.services.validation.createOutputValidator(schema);
    const role = await this.prepareRoleExecution(blueprint, inputs, schema, options.signal);
    const compiled = await this.tryCompiledExecution(
      blueprint,
      role.inputs,
      schema,
      providerOutputValidator,
      role.effectiveModel,
      options.signal,
    );
    if (compiled) return compiled;

    const messages = assemblePromptMessages(
      role.result,
      blueprint,
      role.inputs,
      options.messages ?? [],
      this.provider,
      this.services.multimodal,
    );
    const toolExecution = this.prepareToolExecution(blueprint, options);
    return {
      blueprint,
      inputs: role.inputs,
      schema,
      providerOutputValidator,
      messages,
      ...toolExecution,
      usePseudoToolCalling: options.usePseudoToolCalling ?? this.defaultUsePseudoToolCalling,
      temperature: typeof blueprint.temperature === 'number'
        ? blueprint.temperature
        : role.result.temperature ?? this.defaultTemperature,
      model: typeof blueprint.model === 'string' ? blueprint.model : role.result.model,
      maxTokens: options.maxTokens,
      signal: options.signal,
    };
  }

  /**
   * Prepares role execution according to the PromptProcessor contract.
   */
  private async prepareRoleExecution(
    blueprint: Blueprint,
    inputs: Readonly<Record<string, unknown>>,
    schema: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<PreparedRoleExecution> {
    const role = this.agentRoles.get(blueprint.role);
    if (!role) throw new AgentRoleNotFoundError(`No agent role plugin found for role: ${blueprint.role}`);
    const preContext = await this.decoratorPipeline.apply('before', {
      blueprint,
      inputs,
      schema,
      provider: this.provider,
      attempt: 1,
    });
    signal?.throwIfAborted();
    const effectiveInputs = { ...preContext.inputs };
    const prompt = renderPrompt(blueprint.prompt, effectiveInputs);
    const roleResult = await role.apply(prompt, blueprint, effectiveInputs);
    signal?.throwIfAborted();
    validateAgentRoleResult(roleResult, blueprint.role);
    const effectiveModel = typeof blueprint.model === 'string'
      ? blueprint.model
      : roleResult.model ?? this.provider.model;
    return { inputs: effectiveInputs, result: roleResult, effectiveModel };
  }

  /**
   * Handles try compiled execution according to the PromptProcessor contract.
   */
  private async tryCompiledExecution(
    blueprint: Blueprint,
    inputs: Readonly<Record<string, unknown>>,
    schema: Record<string, unknown>,
    providerOutputValidator: OutputValidatorPort,
    effectiveModel: string,
    signal?: AbortSignal,
  ): Promise<CompiledPreparedExecution | undefined> {
    const compiled = await this.services.jit?.execute(
      blueprint,
      inputs,
      effectiveModel,
    );
    signal?.throwIfAborted();
    if (!compiled) return undefined;

    let context: DecoratorContext = {
      blueprint,
      inputs,
      schema,
      provider: this.provider,
      attempt: 1,
      output: providerOutputValidator.validate(compiled.output),
    };
    context = await this.decoratorPipeline.apply('after', context);
    this.logOutputValidation(true);
    return { compiled: context.output as Record<string, unknown> };
  }

  /**
   * Prepares tool execution according to the PromptProcessor contract.
   */
  private prepareToolExecution(
    blueprint: Blueprint,
    options: ExecuteOptions,
  ): PreparedToolExecution {
    const configuredTools = blueprint.tools;
    const selected = configuredTools?.length
      ? [...this.tools.values()].filter(tool => configuredTools.includes(tool.name))
      : [...this.tools.values()];
    const { tools, mapping } = this.services.tools.sanitizeToolNames(
      selected.map(({ execute: _, ...definition }) => definition),
    );
    const maxToolRounds = options.maxToolRounds ?? this.maxToolRounds;
    const toolChoice = options.toolChoice ?? this.defaultToolChoice;
    this.validateToolConfiguration(tools, maxToolRounds, toolChoice);
    return { tools, toolNameMapping: mapping, maxToolRounds, toolChoice };
  }

  /**
   * Validates tool configuration and rejects unsupported state.
   */
  private validateToolConfiguration(
    tools: readonly ToolDefinition[],
    maxToolRounds: number,
    toolChoice: ToolChoice | undefined,
  ): void {
    if (!Number.isSafeInteger(maxToolRounds) || maxToolRounds < 0) {
      throw new ConfigurationError('maxToolRounds must be a non-negative integer');
    }
    if (toolChoice !== 'required') return;
    if (tools.length === 0) {
      throw new ConfigurationError('toolChoice "required" needs at least one available tool');
    }
    if (maxToolRounds === 0) {
      throw new ConfigurationError('toolChoice "required" needs maxToolRounds greater than zero');
    }
  }

  /**
   * Executes attempt through the PromptProcessor boundary.
   */
  private async runAttempt(
    execution: PreparedExecution,
    attempt: number,
    progress: ExecutionProgress,
  ): Promise<AttemptResult> {
    while (true) {
      execution.signal?.throwIfAborted();
      const request = this.buildRequest(execution, progress);
      const response = await this.generate(request);
      execution.signal?.throwIfAborted();
      const providerCalls = response.toolCalls ?? [];
      if (providerCalls.length) {
        progress.requiredToolObserved = true;
        await this.runToolRound(execution, response, providerCalls, progress);
        continue;
      }
      this.assertRequiredToolObserved(execution, progress);
      return this.validateAttempt(execution, request, response, attempt);
    }
  }

  /**
   * Validates required tool observed and rejects unsupported state.
   */
  private assertRequiredToolObserved(
    execution: PreparedExecution,
    progress: ExecutionProgress,
  ): void {
    if (execution.toolChoice !== 'required' || progress.requiredToolObserved) return;
    throw new ToolExecutionError(
      'Provider returned no tool call while toolChoice was required',
    );
  }

  /**
   * Executes tool round through the PromptProcessor boundary.
   */
  private async runToolRound(
    execution: PreparedExecution,
    response: GenerateResponse,
    providerCalls: readonly ToolCall[],
    progress: ExecutionProgress,
  ): Promise<void> {
    if (progress.toolRounds >= execution.maxToolRounds) {
      throw new ToolExecutionError(
        `Exceeded maximum tool call rounds (${execution.maxToolRounds})`,
      );
    }
    const calls = this.services.tools.convertToolCallNames(
      [...providerCalls],
      execution.toolNameMapping,
    );
    const results = await this.toolExecutor.executeCalls(calls);
    execution.signal?.throwIfAborted();
    appendToolRound(
      execution.messages,
      response.content ?? '',
      providerCalls,
      results,
      execution.usePseudoToolCalling,
    );
    progress.toolRounds++;
  }

  /**
   * Creates request according to the PromptProcessor contract.
   */
  private buildRequest(
    execution: PreparedExecution,
    progress: ExecutionProgress,
  ): GenerateRequest {
    const toolChoice = execution.toolChoice === 'required' && progress.requiredToolObserved
      ? 'auto'
      : execution.toolChoice;
    return {
      messages: execution.messages,
      schema: execution.schema,
      tools: execution.tools,
      temperature: execution.temperature,
      ...(execution.tools.length && toolChoice
        ? { toolChoice }
        : {}),
      ...(typeof execution.model === 'string' ? { model: execution.model } : {}),
      ...(typeof execution.maxTokens === 'number' ? { maxTokens: execution.maxTokens } : {}),
      ...(execution.signal ? { signal: execution.signal } : {}),
    };
  }

  /**
   * Validates attempt and rejects unsupported state.
   */
  private async validateAttempt(
    execution: PreparedExecution,
    request: GenerateRequest,
    response: GenerateResponse,
    attempt: number,
  ): Promise<AttemptResult> {
    try {
      const output = await this.validateResponse(execution, request, response, attempt);
      return { status: 'success', output };
    } catch (error) {
      execution.signal?.throwIfAborted();
      const validationError = error as Error;
      this.logOutputValidation(false, validationError.message);
      appendValidationRetry(
        execution.messages,
        response.content ?? '',
        validationError.message,
      );
      return { status: 'retry', error: validationError };
    }
  }

  /**
   * Creates the requested operation according to the PromptProcessor contract.
   */
  private async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const providerModel = request.model ?? this.provider.model;
    const started = performance.now();
    if (this.logger) {
      this.services.logging.logLlmRequest(
        this.provider.name,
        providerModel,
        request,
        this.logger,
      );
    }
    try {
      const response = await this.provider.generate(request);
      if (this.logger) {
        this.services.logging.logLlmResponse(
          this.provider.name,
          providerModel,
          response,
          elapsedMilliseconds(started),
          this.logger,
        );
      }
      return response;
    } catch (error) {
      if (this.logger) {
        this.services.logging.logLlmResponse(
          this.provider.name,
          providerModel,
          { error: errorMessage(error) },
          elapsedMilliseconds(started),
          this.logger,
        );
      }
      throw error;
    }
  }

  /**
   * Validates response and rejects unsupported state.
   */
  private async validateResponse(
    execution: PreparedExecution,
    request: GenerateRequest,
    response: GenerateResponse,
    attempt: number,
  ): Promise<Record<string, unknown>> {
    let context: DecoratorContext = {
      blueprint: execution.blueprint,
      inputs: execution.inputs,
      schema: execution.schema,
      provider: this.provider,
      request,
      attempt,
      output: validateProviderOutput(
        execution.providerOutputValidator,
        response.content ?? '',
      ),
    };
    context = await this.decoratorPipeline.apply('after', context);
    this.logOutputValidation(true);
    return context.output as Record<string, unknown>;
  }

  /**
   * Records output validation according to the PromptProcessor contract.
   */
  private logOutputValidation(success: boolean, error?: string): void {
    if (!this.logger) return;
    this.services.logging.logValidationResult(
      'output_schema',
      success,
      error,
      this.logger,
    );
  }

  /**
   * Executes tool through the PromptProcessor boundary.
   */
  async executeTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.toolExecutor.execute(name, args);
  }

  /**
   * Executes tool calls through the PromptProcessor boundary.
   */
  async executeToolCalls(calls: readonly ToolCall[]): Promise<ToolExecutionResult[]> {
    return this.toolExecutor.executeCalls(calls);
  }
}

/**
 * Coordinates runtime responsibilities inside the PixieCore kernel.
 */

import {
  activateCorePluginRoots,
  getRegisteredDecorators,
  PluginManager,
  resolvePluginService,
} from '../plugin/manager.js';
import { McpManager } from '../../../plugins/mcp/mcp.js';
import { PromptProcessor, createScopedPromptProcessor } from '../processor/index.js';
import { getConfig, getLoggingConfig, getRuntimeEnvironment, type RuntimeConfig } from '../config/index.js';
import { ConfigurationError } from '../../contracts/errors/index.js';
import { elapsedMilliseconds, errorMessage } from '../../component/diagnostics/index.js';
import {
  PixieCoreLogger,
  adaptLoggerPort,
} from '../../../plugins/logging/logging.js';
import type { LoggingConfig } from '../../../plugins/logging/logging.js';
import { RUNTIME_SERVICE } from '../../contracts/plugin/services.js';
import { JIT_SERVICE } from '../../contracts/plugin/services.js';
import type { RuntimeServicePort } from '../../contracts/runtime/index.js';
import type { ValidationServicePort } from '../../contracts/validation/index.js';
import type { Blueprint, ExecuteOptions, GenerateRequest, GenerateResponse, Provider, RegisteredTool, RuntimeOptions } from '../../contracts/types/index.js';
import { BlueprintPreparationCache } from '../blueprint/preparation-cache.js';

type RuntimeLifecycleState = 'open' | 'closing' | 'closed';
const preparationCacheByRuntime = new WeakMap<PromptRuntime, BlueprintPreparationCache>();

/** Internal value-free measurement seam; not exported from the package root. */
export function runtimePreparationCacheSnapshot(
  runtime: PromptRuntime,
) {
  const cache = preparationCacheByRuntime.get(runtime);
  if (!cache) throw new TypeError('PromptRuntime preparation cache is unavailable');
  return cache.snapshot();
}

/**
 * Composes plugin discovery, provider selection, validation, tools, MCP, and
 * execution lifecycle behind PixieCore's primary runtime facade.
 *
 * A runtime accepts new work only while open. Closing waits for in-flight
 * executions, releases owned resources once, and rejects subsequent work.
 */
export class PromptRuntime {
  readonly pluginManager: PluginManager;
  readonly mcpManager: McpManager;
  readonly processor: PromptProcessor;
  readonly config: RuntimeConfig;
  readonly environment: NodeJS.ProcessEnv;
  readonly loggingConfig: LoggingConfig;
  readonly logger: PixieCoreLogger;
  private readonly runtimeService: RuntimeServicePort;
  private currentProvider: Provider;
  private readonly providerWasInjected: boolean;
  private readonly loggerWasInjected: boolean;
  private readonly explicitTools = new Map<string, RegisteredTool>();
  private readonly blueprintCache = new BlueprintPreparationCache();
  private ready?: Promise<void>;
  private lifecycleState: RuntimeLifecycleState = 'open';
  private activeExecutions = 0;
  private executionsDrained: Promise<void> | undefined;
  private resolveExecutionsDrained: (() => void) | undefined;
  private closePromise: Promise<void> | undefined;
  private closeFinished = false;

  /**
   * Creates a lazy runtime scope without performing network or filesystem I/O.
   *
   * @param options - Provider, plugin, logging, MCP, and execution overrides.
   */
  constructor(public readonly options: RuntimeOptions = {}) {
    const promotionsPath = normalizePromotionsPath(options.promotionsPath);
    this.environment = getRuntimeEnvironment(options.environment);
    this.config = getConfig(options, this.environment);
    this.loggerWasInjected = options.logger !== undefined;
    const injectedLogger = options.logger ? adaptLoggerPort(options.logger) : undefined;
    this.loggingConfig = injectedLogger?.config ?? getLoggingConfig(options, this.environment);
    this.logger = injectedLogger ?? new PixieCoreLogger(this.loggingConfig);
    this.pluginManager = new PluginManager(options.pluginsDir, this.environment, options);
    activateCorePluginRoots(
      this.pluginManager,
      promotionsPath
        ? ['pixiecore.runtime', 'pixiecore.jit']
        : 'pixiecore.runtime',
    );
    this.runtimeService = resolvePluginService(this.pluginManager, RUNTIME_SERVICE);
    preparationCacheByRuntime.set(this, this.blueprintCache);
    this.mcpManager = this.runtimeService.mcp.createManager({
      environment: this.environment,
    }) as McpManager;
    this.providerWasInjected = typeof options.provider === 'object';
    this.currentProvider = this.providerWasInjected
      ? options.provider as Provider
      : new DeferredProvider(this.config.provider, this.config.model ?? 'uninitialized');
    const processorServices = promotionsPath
      ? {
          ...this.runtimeService.processorServices,
          jit: resolvePluginService(this.pluginManager, JIT_SERVICE).createExecutor({
            promotionsPath,
            onEvent: event => {
              this.logger.audit('Deterministic execution decision', {
                step: 'jit_execution',
                event: event.outcome,
                blueprint: event.blueprint,
                blueprint_version: event.version,
                model: event.model,
                ...(event.outcome === 'compiled'
                  ? { artifact: event.artifact }
                  : { reason: event.reason }),
              });
              try { options.onJitEvent?.(event); } catch { /* Observation is non-authoritative. */ }
            },
          }),
        }
      : this.runtimeService.processorServices;
    this.processor = createScopedPromptProcessor(
      processorServices,
      this.currentProvider,
      this.config.maxRetry,
      this.config.maxToolRounds,
      this.config.temperature,
      this.config.toolChoice,
      this.config.usePseudoToolCalling,
      this.logger,
    );
  }
  /** Returns the injected or lazily selected provider. */
  get provider(): Provider { return this.currentProvider; }
  /** Returns the stable name of the active provider. */
  get providerName(): string { return this.currentProvider.name; }
  /** Returns the model selected by the active provider. */
  get model(): string { return this.currentProvider.model; }
  /**
   * Registers an application-owned tool before runtime closure.
   *
   * @param tool - Validated tool definition to expose during generation.
   * @returns This runtime for fluent registration.
   */
  registerTool(tool: RegisteredTool): this {
    this.assertOpen();
    this.explicitTools.set(tool.name, tool);
    this.processor.registerTool(tool);
    return this;
  }

  /** Starts the shared lazy initialization once and returns its promise. */
  private initialize(): Promise<void> {
    if (this.lifecycleState === 'closed') {
      return Promise.reject(new ConfigurationError('PromptRuntime is closed'));
    }
    this.ready ??= this.initializeResources();
    return this.ready;
  }

  /** Loads plugins, registers contributions, and initializes external adapters. */
  private async initializeResources(): Promise<void> {
    await this.pluginManager.load();
    this.registerPluginComponents();
    await this.initializeProvider();
    await this.initializeMcpTools();
  }

  /**
   * Registers plugin components with the PromptRuntime.
   */
  private registerPluginComponents(): void {
    for (const role of new Set(this.pluginManager.agentRoles.values())) this.processor.registerAgentRole(role);
    for (const { decorator, effectivePriority } of getRegisteredDecorators(this.pluginManager)) {
      this.processor.registerDecorator(decorator, effectivePriority);
    }
    for (const tool of this.pluginManager.tools.values()) this.processor.registerTool(tool);
    for (const tool of this.explicitTools.values()) this.processor.registerTool(tool);
  }

  /** Creates the configured provider unless the application injected one. */
  private async initializeProvider(): Promise<void> {
    if (this.providerWasInjected) return;
    this.currentProvider = await this.pluginManager.createProvider(this.config.provider, {
      ...this.options,
      environment: this.environment,
      provider: this.config.provider,
      ...(this.config.model ? { model: this.config.model } : {}),
      requestTimeout: this.config.requestTimeout,
    });
    this.processor.provider = this.currentProvider;
  }

  /** Discovers MCP tools unless MCP loading was explicitly disabled. */
  private async initializeMcpTools(): Promise<void> {
    if (this.options.mcpConfigPath === 'disabled') return;
    const tools = await this.mcpManager.load(this.options.mcpConfigPath);
    for (const tool of tools) this.processor.registerTool(tool);
  }

  /**
   * Loads and executes a Blueprint file under one trace and execution lease.
   *
   * @param path - Blueprint YAML file to load through the preparation cache.
   * @param inputs - Caller-owned values bound to the Blueprint contract.
   * @param options - Per-execution model and cancellation overrides.
   * @returns The validated structured result.
   */
  async execute(path: string, inputs: Record<string, unknown> = {}, options: ExecuteOptions = {}): Promise<Record<string, unknown>> {
    const validator = this.runtimeService.processorServices.validation
      .createBlueprintValidator();
    return this.executeWithBlueprint(
      () => this.blueprintCache.loadFile(path, validator),
      inputs,
      options,
    );
  }

  /**
   * Parses and executes in-memory Blueprint YAML without writing it to disk.
   *
   * @param yaml - Complete Blueprint YAML source.
   * @param inputs - Caller-owned values bound to the Blueprint contract.
   * @param options - Per-execution model and cancellation overrides.
   * @returns The validated structured result.
   */
  async executeYaml(yaml: string, inputs: Record<string, unknown> = {}, options: ExecuteOptions = {}): Promise<Record<string, unknown>> {
    const validator = this.runtimeService.processorServices.validation
      .createBlueprintValidator();
    return this.executeWithBlueprint(
      () => this.blueprintCache.loadYaml(yaml, validator),
      inputs,
      options,
    );
  }

  /** Loads a Blueprint inside the shared lease, trace, and failure logging boundary. */
  private executeWithBlueprint(
    loadBlueprint: () => Blueprint | Promise<Blueprint>,
    inputs: Record<string, unknown>,
    options: ExecuteOptions,
  ): Promise<Record<string, unknown>> {
    return this.withExecutionLease(() => this.withTrace(async () => {
      const started = performance.now();
      try {
        await this.initialize();
        const blueprint = await loadBlueprint();
        this.runtimeService.processorServices.logging.logValidationResult(
          'blueprint',
          true,
          undefined,
          this.logger,
        );
        return this.executeBlueprint(blueprint, inputs, options, started);
      } catch (error) {
        const message = errorMessage(error);
        this.runtimeService.processorServices.logging.logValidationResult(
          'blueprint',
          false,
          message,
          this.logger,
        );
        this.runtimeService.processorServices.logging.logExecutionComplete(
          'failed',
          { error: message },
          elapsedMilliseconds(started),
          1,
          this.logger,
        );
        throw error;
      }
    }));
  }

  /** Validates inputs, delegates generation, validates output, and records completion. */
  private async executeBlueprint(
    blueprint: Blueprint,
    inputs: Record<string, unknown>,
    options: ExecuteOptions,
    started: number,
  ): Promise<Record<string, unknown>> {
    this.runtimeService.processorServices.logging.logExecutionStart(
      blueprint.name,
      inputs,
      this.logger,
    );
    let validated: Record<string, unknown>;
    try {
      validated = validateRuntimeInputs(
        blueprint,
        inputs,
        this.config.strictValidation,
        this.runtimeService.processorServices.validation,
      );
      this.runtimeService.processorServices.logging.logValidationResult(
        'input',
        true,
        undefined,
        this.logger,
      );
    } catch (error) {
      this.runtimeService.processorServices.logging.logValidationResult(
        'input',
        false,
        errorMessage(error),
        this.logger,
      );
      this.runtimeService.processorServices.logging.logExecutionComplete(
        'failed',
        { error: errorMessage(error) },
        elapsedMilliseconds(started),
        1,
        this.logger,
      );
      throw error;
    }
    try {
      const result = await this.processor.execute(blueprint, validated, {
        ...(options.messages ? { messages: options.messages } : {}),
        ...(options.toolChoice ? { toolChoice: options.toolChoice } : {}),
        ...(typeof options.maxToolRounds === 'number' ? { maxToolRounds: options.maxToolRounds } : {}),
        ...(typeof options.usePseudoToolCalling === 'boolean' ? { usePseudoToolCalling: options.usePseudoToolCalling } : {}),
        ...(typeof options.maxTokens === 'number' ? { maxTokens: options.maxTokens } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      this.runtimeService.processorServices.logging.logExecutionComplete(
        'success',
        result,
        elapsedMilliseconds(started),
        0,
        this.logger,
      );
      return result;
    } catch (error) {
      this.runtimeService.processorServices.logging.logExecutionComplete(
        'failed',
        { error: errorMessage(error) },
        elapsedMilliseconds(started),
        1,
        this.logger,
      );
      throw error;
    }
  }
  /**
   * Stops accepting work, drains active executions, and closes owned resources.
   *
   * Repeated calls share the same close operation.
   */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.closeFinished) return Promise.resolve();
    this.lifecycleState = 'closing';
    const closing = this.closeResources();
    this.closePromise = closing;
    void closing.then(
      () => { this.finishClose(); },
      () => { this.finishClose(); },
    );
    return closing;
  }

  /** Closes MCP, plugins, and application-owned provider and logger resources. */
  private async closeResources(): Promise<void> {
    await this.waitForActiveExecutions();
    this.blueprintCache.clear();
    await this.ready?.catch(() => undefined);
    const tasks: Array<Promise<void>> = [
      Promise.resolve().then(() => this.mcpManager.close()),
      Promise.resolve().then(() => this.pluginManager.close()),
    ];
    const provider = this.currentProvider;
    if (this.providerWasInjected && provider.close) {
      tasks.push(Promise.resolve().then(() => provider.close!()));
    }
    if (!this.loggerWasInjected) {
      tasks.push(Promise.resolve().then(() => this.logger.close()));
    }
    const results = await Promise.allSettled(tasks);
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Failed to close one or more runtime resources');
  }
  /** Releases runtime resources through JavaScript asynchronous disposal. */
  async [Symbol.asyncDispose](): Promise<void> { await this.close(); }

  /** Reuses the current trace or creates one for an otherwise unscoped task. */
  private withTrace<T>(task: () => Promise<T>): Promise<T> {
    const logging = this.runtimeService.processorServices.logging;
    return logging.getTraceId() === 'no-trace'
      ? logging.runWithTraceId(logging.generateTraceId(), task)
      : task();
  }

  /** Holds an execution lease until a synchronous or asynchronous task settles. */
  private withExecutionLease<T>(task: () => Promise<T>): Promise<T> {
    const release = this.acquireExecutionLease();
    try {
      return task().finally(release);
    } catch (error) {
      release();
      return Promise.reject(error);
    }
  }

  /** Acquires an idempotently releasable lease and rejects closing runtimes. */
  private acquireExecutionLease(): () => void {
    this.assertOpen();
    this.activeExecutions++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeExecutions--;
      if (this.activeExecutions === 0) this.resolveExecutionsDrained?.();
    };
  }

  /** Resolves immediately when idle or after the final execution lease releases. */
  private waitForActiveExecutions(): Promise<void> {
    if (this.activeExecutions === 0) return Promise.resolve();
    this.executionsDrained ??= new Promise<void>(resolve => {
      this.resolveExecutionsDrained = resolve;
    });
    return this.executionsDrained;
  }

  /** Commits the terminal closed state after cleanup succeeds or fails. */
  private finishClose(): void {
    this.lifecycleState = 'closed';
    this.closeFinished = true;
    this.closePromise = undefined;
  }

  /**
   * Validates open and rejects unsupported state.
   */
  private assertOpen(): void {
    if (this.lifecycleState !== 'open') {
      throw new ConfigurationError('PromptRuntime is closed');
    }
  }
}

function normalizePromotionsPath(value: RuntimeOptions['promotionsPath']): string | undefined {
  if (value === undefined || value === null || value === 'disabled') return undefined;
  if (value.trim() === '') throw new ConfigurationError('promotionsPath must be a non-blank string');
  return value;
}

const AUTH_CONTEXT_KEYS = new Set(['user_role', 'user_id', 'user_scopes']);

function validateRuntimeInputs(
  blueprint: Blueprint,
  inputs: Record<string, unknown>,
  strict: boolean,
  validation: ValidationServicePort,
): Record<string, unknown> {
  const hasPlaceholders = Boolean(blueprint.input_placeholders?.length);
  const hasInputSchema = blueprint.input_schema !== undefined;
  if (!blueprint.permissions || (!hasPlaceholders && !hasInputSchema)) {
    return validateBusinessInputs(blueprint, inputs, strict, validation);
  }
  const declared = declaredInputNames(blueprint);
  const validationInputs = Object.fromEntries(Object.entries(inputs).filter(([name]) => !AUTH_CONTEXT_KEYS.has(name) || declared.has(name)));
  const authContext = Object.fromEntries(Object.entries(inputs).filter(([name]) => AUTH_CONTEXT_KEYS.has(name) && !declared.has(name)));
  return {
    ...authContext,
    ...validateBusinessInputs(blueprint, validationInputs, strict, validation),
  };
}

function validateBusinessInputs(
  blueprint: Blueprint,
  inputs: Record<string, unknown>,
  strict: boolean,
  validation: ValidationServicePort,
): Record<string, unknown> {
  const normalized = validation.createInputValidator(blueprint.input_placeholders, strict)
    .validate(inputs);
  return blueprint.input_schema === undefined
    ? normalized
    : validation.createInputSchemaValidator(blueprint.input_schema).validate(normalized);
}

function declaredInputNames(blueprint: Blueprint): Set<string> {
  const names = new Set(
    blueprint.input_placeholders?.map(item => typeof item === 'string' ? item : item.name) ?? [],
  );
  if (blueprint.input_schema === undefined) return names;
  const schema = typeof blueprint.input_schema === 'string'
    ? JSON.parse(blueprint.input_schema) as Record<string, unknown>
    : blueprint.input_schema;
  if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
    return names;
  }
  for (const name of Object.keys(schema.properties)) names.add(name);
  return names;
}

/**
 * Provides deferred operations through a stable contract.
 */
class DeferredProvider implements Provider {
  readonly supportsTools = false;
  readonly supportsMultimodal = false;
  /**
   * Creates a DeferredProvider and establishes its initial state.
   */
  constructor(readonly name: string, readonly model: string) {}
  /**
   * Reports whether the provider accepts visual content.
   */
  supportsVision(): boolean { return false; }
  /**
   * Reports whether the provider accepts file attachments.
   */
  supportsFileInput(): boolean { return false; }
  /**
   * Returns model list from the DeferredProvider state.
   */
  async getModelList(): Promise<string[]> { throw new ConfigurationError(`Provider ${this.name} is not initialized`); }
  /**
   * Creates the requested operation according to the DeferredProvider contract.
   */
  async generate(_request: GenerateRequest): Promise<GenerateResponse> { throw new ConfigurationError(`Provider ${this.name} is not initialized`); }
}

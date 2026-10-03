/**
 * Coordinates processor responsibilities inside the PixieCore kernel.
 */

import type {
  AgentRolePlugin,
  Blueprint,
  ExecuteOptions,
  OutputDecorator,
  Provider,
  RegisteredTool,
  ToolCall,
  ToolChoice,
  ToolExecutionResult,
} from '../../contracts/types/index.js';
import { PromptProcessor as RuntimePromptProcessor } from '../../../plugins/runtime/runtime.js';
import { createLoggingService } from '../../../plugins/logging/logging.js';
import { createMultimodalService } from '../../../plugins/multimodal/multimodal.js';
import { createToolService } from '../../../plugins/tools/tools.js';
import { createValidationService } from '../../../plugins/validation/validation.js';
import type { RuntimeProcessorServicesPort } from '../../contracts/runtime/index.js';
import type { PixieCoreLogger } from '../../../plugins/logging/logging.js';

const SCOPED_PROCESSOR_SERVICES = Symbol('pixiecore.processor.services');

interface ScopedProcessorServices {
  readonly [SCOPED_PROCESSOR_SERVICES]: true;
  readonly value: RuntimeProcessorServicesPort;
}

/**
 * Public processor facade that delegates execution to the runtime plugin.
 *
 * The facade owns no interpretation policy. It keeps the package boundary
 * stable while allowing the runtime implementation to evolve independently.
 */
export class PromptProcessor {
  private readonly implementation: RuntimePromptProcessor;

  /** Creates a processor with default service implementations. */
  constructor(
    provider: Provider,
    maxRetry?: number,
    maxToolRounds?: number,
    defaultTemperature?: number,
    defaultToolChoice?: ToolChoice,
    defaultUsePseudoToolCalling?: boolean,
    logger?: PixieCoreLogger,
  );

  /** Initializes a processor with either default or scope-local services. */
  constructor(
    provider: Provider,
    maxRetry = 3,
    maxToolRounds = 10,
    defaultTemperature = 0.7,
    defaultToolChoice?: ToolChoice,
    defaultUsePseudoToolCalling = false,
    logger?: PixieCoreLogger,
    scopedServices?: ScopedProcessorServices,
  ) {
    const services = scopedServices?.[SCOPED_PROCESSOR_SERVICES]
      ? scopedServices.value
      : {
          logging: createLoggingService(),
          validation: createValidationService(),
          multimodal: createMultimodalService(),
          tools: createToolService(),
        };
    this.implementation = new RuntimePromptProcessor(
      provider,
      services,
      maxRetry,
      maxToolRounds,
      defaultTemperature,
      defaultToolChoice,
      defaultUsePseudoToolCalling,
      logger,
    );
  }

  /** Returns the provider currently used for generation. */
  get provider(): Provider { return this.implementation.provider; }

  /** Replaces the generation provider for subsequent executions. */
  set provider(provider: Provider) { this.implementation.provider = provider; }

  /** Returns the processor-owned tool registry. */
  get tools(): Map<string, RegisteredTool> { return this.implementation.tools; }

  /** Returns the processor-owned role registry. */
  get agentRoles(): Map<string, AgentRolePlugin> { return this.implementation.agentRoles; }

  /** Registers or replaces a tool by its canonical public name. */
  registerTool(tool: RegisteredTool): void { this.implementation.registerTool(tool); }

  /** Registers one role implementation under every role name it supports. */
  registerAgentRole(role: AgentRolePlugin): void {
    this.implementation.registerAgentRole(role);
  }

  /** Registers an output decorator with stable execution ordering. */
  registerDecorator(decorator: OutputDecorator, priority = decorator.priority ?? 100): void {
    this.implementation.registerDecorator(decorator, priority);
  }

  /** Executes one Blueprint through the composed runtime implementation. */
  execute(
    blueprint: Blueprint,
    inputs: Record<string, unknown>,
    options: ExecuteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.implementation.execute(blueprint, inputs, options);
  }

  /** Executes one registered tool. */
  executeTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.implementation.executeTool(name, args);
  }

  /** Executes tool calls and preserves provider call identifiers. */
  executeToolCalls(calls: readonly ToolCall[]): Promise<ToolExecutionResult[]> {
    return this.implementation.executeToolCalls(calls);
  }
}

type ScopedPromptProcessorConstructor = new(
  provider: Provider,
  maxRetry: number,
  maxToolRounds: number,
  defaultTemperature: number,
  defaultToolChoice: ToolChoice | undefined,
  defaultUsePseudoToolCalling: boolean,
  logger: PixieCoreLogger | undefined,
  services: ScopedProcessorServices,
) => PromptProcessor;

/** Creates a public facade backed by bootstrap scope-local services. */
export function createScopedPromptProcessor(
  services: RuntimeProcessorServicesPort,
  provider: Provider,
  maxRetry: number,
  maxToolRounds: number,
  defaultTemperature: number,
  defaultToolChoice: ToolChoice | undefined,
  defaultUsePseudoToolCalling: boolean,
  logger: PixieCoreLogger | undefined,
): PromptProcessor {
  const ScopedPromptProcessor = PromptProcessor as unknown as ScopedPromptProcessorConstructor;
  return new ScopedPromptProcessor(
    provider,
    maxRetry,
    maxToolRounds,
    defaultTemperature,
    defaultToolChoice,
    defaultUsePseudoToolCalling,
    logger,
    {
      [SCOPED_PROCESSOR_SERVICES]: true,
      value: services,
    },
  );
}

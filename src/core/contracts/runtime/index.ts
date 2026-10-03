/**
 * Defines runtime contracts shared across PixieCore boundaries.
 */

import type { LoggingServicePort } from '../logging/index.js';
import type { McpServicePort } from '../mcp/index.js';
import type { MultimodalServicePort } from '../multimodal/index.js';
import type { ToolServicePort } from '../tools/index.js';
import type { ValidationServicePort } from '../validation/index.js';
import type { JitExecutionPort } from '../jit/index.js';

/** Processor capabilities captured from one bootstrap scope. */
export interface RuntimeProcessorServicesPort {
  readonly logging: LoggingServicePort;
  readonly validation: ValidationServicePort;
  readonly multimodal: MultimodalServicePort;
  readonly tools: ToolServicePort;
  readonly jit?: JitExecutionPort;
}

/** Stateless runtime composition supplied by the runtime core plugin. */
export interface RuntimeServicePort {
  readonly processorServices: RuntimeProcessorServicesPort;
  readonly mcp: McpServicePort;
}

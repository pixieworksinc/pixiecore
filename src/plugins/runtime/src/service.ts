/**
 * Implements service behavior for the runtime plugin.
 */

import type {
  RuntimeProcessorServicesPort,
  RuntimeServicePort,
} from '../../../core/contracts/runtime/index.js';
import type { McpServicePort } from '../../../core/contracts/mcp/index.js';

/** Creates a scope-local, stateless runtime dependency bundle. */
export function createRuntimeService(
  processorServices: RuntimeProcessorServicesPort,
  mcp: McpServicePort,
): RuntimeServicePort {
  return Object.freeze({
    processorServices: Object.freeze({ ...processorServices }),
    mcp,
  });
}

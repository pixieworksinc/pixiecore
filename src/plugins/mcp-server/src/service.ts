/**
 * Implements service behavior for the mcp server plugin.
 */

import type { McpServerServicePort } from '../../../core/contracts/mcp/server.js';
import { createPixieCoreMcpProtocolServer } from './server.js';

/** Creates an immutable server factory without constructing runtime resources. */
export function createMcpServerService(): McpServerServicePort {
  return Object.freeze({
    createServer: createPixieCoreMcpProtocolServer,
  });
}

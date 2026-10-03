/**
 * Implements service behavior for the mcp plugin.
 */

import type { McpServicePort } from '../../../core/contracts/mcp/index.js';
import type { PackageRootResolver } from '../../../core/contracts/plugin/services.js';
import { createMcpManager } from './mcp-manager.js';

/** Creates a lazy manager factory bound to one bootstrap package-root resolver. */
export function createMcpService(
  resolvePackageRoot: PackageRootResolver,
): McpServicePort {
  return Object.freeze({
    /**
     * Creates manager according to the containing class contract.
     */
    createManager(options = {}) {
      return createMcpManager(options, resolvePackageRoot);
    },
  });
}

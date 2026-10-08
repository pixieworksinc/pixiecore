/**
 * Implements constants behavior for the mcp server plugin.
 */

import { readPixieCoreVersion } from '../../../core/component/package-root/index.js';

export const PIXIECORE_MCP_SERVER_INFO = Object.freeze({
  name: 'pixiecore',
  version: readPixieCoreVersion(import.meta.url),
});

export const PIXIECORE_MCP_TOOL_NAMES = Object.freeze({
  execute: 'execute',
  executeYaml: 'execute_yaml',
});

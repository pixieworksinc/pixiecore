/**
 * Implements service behavior for the tools plugin.
 */

import type { ToolServicePort } from '../../../core/contracts/tools/index.js';
import {
  convertToolCallNames,
  makeSafeToolName,
  sanitizeToolNames,
} from './names.js';
import { createToolArgumentValidator } from './arguments.js';

/** Creates immutable tool-name capabilities without mutable shared state. */
export function createToolService(): ToolServicePort {
  const argumentValidator = createToolArgumentValidator();
  const service: ToolServicePort = {
    makeSafeToolName,
    sanitizeToolNames,
    convertToolCallNames,
    validateArguments: argumentValidator.validate,
  };
  return Object.freeze(service);
}

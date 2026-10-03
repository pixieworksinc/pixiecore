/**
 * Implements service behavior for the jit plugin.
 */

import type { JitServicePort } from '../../../core/contracts/jit/index.js';
import { runJitProgram, validateJitProgram } from './program.js';
import { createJitExecutor } from './executor.js';
import { runJitAdmission } from './admission.js';

/**
 * Creates jit service after validating the supplied contract.
 */
export function createJitService(): JitServicePort {
  return Object.freeze({
    validateProgram: validateJitProgram,
    runProgram: runJitProgram,
    createExecutor: createJitExecutor,
    admit: runJitAdmission,
  });
}

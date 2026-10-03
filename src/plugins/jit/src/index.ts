/**
 * Implements src behavior for the jit plugin.
 */

export {
  JIT_EXPRESSION_KINDS,
  runJitProgram,
  validateJitProgram,
} from './program.js';
export { createJitService } from './service.js';
export { createJitExecutor } from './executor.js';
export { JIT_ADMISSION_REPORT_SCHEMA, runJitAdmission } from './admission.js';
export {
  blueprintDigest,
  createJitPromotion,
  createJitPromotionFile,
  jitProgramDigest,
  JIT_PROMOTION_FILE_SCHEMA,
  JIT_PROMOTION_FILE_NOTE,
  readJitPromotionFile,
  validateJitPromotionFile,
  writeJitPromotionFile,
} from './promotions.js';
export type {
  JitExecutionEvent,
  JitExecutionPort,
  JitExecutorOptions,
  JitExpression,
  JitAdmissionCaseReport,
  JitAdmissionDivergence,
  JitAdmissionOptions,
  JitAdmissionRefusalReason,
  JitAdmissionReport,
  JitPromotion,
  JitPromotionEvidence,
  JitPromotionFile,
  JitProgram,
  JitProgramLimits,
  JitServicePort,
} from '../../../core/contracts/jit/index.js';

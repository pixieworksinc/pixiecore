/**
 * Coordinates jit responsibilities inside the PixieCore kernel.
 */

import type { JitAdmissionOptions, JitAdmissionReport } from '../../contracts/jit/index.js';
import type { JsonObject } from '../../contracts/types/index.js';
import { compareEvaluationOutput } from '../evaluation/comparators.js';
import {
  JIT_ADMISSION_REPORT_SCHEMA,
  JIT_EXPRESSION_KINDS,
  JIT_PROMOTION_FILE_NOTE,
  JIT_PROMOTION_FILE_SCHEMA,
  blueprintDigest,
  createJitExecutor,
  createJitPromotion,
  createJitPromotionFile,
  createJitService,
  jitProgramDigest,
  readJitPromotionFile,
  runJitAdmission as runPluginJitAdmission,
  runJitProgram,
  validateJitProgram,
  validateJitPromotionFile,
  writeJitPromotionFile,
} from '../../../plugins/jit/jit.js';
import { createValidationService } from '../../../plugins/validation/validation.js';

export {
  JIT_ADMISSION_REPORT_SCHEMA,
  JIT_EXPRESSION_KINDS,
  JIT_PROMOTION_FILE_NOTE,
  JIT_PROMOTION_FILE_SCHEMA,
  blueprintDigest,
  createJitExecutor,
  createJitPromotion,
  createJitPromotionFile,
  createJitService,
  jitProgramDigest,
  readJitPromotionFile,
  runJitProgram,
  validateJitProgram,
  validateJitPromotionFile,
  writeJitPromotionFile,
};

export type {
  JitAdmissionCaseReport,
  JitAdmissionDivergence,
  JitAdmissionDivergenceAgainst,
  JitAdmissionRefusalReason,
  JitAdmissionReport,
  JitArithmeticOperator,
  JitComparisonOperator,
  JitExecutionEvent,
  JitExecutionPort,
  JitExecutionResult,
  JitExecutorOptions,
  JitExpression,
  JitFallbackReason,
  JitProgram,
  JitProgramLimits,
  JitPromotion,
  JitPromotionEvidence,
  JitPromotionFile,
  JitRoundingMode,
  JitServicePort,
} from '../../contracts/jit/index.js';

/**
 * Configures public jit admission behavior.
 */
export type PublicJitAdmissionOptions = Omit<
  JitAdmissionOptions,
  'compareExpected' | 'validateOutput'
>;

/** Measures deterministic output against both a dataset and the configured model path. */
export function runJitAdmission(
  options: PublicJitAdmissionOptions,
): Promise<JitAdmissionReport> {
  const outputValidator = createValidationService()
    .createOutputValidator(options.blueprint.output_schema);
  return runPluginJitAdmission({
    ...options,
    compareExpected: compareEvaluationOutput,
    validateOutput: value => outputValidator.validate(value) as JsonObject,
  });
}

/**
 * Implements promotions behavior for the jit plugin.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { canonicalJson } from '../../../core/component/json-artifact/index.js';
import { JitPromotionError } from '../../../core/contracts/errors/index.js';
import type {
  JitPromotion,
  JitAdmissionReport,
  JitPromotionEvidence,
  JitPromotionFile,
  JitProgram,
} from '../../../core/contracts/jit/index.js';
import type { Blueprint } from '../../../core/contracts/types/index.js';
import { validateJitProgram } from './program.js';

export const JIT_PROMOTION_FILE_SCHEMA = 'pixiecore.jit-promotions/v1' as const;
export const JIT_PROMOTION_FILE_NOTE = 'Generated from measured agreement. Do not edit; regenerate from the dataset and model.';

/**
 * Computes the canonical digest of a Blueprint source snapshot.
 */
export function blueprintDigest(blueprint: Readonly<Blueprint>): string {
  return digest(blueprint);
}

/**
 * Computes the canonical digest of a validated JIT program.
 */
export function jitProgramDigest(program: JitProgram): string {
  return digest(validateJitProgram(program));
}

/**
 * Validates jit promotion file and rejects unsupported input.
 */
export function validateJitPromotionFile(value: unknown): JitPromotionFile {
  const root = record(value, '$');
  exactKeys(root, ['schema', 'note', 'promotions'], '$');
  if (root.schema !== JIT_PROMOTION_FILE_SCHEMA) {
    throw promotionError(`$.schema must be ${JIT_PROMOTION_FILE_SCHEMA}`);
  }
  const note = nonBlank(root.note, '$.note');
  if (!Array.isArray(root.promotions)) throw promotionError('$.promotions must be an array');

  const identities = new Set<string>();
  const promotions = root.promotions.map((item, index) => {
    const path = `$.promotions[${index}]`;
    const validated = validatePromotion(item, path);
    const identity = `${validated.blueprint}\0${validated.version}\0${validated.model}`;
    if (identities.has(identity)) throw promotionError(`${path} duplicates a Blueprint/model promotion`);
    identities.add(identity);
    return validated;
  });
  return Object.freeze({
    schema: JIT_PROMOTION_FILE_SCHEMA,
    note,
    promotions: Object.freeze(promotions),
  });
}

/**
 * Returns jit promotion file without exposing mutable internal state.
 */
export async function readJitPromotionFile(path: string): Promise<JitPromotionFile> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (cause) {
    throw promotionError(`Cannot read JIT promotion artifact: ${path}`, cause);
  }
  try {
    return validateJitPromotionFile(JSON.parse(source) as unknown);
  } catch (cause) {
    if (cause instanceof JitPromotionError) throw cause;
    throw promotionError(`JIT promotion artifact is not valid JSON: ${path}`, cause);
  }
}

/**
 * Creates jit promotion after validating the supplied contract.
 */
export function createJitPromotion(
  report: JitAdmissionReport,
  blueprint: Readonly<Blueprint>,
  program: JitProgram,
): JitPromotion {
  assertAdmissionIsPromotable(report);
  const sourceDigest = blueprintDigest(blueprint);
  assertAdmissionMatchesBlueprint(report, blueprint, sourceDigest);
  const validatedProgram = validateJitProgram(program);
  const artifactDigest = jitProgramDigest(validatedProgram);
  assertAdmissionMatchesProgram(report, artifactDigest);
  const promotion: JitPromotion = {
    blueprint: blueprint.name,
    version: blueprint.version,
    model: nonBlank(report.model, 'Admission model'),
    source_digest: sourceDigest,
    artifact_digest: artifactDigest,
    evidence: {
      dataset_digest: sha256(report.dataset.digest, 'Admission dataset digest'),
      seed: nonBlank(report.seed, 'Admission seed'),
      case_count: report.summary.case_count,
      run_count: report.summary.run_count,
      correct: report.summary.correct,
      agreed: report.summary.agreed,
      measured_at: report.measured_at,
    },
    program: validatedProgram,
  };
  return validateJitPromotionFile({
    schema: JIT_PROMOTION_FILE_SCHEMA,
    note: JIT_PROMOTION_FILE_NOTE,
    promotions: [promotion],
  }).promotions[0]!;
}

function validatePromotion(value: unknown, path: string): JitPromotion {
  const promotion = record(value, path);
  exactKeys(promotion, [
    'blueprint', 'version', 'model', 'source_digest', 'artifact_digest', 'evidence', 'program',
  ], path);
  const program = validatedProgram(promotion.program, `${path}.program`);
  const artifactDigest = sha256(promotion.artifact_digest, `${path}.artifact_digest`);
  if (jitProgramDigest(program) !== artifactDigest) {
    throw promotionError(`${path}.artifact_digest does not match program`);
  }
  return Object.freeze({
    blueprint: nonBlank(promotion.blueprint, `${path}.blueprint`),
    version: semver(promotion.version, `${path}.version`),
    model: nonBlank(promotion.model, `${path}.model`),
    source_digest: sha256(promotion.source_digest, `${path}.source_digest`),
    artifact_digest: artifactDigest,
    evidence: evidence(promotion.evidence, `${path}.evidence`),
    program,
  });
}

function validatedProgram(value: unknown, path: string): JitProgram {
  try {
    return validateJitProgram(value);
  } catch (cause) {
    throw promotionError(`${path} is invalid`, cause);
  }
}

function assertAdmissionIsPromotable(report: JitAdmissionReport): void {
  if (report.schema !== 'pixiecore.jit-admission-report/v1') {
    throw promotionError('Admission report schema is not supported');
  }
  if (!report.promoted || report.refusal_reason !== undefined) {
    throw promotionError('A refused admission report cannot create a promotion');
  }
  const summary = report.summary;
  if (summary.case_count < 1 || summary.run_count < 1
      || summary.correct !== summary.run_count || summary.agreed !== summary.run_count
      || summary.program_errors !== 0 || summary.model_errors !== 0) {
    throw promotionError('Admission report does not contain complete agreement evidence');
  }
}

function assertAdmissionMatchesBlueprint(
  report: JitAdmissionReport,
  blueprint: Readonly<Blueprint>,
  sourceDigest: string,
): void {
  if (report.blueprint.name === blueprint.name
      && report.blueprint.version === blueprint.version
      && report.blueprint.source_digest === sourceDigest) return;
  throw promotionError('Admission report does not match the Blueprint source');
}

function assertAdmissionMatchesProgram(
  report: JitAdmissionReport,
  artifactDigest: string,
): void {
  if (report.program_digest === artifactDigest) return;
  throw promotionError('Admission report does not match the deterministic program');
}

/**
 * Creates jit promotion file after validating the supplied contract.
 */
export function createJitPromotionFile(
  promotions: readonly JitPromotion[],
): JitPromotionFile {
  return validateJitPromotionFile({
    schema: JIT_PROMOTION_FILE_SCHEMA,
    note: JIT_PROMOTION_FILE_NOTE,
    promotions,
  });
}

/**
 * Writes jit promotion file for the owning PixieCore boundary.
 */
export async function writeJitPromotionFile(
  path: string,
  file: JitPromotionFile,
): Promise<void> {
  const validated = validateJitPromotionFile(file);
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, path);
  } catch (cause) {
    await unlink(temporary).catch(() => undefined);
    throw promotionError(`Cannot write JIT promotion artifact: ${path}`, cause);
  }
}

/**
 * Handles promotion file identity for the owning PixieCore boundary.
 */
export async function promotionFileIdentity(path: string): Promise<string> {
  const value = await stat(path, { bigint: true });
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs]
    .map(item => item.toString())
    .join(':');
}

function evidence(value: unknown, path: string): JitPromotionEvidence {
  const item = record(value, path);
  exactKeys(item, [
    'dataset_digest', 'seed', 'case_count', 'run_count', 'correct', 'agreed', 'measured_at',
  ], path);
  const caseCount = integer(item.case_count, `${path}.case_count`, 1);
  const runCount = integer(item.run_count, `${path}.run_count`, 1);
  const correct = integer(item.correct, `${path}.correct`, 0);
  const agreed = integer(item.agreed, `${path}.agreed`, 0);
  if (correct > runCount || agreed > runCount) {
    throw promotionError(`${path} counts must not exceed run_count`);
  }
  if (correct !== runCount || agreed !== runCount) {
    throw promotionError(`${path} does not contain complete agreement evidence`);
  }
  const measuredAt = nonBlank(item.measured_at, `${path}.measured_at`);
  const parsed = new Date(measuredAt);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(measuredAt)
      || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== measuredAt) {
    throw promotionError(`${path}.measured_at must be a canonical UTC timestamp`);
  }
  return Object.freeze({
    dataset_digest: sha256(item.dataset_digest, `${path}.dataset_digest`),
    seed: nonBlank(item.seed, `${path}.seed`),
    case_count: caseCount,
    run_count: runCount,
    correct,
    agreed,
    measured_at: measuredAt,
  });
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function sha256(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw promotionError(`${path} must be a sha256 digest`);
  }
  return value;
}

function semver(value: unknown, path: string): string {
  const result = nonBlank(value, path);
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(result)) {
    throw promotionError(`${path} must be a semantic version`);
  }
  return result;
}

function integer(value: unknown, path: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw promotionError(`${path} must be an integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

function nonBlank(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw promotionError(`${path} must be a non-blank string`);
  return value;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw promotionError(`${path} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw promotionError(`${path} must be a plain object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = new Set(keys);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw promotionError(`${path}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw promotionError(`${path}.${key} is not allowed`);
  }
}

function promotionError(message: string, cause?: unknown): JitPromotionError {
  return new JitPromotionError(message, cause === undefined ? undefined : { cause });
}

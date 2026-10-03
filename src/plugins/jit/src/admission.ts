/**
 * Implements admission behavior for the jit plugin.
 */

import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { canonicalJson } from '../../../core/component/json-artifact/index.js';
import { JitPromotionError } from '../../../core/contracts/errors/index.js';
import type { BlueprintEvaluationCase } from '../../../core/contracts/evaluation/index.js';
import type {
  JitAdmissionCaseReport,
  JitAdmissionDivergence,
  JitAdmissionOptions,
  JitAdmissionRefusalReason,
  JitAdmissionReport,
} from '../../../core/contracts/jit/index.js';
import type { JsonObject, JsonValue } from '../../../core/contracts/types/index.js';
import { blueprintDigest, jitProgramDigest } from './promotions.js';
import { runJitProgram, validateJitProgram } from './program.js';

export const JIT_ADMISSION_REPORT_SCHEMA = 'pixiecore.jit-admission-report/v1' as const;

interface AdmissionRunResult {
  readonly correct: boolean;
  readonly agreed: boolean;
  readonly programError: boolean;
  readonly modelError: boolean;
  readonly divergences: readonly JitAdmissionDivergence[];
}

/**
 * Executes jit admission through its public boundary.
 */
export async function runJitAdmission(options: JitAdmissionOptions): Promise<JitAdmissionReport> {
  validateOptions(options);
  const blueprint = snapshotJson(options.blueprint, 'Blueprint');
  const dataset = snapshotJson(options.dataset, 'Dataset');
  const program = validateJitProgram(options.program);
  const runs = options.runs ?? 1;
  const seed = options.seed ?? randomUUID();
  const cases: JitAdmissionCaseReport[] = [];

  for (const fixture of dataset.cases) {
    cases.push(await measureCase(fixture, program, options, runs, seed));
  }

  const summary = summarize(cases);
  const refusalReason = refusal(summary);
  return Object.freeze({
    schema: JIT_ADMISSION_REPORT_SCHEMA,
    seed,
    measured_at: new Date().toISOString(),
    blueprint: Object.freeze({
      name: blueprint.name,
      version: blueprint.version,
      source_digest: blueprintDigest(blueprint),
    }),
    dataset: Object.freeze({
      name: dataset.name,
      version: dataset.version,
      digest: digest(dataset),
    }),
    provider: options.provider,
    model: options.model,
    program_digest: jitProgramDigest(program),
    promoted: refusalReason === undefined,
    ...(refusalReason === undefined ? {} : { refusal_reason: refusalReason }),
    summary,
    cases: Object.freeze(cases),
  });
}

async function measureCase(
  fixture: BlueprintEvaluationCase,
  program: JitAdmissionOptions['program'],
  options: JitAdmissionOptions,
  runs: number,
  seed: string,
): Promise<JitAdmissionCaseReport> {
  const divergences = new Map<string, JitAdmissionDivergence>();
  let correct = 0;
  let agreed = 0;
  let programErrors = 0;
  let modelErrors = 0;

  for (let run = 1; run <= runs; run++) {
    const result = await measureRun(fixture, program, options, run, seed);
    correct += Number(result.correct);
    agreed += Number(result.agreed);
    programErrors += Number(result.programError);
    modelErrors += Number(result.modelError);
    for (const divergence of result.divergences) addDivergence(divergences, divergence);
  }

  return Object.freeze({
    id: fixture.id,
    runs,
    correct,
    agreed,
    program_errors: programErrors,
    model_errors: modelErrors,
    divergences: Object.freeze([...divergences.values()].sort(compareDivergence)),
  });
}

async function measureRun(
  fixture: BlueprintEvaluationCase,
  program: JitAdmissionOptions['program'],
  options: JitAdmissionOptions,
  run: number,
  seed: string,
): Promise<AdmissionRunResult> {
  options.signal?.throwIfAborted();
  const compiled = executeProgram(program, fixture.inputs, options);
  if (!compiled) return failedRun('expectation', 'program_error');

  const model = await executeModel(fixture, options, run, seed);
  if (!model) return failedRun('model', 'model_error');

  const expected = await options.compareExpected(
    compiled,
    fixture.expected_output,
    fixture.comparison,
    options.comparisonOptions,
  );
  const divergences: JitAdmissionDivergence[] = expected.differences.map(difference => ({
    against: 'expectation',
    pointer: difference.pointer,
    reason: difference.reason,
  }));
  const agreed = isDeepStrictEqual(compiled, model);
  if (!agreed) divergences.push(...jsonDifferences(compiled, model));

  return {
    correct: expected.passed,
    agreed,
    programError: false,
    modelError: false,
    divergences,
  };
}

function executeProgram(
  program: JitAdmissionOptions['program'],
  inputs: Readonly<JsonObject>,
  options: JitAdmissionOptions,
): JsonObject | undefined {
  try {
    const raw = runJitProgram(program, inputs);
    return jsonObject(options.validateOutput?.(raw) ?? raw, 'Program output');
  } catch {
    return undefined;
  }
}

async function executeModel(
  fixture: BlueprintEvaluationCase,
  options: JitAdmissionOptions,
  run: number,
  seed: string,
): Promise<JsonObject | undefined> {
  try {
    const output = await options.executeModel(structuredClone(fixture.inputs), {
      caseId: fixture.id,
      run,
      seed,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return jsonObject(options.validateOutput?.(output) ?? output, 'Model output');
  } catch {
    return undefined;
  }
}

function failedRun(
  against: JitAdmissionDivergence['against'],
  reason: 'program_error' | 'model_error',
): AdmissionRunResult {
  return {
    correct: false,
    agreed: false,
    programError: reason === 'program_error',
    modelError: reason === 'model_error',
    divergences: [{ against, pointer: '', reason }],
  };
}

function summarize(cases: readonly JitAdmissionCaseReport[]): JitAdmissionReport['summary'] {
  return Object.freeze({
    case_count: cases.length,
    run_count: cases.reduce((total, item) => total + item.runs, 0),
    correct: cases.reduce((total, item) => total + item.correct, 0),
    agreed: cases.reduce((total, item) => total + item.agreed, 0),
    program_errors: cases.reduce((total, item) => total + item.program_errors, 0),
    model_errors: cases.reduce((total, item) => total + item.model_errors, 0),
  });
}

function validateOptions(options: JitAdmissionOptions): void {
  if (!options || typeof options !== 'object') throw admissionError('Admission options are required');
  nonBlank(options.blueprint?.name, 'Blueprint name');
  nonBlank(options.blueprint?.version, 'Blueprint version');
  nonBlank(options.dataset?.name, 'Dataset name');
  nonBlank(options.dataset?.version, 'Dataset version');
  nonBlank(options.provider, 'Provider');
  nonBlank(options.model, 'Model');
  if (!Array.isArray(options.dataset?.cases)) throw admissionError('Dataset cases must be an array');
  for (const [index, fixture] of options.dataset.cases.entries()) {
    nonBlank(fixture?.id, `Dataset case ${index} id`);
    jsonObject(fixture?.inputs, `Dataset case ${index} inputs`);
    jsonObject(fixture?.expected_output, `Dataset case ${index} expected output`);
  }
  if (typeof options.executeModel !== 'function') throw admissionError('executeModel must be a function');
  if (typeof options.compareExpected !== 'function') throw admissionError('compareExpected must be a function');
  const runs = options.runs ?? 1;
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 100) {
    throw admissionError('runs must be an integer from 1 to 100');
  }
  if (options.seed !== undefined) nonBlank(options.seed, 'Seed');
}

function refusal(summary: JitAdmissionReport['summary']): JitAdmissionRefusalReason | undefined {
  if (summary.case_count === 0 || summary.run_count === 0) return 'no_cases';
  if (summary.program_errors > 0) return 'program_error';
  if (summary.model_errors > 0) return 'model_error';
  if (summary.correct !== summary.run_count) return 'expectation_mismatch';
  if (summary.agreed !== summary.run_count) return 'model_mismatch';
  return undefined;
}

function jsonDifferences(
  compiled: JsonValue,
  model: JsonValue,
  pointer = '',
): JitAdmissionDivergence[] {
  if (isDeepStrictEqual(compiled, model)) return [];
  if (Array.isArray(compiled) && Array.isArray(model)) {
    const differences: JitAdmissionDivergence[] = [];
    const length = Math.max(compiled.length, model.length);
    for (let index = 0; index < length; index++) {
      const at = `${pointer}/${index}`;
      if (index >= compiled.length) {
        differences.push({ against: 'model', pointer: at, reason: 'missing_compiled' });
        continue;
      }
      if (index >= model.length) {
        differences.push({ against: 'model', pointer: at, reason: 'missing_model' });
        continue;
      }
      differences.push(...jsonDifferences(compiled[index]!, model[index]!, at));
    }
    return differences;
  }
  if (isObject(compiled) && isObject(model)) {
    const differences: JitAdmissionDivergence[] = [];
    const keys = [...new Set([...Object.keys(compiled), ...Object.keys(model)])].sort();
    for (const key of keys) {
      const at = `${pointer}/${escapePointer(key)}`;
      if (!Object.prototype.hasOwnProperty.call(compiled, key)) {
        differences.push({ against: 'model', pointer: at, reason: 'missing_compiled' });
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(model, key)) {
        differences.push({ against: 'model', pointer: at, reason: 'missing_model' });
        continue;
      }
      differences.push(...jsonDifferences(compiled[key]!, model[key]!, at));
    }
    return differences;
  }
  return [{ against: 'model', pointer, reason: 'not_equal' }];
}

function addDivergence(
  values: Map<string, JitAdmissionDivergence>,
  divergence: JitAdmissionDivergence,
): void {
  values.set(`${divergence.against}\0${divergence.pointer}\0${divergence.reason}`, Object.freeze(divergence));
}

function compareDivergence(left: JitAdmissionDivergence, right: JitAdmissionDivergence): number {
  return `${left.against}\0${left.pointer}\0${left.reason}`
    .localeCompare(`${right.against}\0${right.pointer}\0${right.reason}`);
}

function isObject(value: JsonValue): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw admissionError(`${label} must be a JSON object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw admissionError(`${label} must be a plain JSON object`);
  }
  try {
    canonicalJson(value);
  } catch {
    throw admissionError(`${label} must contain JSON-serializable values`);
  }
  return value as JsonObject;
}

function snapshotJson<T>(value: T, label: string): T {
  try {
    return JSON.parse(canonicalJson(value)) as T;
  } catch {
    throw admissionError(`${label} must contain JSON-serializable values`);
  }
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function nonBlank(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw admissionError(`${label} must be a non-blank string`);
  return value;
}

function admissionError(message: string): JitPromotionError {
  return new JitPromotionError(message);
}

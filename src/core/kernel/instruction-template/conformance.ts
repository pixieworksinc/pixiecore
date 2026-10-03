/**
 * Coordinates instruction template conformance responsibilities inside the PixieCore kernel.
 */

import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { BlueprintValidationError } from '../../contracts/errors/index.js';
import type { Blueprint, GenerateRequest, Provider } from '../../contracts/types/index.js';
import { PromptRuntime } from '../runtime/index.js';

export const INSTRUCTION_TEMPLATE_ADAPTER_PROTOCOL =
  'pixiecore.instruction-template-adapter/1' as const;
export const INSTRUCTION_TEMPLATE_CONFORMANCE_REPORT_SCHEMA =
  'pixiecore.instruction-template-conformance-report/v1' as const;

interface InstructionTemplateFixture {
  readonly schema: 'pixiecore.instruction-template-conformance/v1';
  readonly render_cases: readonly InstructionRenderFixture[];
  readonly validation_cases: readonly InstructionValidationFixture[];
}

interface InstructionRenderFixture {
  readonly id: string;
  readonly template: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly expected: string;
  readonly portable?: boolean;
  readonly extension_id?: string;
}

interface InstructionValidationFixture {
  readonly id: string;
  readonly template: string;
  readonly declared_inputs: readonly string[];
  readonly expected_undeclared: readonly string[];
  readonly portable?: boolean;
  readonly extension_id?: string;
}

/**
 * Describes the instruction template render observation contract.
 */
export interface InstructionTemplateRenderObservation {
  readonly rendered_instruction: string;
  readonly blueprint_role: string;
  readonly effective_message_role: string | null;
  readonly provider_request_count: number;
}

/**
 * Describes the instruction template validation observation contract.
 */
export interface InstructionTemplateValidationObservation {
  readonly accepted: boolean;
  readonly undeclared_inputs: readonly string[];
  readonly provider_request_count: number;
  readonly error_code?: string;
}

/**
 * Describes the result of instruction template conformance case.
 */
export type InstructionTemplateConformanceCaseResult =
  | Readonly<{
    id: string;
    kind: 'render';
    portable: boolean;
    extension_id?: string;
    passed: boolean;
    expected: InstructionTemplateRenderObservation;
    observed: InstructionTemplateRenderObservation;
  }>
  | Readonly<{
    id: string;
    kind: 'validation';
    portable: boolean;
    extension_id?: string;
    passed: boolean;
    expected: InstructionTemplateValidationObservation;
    observed: InstructionTemplateValidationObservation;
  }>;

/**
 * Describes the instruction template conformance report contract.
 */
export interface InstructionTemplateConformanceReport {
  readonly schema: typeof INSTRUCTION_TEMPLATE_CONFORMANCE_REPORT_SCHEMA;
  readonly adapter_protocol: typeof INSTRUCTION_TEMPLATE_ADAPTER_PROTOCOL;
  readonly suite: InstructionTemplateFixture['schema'];
  readonly capability: 'pop.runtime.mustache-input-binding';
  readonly implementation: Readonly<{ name: 'PixieCore'; version: string }>;
  readonly summary: InstructionTemplateCaseSummary;
  readonly portable_summary: InstructionTemplateCaseSummary;
  readonly extension_summary: InstructionTemplateCaseSummary;
  readonly cases: readonly InstructionTemplateConformanceCaseResult[];
  readonly conformant: boolean;
}

/**
 * Configures instruction template conformance behavior.
 */
export interface InstructionTemplateConformanceOptions {
  /** Defaults to PixieCore's bundled provisional suite. */
  readonly suite?: unknown;
}

type InstructionTemplateCaseSummary = Readonly<{
  total: number;
  passed: number;
  failed: number;
}>;

/** Runs the provisional input-binding suite through PixieCore's real runtime boundary. */
export async function runInstructionTemplateConformanceSuite(
  options: InstructionTemplateConformanceOptions = {},
): Promise<InstructionTemplateConformanceReport> {
  const [suiteSchema, reportSchema, packageManifest, bundledSuite] = await Promise.all([
    readBundledJson('../../../../schemas/pixiecore.instruction-template-conformance-v1.schema.json'),
    readBundledJson(
      '../../../../schemas/pixiecore.instruction-template-conformance-report-v1.schema.json',
    ),
    readBundledJson('../../../../package.json'),
    readBundledJson('../../../../conformance/pixiecore-instruction-template-v1/suite.json'),
  ]);
  const suiteValue = options.suite ?? bundledSuite;
  const suiteValidator = compile(suiteSchema);
  if (!suiteValidator(suiteValue)) {
    throw new TypeError(
      `Invalid instruction-template conformance suite: ${formatErrors(suiteValidator)}`,
    );
  }
  const suite = suiteValue as InstructionTemplateFixture;
  const cases: InstructionTemplateConformanceCaseResult[] = [];
  for (const fixture of suite.render_cases) {
    cases.push(await runInstructionRenderFixture(fixture));
  }
  for (const fixture of suite.validation_cases) {
    cases.push(await runInstructionValidationFixture(fixture));
  }
  const summary = summarizeCases(cases);
  const portableSummary = summarizeCases(cases.filter(item => item.portable));
  const extensionSummary = summarizeCases(cases.filter(item => !item.portable));
  const report: InstructionTemplateConformanceReport = Object.freeze({
    schema: INSTRUCTION_TEMPLATE_CONFORMANCE_REPORT_SCHEMA,
    adapter_protocol: INSTRUCTION_TEMPLATE_ADAPTER_PROTOCOL,
    suite: suite.schema,
    capability: 'pop.runtime.mustache-input-binding',
    implementation: Object.freeze({ name: 'PixieCore', version: packageVersion(packageManifest) }),
    summary,
    portable_summary: portableSummary,
    extension_summary: extensionSummary,
    cases: Object.freeze(cases),
    conformant: portableSummary.failed === 0,
  });
  const reportValidator = compile(reportSchema);
  if (!reportValidator(report)) {
    throw new TypeError(
      `Invalid instruction-template conformance report: ${formatErrors(reportValidator)}`,
    );
  }
  return report;
}

function summarizeCases(
  cases: readonly InstructionTemplateConformanceCaseResult[],
): InstructionTemplateCaseSummary {
  const passed = cases.filter(item => item.passed).length;
  return Object.freeze({ total: cases.length, passed, failed: cases.length - passed });
}

async function runInstructionRenderFixture(
  fixture: InstructionRenderFixture,
): Promise<InstructionTemplateConformanceCaseResult> {
  const provider = new InstructionCaptureProvider();
  const runtime = createRuntime(provider);
  const expected: InstructionTemplateRenderObservation = Object.freeze({
    rendered_instruction: fixture.expected,
    blueprint_role: 'assistant',
    effective_message_role: 'user',
    provider_request_count: 1,
  });
  try {
    await runtime.executeYaml(
      JSON.stringify(instructionBlueprint(fixture.id, fixture.template)),
      { ...fixture.inputs },
    );
    const message = provider.requests[0]?.messages
      .filter(item => item.role === 'user')
      .at(-1);
    const observed: InstructionTemplateRenderObservation = Object.freeze({
      rendered_instruction: typeof message?.content === 'string' ? message.content : '',
      blueprint_role: 'assistant',
      effective_message_role: message?.role ?? null,
      provider_request_count: provider.requests.length,
    });
    return renderResult(fixture, expected, observed, isDeepStrictEqual(observed, expected));
  } catch {
    const observed: InstructionTemplateRenderObservation = Object.freeze({
      rendered_instruction: '',
      blueprint_role: 'assistant',
      effective_message_role: null,
      provider_request_count: provider.requests.length,
    });
    return renderResult(fixture, expected, observed, false);
  } finally {
    await runtime.close();
  }
}

function renderResult(
  fixture: InstructionRenderFixture,
  expected: InstructionTemplateRenderObservation,
  observed: InstructionTemplateRenderObservation,
  passed: boolean,
): InstructionTemplateConformanceCaseResult {
  return Object.freeze({
    id: fixture.id,
    kind: 'render',
    portable: fixture.portable ?? true,
    ...(fixture.extension_id === undefined ? {} : { extension_id: fixture.extension_id }),
    passed,
    expected,
    observed,
  });
}

async function runInstructionValidationFixture(
  fixture: InstructionValidationFixture,
): Promise<InstructionTemplateConformanceCaseResult> {
  const provider = new InstructionCaptureProvider();
  const runtime = createRuntime(provider);
  let errorCode: string | undefined;
  let undeclaredInputs: readonly string[] = [];
  let accepted = true;
  try {
    await runtime.executeYaml(
      JSON.stringify(instructionBlueprint(fixture.id, fixture.template, fixture.declared_inputs)),
      {},
    );
  } catch (error) {
    accepted = false;
    if (error instanceof BlueprintValidationError) {
      errorCode = error.code;
      undeclaredInputs = parseUndeclaredInputs(error.message);
    } else if (error && typeof error === 'object' && 'code' in error) {
      errorCode = String(error.code);
    }
  } finally {
    await runtime.close();
  }
  const expectsAcceptance = fixture.expected_undeclared.length === 0;
  const expected: InstructionTemplateValidationObservation = Object.freeze({
    accepted: expectsAcceptance,
    undeclared_inputs: Object.freeze([...fixture.expected_undeclared]),
    provider_request_count: expectsAcceptance ? 1 : 0,
    ...(expectsAcceptance ? {} : { error_code: 'blueprint_validation_error' }),
  });
  const observed: InstructionTemplateValidationObservation = Object.freeze({
    accepted,
    undeclared_inputs: Object.freeze([...undeclaredInputs]),
    provider_request_count: provider.requests.length,
    ...(errorCode === undefined ? {} : { error_code: errorCode }),
  });
  return Object.freeze({
    id: fixture.id,
    kind: 'validation',
    portable: fixture.portable ?? true,
    ...(fixture.extension_id === undefined ? {} : { extension_id: fixture.extension_id }),
    passed: isDeepStrictEqual(observed, expected),
    expected,
    observed,
  });
}

function instructionBlueprint(
  id: string,
  prompt: string,
  declaredInputs?: readonly string[],
): Blueprint {
  return {
    name: `Instruction conformance ${id}`,
    version: '1.0.0',
    role: 'assistant',
    prompt,
    ...(declaredInputs === undefined ? {} : {
      input_placeholders: declaredInputs.map(name => ({
        name,
        type: 'string' as const,
        required: false,
        default: '',
      })),
    }),
    output_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } },
    },
  };
}

function createRuntime(provider: Provider): PromptRuntime {
  return new PromptRuntime({
    provider,
    maxRetry: 0,
    mcpConfigPath: 'disabled',
    pluginConfigPath: 'disabled',
    logToConsole: false,
    logToFile: false,
  });
}

function parseUndeclaredInputs(message: string): readonly string[] {
  const separator = message.indexOf(':');
  if (separator < 0) return [];
  return message.slice(separator + 1).split(',').map(item => item.trim()).filter(Boolean);
}

/**
 * Provides instruction capture operations through a stable contract.
 */
class InstructionCaptureProvider implements Provider {
  readonly name = 'pixiecore-instruction-conformance';
  readonly model = 'pixiecore-instruction-conformance-v1';
  readonly supportsTools = false;
  readonly supportsMultimodal = false;
  readonly requests: GenerateRequest[] = [];

  /**
   * Creates the requested operation according to the InstructionCaptureProvider contract.
   */
  generate(request: GenerateRequest): Promise<{ content: string }> {
    this.requests.push(structuredClone(request));
    return Promise.resolve({ content: '{"ok":true}' });
  }

  /**
   * Reports whether the provider accepts visual content.
   */
  supportsVision(): boolean { return false; }
  /**
   * Reports whether the provider accepts file attachments.
   */
  supportsFileInput(): boolean { return false; }
  /**
   * Returns model list from the InstructionCaptureProvider state.
   */
  getModelList(): Promise<string[]> { return Promise.resolve([this.model]); }
}

function compile(schema: unknown): ValidateFunction {
  if (!isObject(schema) && typeof schema !== 'boolean') {
    throw new TypeError('Bundled JSON Schema must be an object or Boolean');
  }
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
}

async function readBundledJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8')) as unknown;
}

function packageVersion(value: unknown): string {
  if (isObject(value) && typeof value.version === 'string') return value.version;
  throw new TypeError('Installed package manifest has no version');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatErrors(validate: ValidateFunction): string {
  return JSON.stringify(validate.errors ?? []);
}

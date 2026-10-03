/**
 * Coordinates conformance responsibilities inside the PixieCore kernel.
 */

import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import YAML from 'yaml';
import type { EvaluationComparisonPolicy } from '../../contracts/evaluation/index.js';
import type { Blueprint, GenerateRequest, JsonObject, Provider } from '../../contracts/types/index.js';
import { InputValidationError, MaxRetryExceededError } from '../../contracts/errors/index.js';
import { compareEvaluationOutput } from '../evaluation/comparators.js';
import { PromptRuntime } from '../runtime/index.js';

export * from '../instruction-template/conformance.js';

export const POP_CONFORMANCE_REPORT_SCHEMA = 'pop.conformance-report/0.1' as const;
export const POP_CONFORMANCE_SUITE_SCHEMA = 'pop.conformance-suite/0.1' as const;
export const POP_CONFORMANCE_SPECIFICATION = 'pop-core/0.1' as const;

/**
 * Defines the supported pop conformance group values.
 */
export type PopConformanceGroup = 'validation' | 'comparison' | 'runtime' | 'capability';

/**
 * Describes the result of pop conformance case.
 */
export interface PopConformanceCaseResult {
  readonly id: string;
  readonly group: PopConformanceGroup;
  readonly passed: boolean;
}

/**
 * Describes the pop conformance report contract.
 */
export interface PopConformanceReport {
  readonly schema: typeof POP_CONFORMANCE_REPORT_SCHEMA;
  readonly suite: typeof POP_CONFORMANCE_SUITE_SCHEMA;
  readonly specification: typeof POP_CONFORMANCE_SPECIFICATION;
  readonly implementation: Readonly<{ name: 'PixieCore'; version: string }>;
  readonly profile: 'runtime';
  readonly capabilities: readonly string[];
  readonly summary: Readonly<{ total: number; passed: number; failed: number }>;
  readonly cases: readonly PopConformanceCaseResult[];
  readonly conformant: boolean;
}

interface ValidationFixture {
  readonly id: string;
  readonly artifact: 'blueprint' | 'evaluation_dataset' | 'evaluation_result' | 'blueprint_package';
  readonly document: unknown;
  readonly expected_valid: boolean;
}

interface ComparisonFixture {
  readonly id: string;
  readonly comparison: EvaluationComparisonPolicy;
  readonly output_schema?: JsonObject;
  readonly expected_output: JsonObject;
  readonly actual_output: JsonObject;
  readonly expected_semantic_valid: boolean;
}

interface RuntimeFixture {
  readonly id: string;
  readonly blueprint: PopBlueprint;
  readonly inputs: JsonObject;
  readonly generated_output: unknown;
  readonly expected:
    | { readonly outcome: 'success'; readonly output: JsonObject }
    | { readonly outcome: 'validation_error'; readonly stage: 'input' | 'output' };
}

interface CapabilityFixture {
  readonly id: string;
  readonly blueprint: PopBlueprint;
  readonly supported_capabilities: readonly string[];
  readonly expected: { readonly supported: boolean; readonly missing_capability?: string };
}

interface PopConformanceSuite {
  readonly schema: typeof POP_CONFORMANCE_SUITE_SCHEMA;
  readonly specification: typeof POP_CONFORMANCE_SPECIFICATION;
  readonly validation: readonly ValidationFixture[];
  readonly comparison: readonly ComparisonFixture[];
  readonly runtime: readonly RuntimeFixture[];
  readonly capability: readonly CapabilityFixture[];
}

interface PopBlueprint {
  readonly schema: 'pop.blueprint/0.1';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly role: string;
  readonly instructions: string;
  readonly input_schema?: JsonObject;
  readonly output_schema: JsonObject;
  readonly examples?: readonly {
    readonly inputs: JsonObject;
    readonly output: JsonObject;
  }[];
  readonly tools?: readonly string[];
  readonly execution?: Readonly<{ model_hint?: string; temperature?: number }>;
  readonly requires?: readonly string[];
}

const schemaPaths = {
  blueprint: '../../../../schemas/pop.blueprint-0.1.schema.json',
  evaluation_dataset: '../../../../schemas/pop.evaluation-dataset-0.1.schema.json',
  evaluation_result: '../../../../schemas/pop.evaluation-result-0.1.schema.json',
  blueprint_package: '../../../../schemas/pop.blueprint-package-0.1.schema.json',
} as const;

const supportedCapabilities = Object.freeze([
  'pop.validation.artifacts',
  'pop.evaluation.comparison',
  'pop.runtime.structured-output',
  'pop.runtime.required-capabilities',
]);

/** Runs the bundled language-neutral suite through PixieCore's real public boundaries. */
export async function runPopConformanceSuite(): Promise<PopConformanceReport> {
  const [suiteSchema, reportSchema, packageManifest, ...artifactSchemaValues] = await Promise.all([
    readBundledJson('../../../../schemas/pop.conformance-suite-0.1.schema.json'),
    readBundledJson('../../../../schemas/pop.conformance-report-0.1.schema.json'),
    readBundledJson('../../../../package.json'),
    ...Object.values(schemaPaths).map(readBundledJson),
  ]);
  const suiteValue = await readBundledJson('../../../../conformance/pop-0.1/suite.json');
  const suiteValidator = compile(suiteSchema);
  if (!suiteValidator(suiteValue)) {
    throw new TypeError(`Invalid POP conformance suite: ${formatErrors(suiteValidator)}`);
  }
  const suite = suiteValue as PopConformanceSuite;
  const validators = Object.fromEntries(
    Object.keys(schemaPaths).map((name, index) => [name, compile(artifactSchemaValues[index]!)]),
  ) as Record<ValidationFixture['artifact'], ValidateFunction>;

  const cases: PopConformanceCaseResult[] = [];
  for (const fixture of suite.validation) {
    cases.push(result(fixture.id, 'validation',
      Boolean(validators[fixture.artifact](fixture.document)) === fixture.expected_valid));
  }
  for (const fixture of suite.comparison) {
    cases.push(result(fixture.id, 'comparison', await runComparisonFixture(fixture)));
  }
  for (const fixture of suite.runtime) {
    cases.push(result(fixture.id, 'runtime', await runRuntimeFixture(fixture)));
  }
  for (const fixture of suite.capability) {
    cases.push(result(fixture.id, 'capability', runCapabilityFixture(fixture)));
  }

  const passed = cases.filter(item => item.passed).length;
  const report: PopConformanceReport = Object.freeze({
    schema: POP_CONFORMANCE_REPORT_SCHEMA,
    suite: suite.schema,
    specification: suite.specification,
    implementation: Object.freeze({
      name: 'PixieCore',
      version: packageVersion(packageManifest),
    }),
    profile: 'runtime',
    capabilities: supportedCapabilities,
    summary: Object.freeze({ total: cases.length, passed, failed: cases.length - passed }),
    cases: Object.freeze(cases),
    conformant: passed === cases.length,
  });
  const reportValidator = compile(reportSchema);
  if (!reportValidator(report)) {
    throw new TypeError(`Invalid POP conformance report: ${formatErrors(reportValidator)}`);
  }
  return report;
}

async function runComparisonFixture(fixture: ComparisonFixture): Promise<boolean> {
  try {
    const comparison = await compareEvaluationOutput(
      fixture.actual_output,
      fixture.expected_output,
      fixture.comparison,
      fixture.output_schema === undefined ? {} : { outputSchema: fixture.output_schema },
    );
    return comparison.passed === fixture.expected_semantic_valid;
  } catch {
    return false;
  }
}

async function runRuntimeFixture(fixture: RuntimeFixture): Promise<boolean> {
  const provider = new FixtureProvider(fixture.generated_output);
  const runtime = new PromptRuntime({
    provider,
    maxRetry: 0,
    mcpConfigPath: 'disabled',
    pluginConfigPath: 'disabled',
    logToConsole: false,
    logToFile: false,
  });
  try {
    const output = await runtime.executeYaml(
      YAML.stringify(adaptBlueprint(fixture.blueprint)),
      fixture.inputs,
    );
    return fixture.expected.outcome === 'success'
      && provider.calls === 1
      && isDeepStrictEqual(output, fixture.expected.output);
  } catch (error) {
    if (fixture.expected.outcome !== 'validation_error') return false;
    if (fixture.expected.stage === 'input') {
      return error instanceof InputValidationError && provider.calls === 0;
    }
    return error instanceof MaxRetryExceededError && provider.calls === 1;
  } finally {
    await runtime.close();
  }
}

function runCapabilityFixture(fixture: CapabilityFixture): boolean {
  const supported = new Set(fixture.supported_capabilities);
  const missing = fixture.blueprint.requires?.find(capability => !supported.has(capability));
  return fixture.expected.supported === (missing === undefined)
    && fixture.expected.missing_capability === missing;
}

function adaptBlueprint(blueprint: PopBlueprint): Blueprint {
  return {
    name: blueprint.name,
    version: blueprint.version,
    role: blueprint.role,
    prompt: blueprint.instructions,
    ...(blueprint.input_schema === undefined ? {} : { input_schema: blueprint.input_schema }),
    output_schema: blueprint.output_schema,
    ...(blueprint.examples === undefined ? {} : {
      examples: blueprint.examples.map(example => ({
        input: example.inputs,
        output: example.output,
      })),
    }),
    ...(blueprint.tools === undefined ? {} : { tools: [...blueprint.tools] }),
    ...(blueprint.execution?.model_hint === undefined
      ? {}
      : { model: blueprint.execution.model_hint }),
    ...(blueprint.execution?.temperature === undefined
      ? {}
      : { temperature: blueprint.execution.temperature }),
  };
}

/**
 * Provides fixture operations through a stable contract.
 */
class FixtureProvider implements Provider {
  readonly name = 'pop-conformance';
  readonly model = 'pop-conformance-0.1';
  readonly supportsTools = false;
  readonly supportsMultimodal = false;
  calls = 0;

  /**
   * Creates a FixtureProvider and establishes its initial state.
   */
  constructor(private readonly output: unknown) {}

  /**
   * Creates the requested operation according to the FixtureProvider contract.
   */
  generate(_request: GenerateRequest): Promise<{ content: string }> {
    this.calls++;
    return Promise.resolve({ content: JSON.stringify(this.output) });
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
   * Returns model list from the FixtureProvider state.
   */
  getModelList(): Promise<string[]> { return Promise.resolve([this.model]); }
}

function result(id: string, group: PopConformanceGroup, passed: boolean): PopConformanceCaseResult {
  return Object.freeze({ id, group, passed });
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

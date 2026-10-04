/**
 * Coordinates runner responsibilities inside the PixieCore kernel.
 */

import { createHash, randomUUID } from 'node:crypto';
import { relative } from 'node:path';
import { errorMessage } from '../../component/diagnostics/index.js';
import type {
  BlueprintEvaluationCaseResult,
  BlueprintEvaluationDataset,
  BlueprintEvaluationResultArtifact,
  BlueprintEvaluationRunOptions,
  BlueprintPlaygroundArtifact,
  BlueprintPlaygroundExecution,
  BlueprintPlaygroundMode,
  BlueprintPlaygroundRunOptions,
  BlueprintProviderUsage,
  EvaluationComparisonOptions,
} from '../../contracts/evaluation/index.js';
import type {
  Blueprint,
  GenerateRequest,
  JsonObject,
  Provider,
} from '../../contracts/types/index.js';
import type { TelemetryPricingRule } from '../../contracts/telemetry/index.js';
import { PromptRuntime } from '../runtime/index.js';
import { ExecutionTelemetryRecorder } from '../telemetry/index.js';
import { prepareEvaluation } from './preparation.js';
import {
  evaluationPricingRules,
  evaluationProviderUsage,
} from './accounting.js';
import { compareEvaluationOutput } from './comparators.js';

/** Runs one versioned Blueprint dataset without persisting its potentially sensitive output. */
export async function runBlueprintEvaluation(
  options: BlueprintEvaluationRunOptions,
): Promise<BlueprintEvaluationResultArtifact> {
  const prepared = await prepareEvaluation(options.datasetPath, options.cwd);
  const {
    cwd,
    datasetPath,
    datasetSource,
    dataset,
    projectRoot,
    blueprintPath,
    blueprintSource,
    blueprint,
  } = prepared;
  const seed = nonBlank(options.seed ?? randomUUID(), 'seed');
  const startedAt = new Date();

  const runtime = new PromptRuntime(options.runtimeOptions);
  const pricing = evaluationPricingRules(
    options.runtimeOptions,
    runtime.environment,
    options.pricing,
  );
  const cases: BlueprintEvaluationCaseResult[] = [];
  try {
    for (const evaluationCase of dataset.cases) {
      cases.push(await runCase(
        runtime,
        blueprintPath,
        blueprint,
        evaluationCase,
        combinedTags(dataset.tags, evaluationCase.tags),
        options.customComparators === undefined
          ? {}
          : { customComparators: options.customComparators },
        pricing,
      ));
    }
  } finally {
    await runtime.close();
  }

  const completedAt = new Date();
  const replayPath = relative(cwd, datasetPath) || datasetPath;
  return Object.freeze({
    schema: 'pixiecore.blueprint-eval-result/v1',
    dataset: Object.freeze({
      name: dataset.name,
      version: dataset.version,
      path: portablePath(replayPath),
      sha256: sha256(datasetSource),
    }),
    blueprint: Object.freeze({
      path: portablePath(relative(projectRoot, blueprintPath)),
      version: blueprint.version,
      sha256: sha256(blueprintSource),
    }),
    run: Object.freeze({
      id: randomUUID(),
      seed,
      seed_scope: 'runner',
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      provider: runtime.providerName,
      model: runtime.model,
      temperature: typeof blueprint.temperature === 'number' ? blueprint.temperature : null,
    }),
    summary: Object.freeze(summary(cases)),
    cases: Object.freeze(cases),
    replay_command: replayCommand(replayPath, seed),
  });
}

/** Runs one dataset case in a deterministic mock, configured real runtime, or both. */
export async function runBlueprintPlayground(
  options: BlueprintPlaygroundRunOptions,
): Promise<BlueprintPlaygroundArtifact> {
  const mode = options.mode ?? 'mock';
  assertPlaygroundMode(mode);
  const caseId = nonBlank(options.caseId, 'caseId');
  const prepared = await prepareEvaluation(options.datasetPath, options.cwd);
  const evaluationCase = prepared.dataset.cases.find(candidate => candidate.id === caseId);
  if (!evaluationCase) throw new TypeError(`Unknown evaluation case id: ${caseId}`);
  const comparisonOptions: Pick<EvaluationComparisonOptions, 'customComparators'> =
    options.customComparators === undefined
      ? {}
      : { customComparators: options.customComparators };

  const mock = mode === 'real'
    ? undefined
    : await executePlaygroundCase(
      prepared.blueprintPath,
      evaluationCase.inputs,
      {
        ...options.runtimeOptions,
        provider: new PlaygroundMockProvider(evaluationCase.expected_output),
        mcpConfigPath: 'disabled',
        pluginConfigPath: 'disabled',
      },
    );
  let real: BlueprintPlaygroundArtifact['real'];
  if (mode !== 'mock') {
    const execution = await executePlaygroundCase(
      prepared.blueprintPath,
      evaluationCase.inputs,
      options.runtimeOptions,
      {
        unitId: evaluationCase.id,
        blueprintVersion: prepared.blueprint.version,
        explicitPricing: options.pricing,
      },
    );
    const comparison = await compareEvaluationOutput(
      execution.output,
      evaluationCase.expected_output,
      evaluationCase.comparison,
      {
        ...comparisonOptions,
        inputs: evaluationCase.inputs,
        outputSchema: outputSchema(prepared.blueprint),
      },
    );
    real = Object.freeze({ ...execution, comparison });
  }

  const replayPath = portablePath(relative(prepared.cwd, prepared.datasetPath)
    || prepared.datasetPath);
  return Object.freeze({
    schema: 'pixiecore.blueprint-playground/v1',
    dataset: Object.freeze({
      name: prepared.dataset.name,
      version: prepared.dataset.version,
      path: replayPath,
    }),
    blueprint: Object.freeze({
      path: portablePath(relative(prepared.projectRoot, prepared.blueprintPath)),
      version: prepared.blueprint.version,
    }),
    case: Object.freeze({
      id: evaluationCase.id,
      tags: Object.freeze(combinedTags(prepared.dataset.tags, evaluationCase.tags)),
    }),
    mode,
    ...(mock === undefined ? {} : { mock }),
    ...(real === undefined ? {} : { real }),
    replay_command: playgroundReplayCommand(replayPath, caseId, mode),
  });
}

interface PlaygroundAccountingOptions {
  readonly unitId: string;
  readonly blueprintVersion: string;
  readonly explicitPricing: readonly TelemetryPricingRule[] | undefined;
}

function executePlaygroundCase(
  blueprintPath: string,
  inputs: JsonObject,
  runtimeOptions: BlueprintPlaygroundRunOptions['runtimeOptions'],
): Promise<BlueprintPlaygroundExecution>;
function executePlaygroundCase(
  blueprintPath: string,
  inputs: JsonObject,
  runtimeOptions: BlueprintPlaygroundRunOptions['runtimeOptions'],
  accounting: PlaygroundAccountingOptions,
): Promise<BlueprintPlaygroundExecution & { readonly provider_usage: readonly BlueprintProviderUsage[] }>;
async function executePlaygroundCase(
  blueprintPath: string,
  inputs: JsonObject,
  runtimeOptions: BlueprintPlaygroundRunOptions['runtimeOptions'],
  accounting?: PlaygroundAccountingOptions,
): Promise<BlueprintPlaygroundExecution & { readonly provider_usage?: readonly BlueprintProviderUsage[] }> {
  const runtime = new PromptRuntime(runtimeOptions);
  try {
    const pricing = accounting === undefined
      ? []
      : evaluationPricingRules(runtimeOptions, runtime.environment, accounting.explicitPricing);
    const recorder = accounting === undefined
      ? undefined
      : new ExecutionTelemetryRecorder({ pricing });
    const execute = () => runtime.execute(
      blueprintPath,
      structuredClone(inputs) as Record<string, unknown>,
    ) as Promise<JsonObject>;
    const output = recorder === undefined
      ? await execute()
      : await recorder.runUnit({
          unitType: 'blueprint',
          unitId: accounting!.unitId,
          blueprintVersion: accounting!.blueprintVersion,
          logger: runtime.logger,
        }, execute);
    return Object.freeze({
      provider: runtime.providerName,
      model: runtime.model,
      output: structuredClone(output),
      ...(recorder === undefined
        ? {}
        : { provider_usage: evaluationProviderUsage(recorder.finish(), pricing) }),
    });
  } finally {
    await runtime.close();
  }
}

/**
 * Provides playground mock operations through a stable contract.
 */
class PlaygroundMockProvider implements Provider {
  readonly name = 'playground-mock';
  readonly model = 'dataset-expected-output';
  readonly supportsTools = false;
  readonly supportsMultimodal = true;

  /**
   * Creates a PlaygroundMockProvider and establishes its initial state.
   */
  constructor(private readonly output: JsonObject) {}

  /**
   * Creates the requested operation according to the PlaygroundMockProvider contract.
   */
  generate(_request: GenerateRequest): Promise<{ content: string }> {
    return Promise.resolve({ content: JSON.stringify(this.output) });
  }

  /**
   * Reports whether the provider accepts visual content.
   */
  supportsVision(): boolean { return true; }
  /**
   * Reports whether the provider accepts file attachments.
   */
  supportsFileInput(): boolean { return true; }
  /**
   * Returns model list from the PlaygroundMockProvider state.
   */
  getModelList(): Promise<string[]> { return Promise.resolve([this.model]); }
}

async function runCase(
  runtime: PromptRuntime,
  blueprintPath: string,
  blueprint: Blueprint,
  evaluationCase: BlueprintEvaluationDataset['cases'][number],
  tags: readonly string[],
  comparisonOptions: Pick<EvaluationComparisonOptions, 'customComparators'>,
  pricing: readonly TelemetryPricingRule[],
): Promise<BlueprintEvaluationCaseResult> {
  const started = performance.now();
  const recorder = new ExecutionTelemetryRecorder({ pricing });
  try {
    const actual = await recorder.runUnit({
      unitType: 'blueprint',
      unitId: evaluationCase.id,
      blueprintVersion: blueprint.version,
      logger: runtime.logger,
    }, () => runtime.execute(
      blueprintPath,
      structuredClone(evaluationCase.inputs) as Record<string, unknown>,
    ) as Promise<JsonObject>);
    const comparison = await compareEvaluationOutput(
      actual,
      evaluationCase.expected_output,
      evaluationCase.comparison,
      {
        ...comparisonOptions,
        inputs: evaluationCase.inputs,
        outputSchema: outputSchema(blueprint),
      },
    );
    return Object.freeze({
      id: evaluationCase.id,
      tags,
      status: comparison.passed ? 'passed' : 'failed',
      duration_ms: elapsed(started),
      provider_usage: evaluationProviderUsage(recorder.finish(), pricing),
      actual_output: structuredClone(actual),
      differences: comparison.differences,
      ...(comparison.limitations === undefined ? {} : { limitations: comparison.limitations }),
    });
  } catch (error) {
    return Object.freeze({
      id: evaluationCase.id,
      tags,
      status: 'error',
      duration_ms: elapsed(started),
      provider_usage: evaluationProviderUsage(recorder.finish(), pricing),
      error: Object.freeze(errorRecord(error)),
    });
  }
}

function outputSchema(blueprint: Blueprint): Readonly<Record<string, unknown>> {
  return typeof blueprint.output_schema === 'string'
    ? JSON.parse(blueprint.output_schema) as Record<string, unknown>
    : blueprint.output_schema;
}

function summary(cases: readonly BlueprintEvaluationCaseResult[]): BlueprintEvaluationResultArtifact['summary'] {
  return {
    total: cases.length,
    passed: cases.filter(item => item.status === 'passed').length,
    failed: cases.filter(item => item.status === 'failed').length,
    errors: cases.filter(item => item.status === 'error').length,
  };
}

function combinedTags(datasetTags: readonly string[], caseTags: readonly string[]): readonly string[] {
  return Object.freeze([...new Set([...datasetTags, ...caseTags])]);
}

function errorRecord(error: unknown): { name: string; message: string; code?: string } {
  const name = error instanceof Error && error.name ? error.name : 'Error';
  const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
  return {
    name,
    message: errorMessage(error),
    ...(code === undefined ? {} : { code }),
  };
}

function replayCommand(datasetPath: string, seed: string): string {
  return ['pixiecore', 'blueprint', 'eval', datasetPath, `--seed=${seed}`]
    .map(shellArgument)
    .join(' ');
}

function playgroundReplayCommand(
  datasetPath: string,
  caseId: string,
  mode: BlueprintPlaygroundMode,
): string {
  return ['pixiecore', 'blueprint', 'play', datasetPath, `--case=${caseId}`, `--mode=${mode}`]
    .map(shellArgument)
    .join(' ');
}

function assertPlaygroundMode(value: string): asserts value is BlueprintPlaygroundMode {
  if (value === 'mock' || value === 'real' || value === 'both') return;
  throw new TypeError('mode must be mock, real, or both');
}

function shellArgument(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function portablePath(path: string): string {
  return path.replaceAll('\\', '/');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function elapsed(started: number): number {
  return Math.max(0, performance.now() - started);
}

function nonBlank(value: string, name: string): string {
  if (value.trim()) return value;
  throw new TypeError(`${name} must be non-blank`);
}

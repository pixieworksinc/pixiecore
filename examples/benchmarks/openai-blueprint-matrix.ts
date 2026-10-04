import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import {
  createProvider,
  getRuntimeEnvironment,
  type GenerateRequest,
  type GenerateResponse,
  type Provider,
} from '@pixieworks/pixiecore';
import {
  runBlueprintEvaluation,
  runBlueprintPlayground,
  type BlueprintEvaluationResultArtifact,
  type BlueprintPlaygroundArtifact,
  type BlueprintProviderUsage,
  type EvaluationLimitation,
} from '@pixieworks/pixiecore/eval';
import type { TelemetryPricingRule } from '@pixieworks/pixiecore/telemetry';

const DEFAULT_MANIFEST = 'examples/benchmarks/openai-blueprint-run-manifest.json';
const MANIFEST_SCHEMA = new URL('./openai-blueprint-run-manifest-v1.schema.json', import.meta.url);
const OFFICIAL_ENDPOINT = 'https://api.openai.com/v1';
const ALLOWED_MODELS = Object.freeze(['gpt-4.1-mini-2025-04-14']);

export interface OpenAIBlueprintMatrixCommand {
  readonly manifestPath: string;
  readonly phaseId: string;
  readonly datasetId?: string;
  readonly runId: string;
  readonly seed: string;
  readonly sourceRevision: string;
  readonly dryRun: boolean;
  readonly confirmRemoteCost: boolean;
  readonly confirmKeyRotated: boolean;
  readonly operatorMaxCalls?: number;
  readonly operatorBudgetUsd?: number;
}

export interface OpenAIBlueprintMatrixPlan {
  readonly schema: 'pixiecore.openai-blueprint-matrix-plan/v2';
  readonly provider: 'openai';
  readonly endpoint: typeof OFFICIAL_ENDPOINT;
  readonly model: string;
  readonly phase: string;
  readonly run_id: string;
  readonly seed: string;
  readonly source_revision: string;
  readonly runs: number;
  readonly datasets: readonly string[];
  readonly dataset_snapshots: readonly OpenAIBlueprintDatasetSnapshot[];
  readonly selected_cases: readonly string[] | null;
  readonly expected_calls: number;
  readonly max_calls: number;
  readonly budget_usd: number;
  readonly pricing: Pricing;
  readonly artifact_directory: string;
}

/** Binds one evaluated dataset to the exact sources and comparison policies used. */
export interface OpenAIBlueprintDatasetSnapshot {
  readonly dataset_id: string;
  readonly dataset_version: string;
  readonly dataset_digest: string;
  readonly blueprint_version: string;
  readonly blueprint_digest: string;
  readonly comparison_policy_digest: string;
}

interface MatrixDependencies {
  readonly createProvider?: (model: string) => Provider;
  readonly runEvaluation?: typeof runBlueprintEvaluation;
  readonly runPlayground?: typeof runBlueprintPlayground;
  readonly environment?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly cwd?: string;
}

interface MatrixManifest {
  readonly schema: 'pixiecore.openai-blueprint-run-manifest/v1';
  readonly provider: 'openai';
  readonly endpoint: typeof OFFICIAL_ENDPOINT;
  readonly model: string;
  readonly release: string;
  readonly pricing: Pricing;
  readonly data_policy: Readonly<{
    sensitivity: 'synthetic';
    remote_transmission: 'allowed-after-explicit-confirmation';
    artifact_values: 'value-free-diagnostics-only';
  }>;
  readonly datasets: readonly DatasetEntry[];
  readonly phases: readonly PhaseEntry[];
}

interface Pricing {
  readonly currency: 'USD';
  readonly input_per_million_tokens: number;
  readonly output_per_million_tokens: number;
  readonly source: string;
  readonly verified_at: string;
}

interface DatasetEntry {
  readonly id: string;
  readonly role: string;
  readonly path: string;
  readonly case_count: number;
  readonly comparison_modes: readonly string[];
  readonly sensitivity: 'synthetic';
  readonly attachments: readonly unknown[];
}

interface PhaseEntry {
  readonly id: string;
  readonly runs: number;
  readonly dataset_ids: readonly string[];
  readonly case_ids?: readonly string[];
  readonly max_calls: number;
  readonly budget_usd: number;
  readonly artifact_directory: string;
}

interface MatrixCheckpoint {
  readonly schema: 'pixiecore.openai-blueprint-matrix-checkpoint/v2';
  readonly status: 'running' | 'completed' | 'halted';
  readonly plan: OpenAIBlueprintMatrixPlan;
  readonly started_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
  readonly usage: UsageSnapshot;
  readonly results: readonly DatasetResult[];
  readonly halt_reason: string | null;
}

interface DatasetResult {
  readonly run: number;
  readonly dataset_id: string;
  readonly role: string;
  readonly summary: Readonly<{ total: number; passed: number; failed: number; errors: number }>;
  readonly cases: readonly CaseResult[];
}

interface CaseResult {
  readonly id: string;
  readonly status: string;
  readonly duration_ms: number | null;
  readonly provider_usage: readonly BlueprintProviderUsage[];
  readonly limitations?: readonly EvaluationLimitation[];
  readonly error_name: string | null;
}

interface UsageSnapshot {
  readonly calls: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
  readonly estimated_cost_usd: number;
  readonly complete: boolean;
}

export function parseOpenAIBlueprintMatrixArgs(
  args: readonly string[],
): OpenAIBlueprintMatrixCommand {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: {
      manifest: { type: 'string', default: DEFAULT_MANIFEST },
      phase: { type: 'string' },
      dataset: { type: 'string' },
      'run-id': { type: 'string' },
      seed: { type: 'string' },
      'source-revision': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'confirm-remote-cost': { type: 'boolean', default: false },
      'confirm-key-rotated': { type: 'boolean', default: false },
      'max-calls': { type: 'string' },
      'max-budget-usd': { type: 'string' },
    },
  });
  const datasetId = selectedDataset(values.dataset);
  const command = Object.freeze({
    manifestPath: required(values.manifest, '--manifest'),
    phaseId: required(values.phase, '--phase'),
    ...(datasetId === undefined ? {} : { datasetId }),
    runId: safeRunId(values['run-id']),
    seed: required(values.seed, '--seed'),
    sourceRevision: hexadecimalRevision(values['source-revision']),
    dryRun: values['dry-run'] ?? false,
    confirmRemoteCost: values['confirm-remote-cost'] ?? false,
    confirmKeyRotated: values['confirm-key-rotated'] ?? false,
    ...(values['max-calls'] === undefined
      ? {}
      : { operatorMaxCalls: positiveInteger(values['max-calls'], '--max-calls') }),
    ...(values['max-budget-usd'] === undefined
      ? {}
      : { operatorBudgetUsd: positiveNumber(values['max-budget-usd'], '--max-budget-usd') }),
  });
  if (!command.dryRun && !command.confirmRemoteCost) {
    throw new TypeError('Live OpenAI matrix requires --confirm-remote-cost');
  }
  if (!command.dryRun && !command.confirmKeyRotated) {
    throw new TypeError('Live OpenAI matrix requires --confirm-key-rotated');
  }
  if (!command.dryRun && command.operatorMaxCalls === undefined) {
    throw new TypeError('Live OpenAI matrix requires --max-calls');
  }
  if (!command.dryRun && command.operatorBudgetUsd === undefined) {
    throw new TypeError('Live OpenAI matrix requires --max-budget-usd');
  }
  return command;
}

export async function createOpenAIBlueprintMatrixPlan(
  command: OpenAIBlueprintMatrixCommand,
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Promise<OpenAIBlueprintMatrixPlan> {
  const manifest = await loadManifest(command.manifestPath, cwd);
  assertOfficialEndpoint(manifest, environment);
  if (!ALLOWED_MODELS.includes(manifest.model)) {
    throw new TypeError(`OpenAI matrix model is not allowlisted: ${manifest.model}`);
  }
  const phase = manifest.phases.find(candidate => candidate.id === command.phaseId);
  if (!phase) throw new TypeError(`Unknown OpenAI matrix phase: ${command.phaseId}`);
  const datasets = selectDatasets(manifest, phase, command.datasetId);
  const datasetSnapshots = await Promise.all(
    datasets.map(dataset => snapshotDataset(dataset, cwd)),
  );
  const selectedCases = phase.case_ids ?? null;
  const expectedCalls = selectedCases === null
    ? phase.runs * datasets.reduce((total, dataset) => total + dataset.case_count, 0)
    : phase.runs * selectedCases.length;
  const maxCalls = Math.min(phase.max_calls, command.operatorMaxCalls ?? phase.max_calls);
  const budgetUsd = Math.min(phase.budget_usd, command.operatorBudgetUsd ?? phase.budget_usd);
  if (expectedCalls > maxCalls) {
    throw new TypeError(
      `OpenAI matrix expects ${expectedCalls} calls but effective cap is ${maxCalls}`,
    );
  }
  return Object.freeze({
    schema: 'pixiecore.openai-blueprint-matrix-plan/v2',
    provider: 'openai',
    endpoint: OFFICIAL_ENDPOINT,
    model: manifest.model,
    phase: phase.id,
    run_id: command.runId,
    seed: command.seed,
    source_revision: command.sourceRevision,
    runs: phase.runs,
    datasets: Object.freeze(datasets.map(dataset => dataset.id)),
    dataset_snapshots: Object.freeze(datasetSnapshots),
    selected_cases: selectedCases === null ? null : Object.freeze([...selectedCases]),
    expected_calls: expectedCalls,
    max_calls: maxCalls,
    budget_usd: budgetUsd,
    pricing: Object.freeze({ ...manifest.pricing }),
    artifact_directory: `${phase.artifact_directory.replace(/\/+$/u, '')}/${command.runId}`,
  });
}

export async function runOpenAIBlueprintMatrix(
  command: OpenAIBlueprintMatrixCommand,
  dependencies: MatrixDependencies = {},
): Promise<Readonly<{ plan: OpenAIBlueprintMatrixPlan; checkpointPath?: string }>> {
  const environment = dependencies.environment ?? getRuntimeEnvironment();
  const cwd = dependencies.cwd ?? process.cwd();
  const manifest = await loadManifest(command.manifestPath, cwd);
  const plan = await createOpenAIBlueprintMatrixPlan(command, environment, cwd);
  if (command.dryRun) return Object.freeze({ plan });
  if (!environment.OPENAI_API_KEY?.trim()) {
    throw new TypeError('OPENAI_API_KEY must be present in the process environment');
  }

  const phase = manifest.phases.find(candidate => candidate.id === plan.phase)!;
  const datasets = selectDatasets(manifest, phase, command.datasetId);
  const now = dependencies.now ?? (() => new Date());
  const ledger = new UsageLedger(plan.max_calls, plan.budget_usd, plan.pricing);
  const outputDirectory = resolve(cwd, plan.artifact_directory);
  await mkdir(dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory);
  const checkpointPath = resolve(outputDirectory, 'checkpoint.json');
  const results: DatasetResult[] = [];
  const startedAt = now().toISOString();
  await writeCheckpoint(checkpointPath, checkpoint(plan, startedAt, now(), ledger, results));

  try {
    for (let run = 1; run <= phase.runs; run++) {
      for (const dataset of datasets) {
        const result = phase.case_ids === undefined
          ? await executeDataset(command.seed, run, dataset, plan, ledger, dependencies, cwd, environment)
          : await executeSelectedCases(command.seed, run, dataset, phase.case_ids, plan, ledger, dependencies, cwd, environment);
        results.push(result);
        await writeCheckpoint(checkpointPath, checkpoint(plan, startedAt, now(), ledger, results));
        ledger.assertRunnable();
      }
    }
  } catch (error) {
    await writeCheckpoint(checkpointPath, checkpoint(
      plan,
      startedAt,
      now(),
      ledger,
      results,
      'halted',
      ledger.reason() ?? safeErrorName(error),
    ));
    throw error;
  }

  await writeCheckpoint(checkpointPath, checkpoint(
    plan,
    startedAt,
    now(),
    ledger,
    results,
    'completed',
  ));
  return Object.freeze({ plan, checkpointPath });
}

async function executeDataset(
  seed: string,
  run: number,
  dataset: DatasetEntry,
  plan: OpenAIBlueprintMatrixPlan,
  ledger: UsageLedger,
  dependencies: MatrixDependencies,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<DatasetResult> {
  const artifact = await (dependencies.runEvaluation ?? runBlueprintEvaluation)({
    datasetPath: dataset.path,
    cwd,
    seed: `${seed}/${dataset.id}/${run}`,
    runtimeOptions: runtimeOptions(plan.model, ledger, dependencies, environment),
    pricing: [pricingRule(plan)],
  });
  return sanitizeEvaluation(run, dataset, artifact);
}

async function executeSelectedCases(
  seed: string,
  run: number,
  dataset: DatasetEntry,
  caseIds: readonly string[],
  plan: OpenAIBlueprintMatrixPlan,
  ledger: UsageLedger,
  dependencies: MatrixDependencies,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<DatasetResult> {
  const cases: CaseResult[] = [];
  for (const caseId of caseIds) {
    const artifact = await (dependencies.runPlayground ?? runBlueprintPlayground)({
      datasetPath: dataset.path,
      cwd,
      caseId,
      mode: 'real',
      runtimeOptions: runtimeOptions(plan.model, ledger, dependencies, environment),
      pricing: [pricingRule(plan)],
    });
    cases.push(sanitizePlayground(caseId, artifact));
    ledger.assertRunnable();
  }
  return Object.freeze({
    run,
    dataset_id: dataset.id,
    role: dataset.role,
    summary: summarizeCases(cases),
    cases: Object.freeze(cases),
  });
}

function runtimeOptions(
  model: string,
  ledger: UsageLedger,
  dependencies: MatrixDependencies,
  environment: NodeJS.ProcessEnv,
) {
  const source = dependencies.createProvider?.(model) ?? createProvider('openai', {
    model,
    environment,
  });
  return {
    provider: guardProvider(source, ledger),
    model,
    environment,
    maxRetry: 0,
    mcpConfigPath: 'disabled',
    pluginConfigPath: 'disabled',
    logToConsole: false,
    logToFile: false,
  } as const;
}

function guardProvider(source: Provider, ledger: UsageLedger): Provider {
  return {
    name: source.name,
    model: source.model,
    supportsTools: source.supportsTools,
    supportsMultimodal: source.supportsMultimodal,
    supportsVision: () => source.supportsVision(),
    supportsFileInput: () => source.supportsFileInput(),
    getModelList: signal => source.getModelList(signal),
    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      ledger.beforeCall();
      try {
        const response = await source.generate(request);
        ledger.afterResponse(response);
        return response;
      } catch (error) {
        ledger.afterError();
        throw error;
      }
    },
    ...(source.close === undefined ? {} : { close: () => source.close!() }),
  };
}

class UsageLedger {
  private calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private totalTokens = 0;
  private estimatedCostUsd = 0;
  private complete = true;
  private haltReason: string | undefined;

  constructor(
    private readonly maxCalls: number,
    private readonly budgetUsd: number,
    private readonly pricing: Pricing,
  ) {}

  beforeCall(): void {
    this.assertRunnable();
    if (this.calls >= this.maxCalls) {
      this.haltReason = 'call_cap_reached';
      throw new TypeError('OpenAI matrix call cap reached');
    }
    this.calls++;
  }

  afterResponse(response: GenerateResponse): void {
    const usage = response.usage;
    if (
      usage?.inputTokens === undefined
      || usage.outputTokens === undefined
      || usage.totalTokens === undefined
    ) {
      this.complete = false;
      this.haltReason = 'missing_provider_usage';
      throw new TypeError('OpenAI response omitted complete token usage');
    }
    this.inputTokens += tokenCount(usage.inputTokens, 'inputTokens');
    this.outputTokens += tokenCount(usage.outputTokens, 'outputTokens');
    this.totalTokens += tokenCount(usage.totalTokens, 'totalTokens');
    this.estimatedCostUsd = cost(this.inputTokens, this.outputTokens, this.pricing);
    if (this.estimatedCostUsd > this.budgetUsd) {
      this.haltReason = 'observed_budget_exceeded';
      throw new TypeError('OpenAI matrix observed cost exceeded the USD budget cap');
    }
  }

  afterError(): void {
    if (this.haltReason) return;
    this.complete = false;
    this.haltReason = 'provider_error_cost_unknown';
  }

  assertRunnable(): void {
    if (this.haltReason) throw new TypeError(`OpenAI matrix halted: ${this.haltReason}`);
  }

  snapshot(): UsageSnapshot {
    return Object.freeze({
      calls: this.calls,
      input_tokens: this.inputTokens,
      output_tokens: this.outputTokens,
      total_tokens: this.totalTokens,
      estimated_cost_usd: this.estimatedCostUsd,
      complete: this.complete,
    });
  }

  reason(): string | undefined {
    return this.haltReason;
  }
}

async function loadManifest(path: string, cwd: string): Promise<MatrixManifest> {
  const [value, schema] = await Promise.all([
    readFile(resolve(cwd, path), 'utf8').then(source => JSON.parse(source) as unknown),
    readFile(MANIFEST_SCHEMA, 'utf8').then(source => JSON.parse(source) as object),
  ]);
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(value)) {
    throw new TypeError(`Invalid OpenAI Blueprint run manifest: ${JSON.stringify(validate.errors)}`);
  }
  return value as MatrixManifest;
}

function selectDatasets(
  manifest: MatrixManifest,
  phase: PhaseEntry,
  requestedDatasetId?: string,
): readonly DatasetEntry[] {
  const indexed = new Map(manifest.datasets.map(dataset => [dataset.id, dataset]));
  const selectedIds = requestedDatasetId === undefined
    ? phase.dataset_ids
    : [requestedDatasetId];
  if (requestedDatasetId !== undefined && !phase.dataset_ids.includes(requestedDatasetId)) {
    throw new TypeError(
      `OpenAI matrix dataset ${requestedDatasetId} is not included in phase ${phase.id}`,
    );
  }
  return Object.freeze(selectedIds.map(id => {
    const dataset = indexed.get(id);
    if (!dataset) throw new TypeError(`Unknown OpenAI matrix dataset: ${id}`);
    return dataset;
  }));
}

function assertOfficialEndpoint(manifest: MatrixManifest, environment: NodeJS.ProcessEnv): void {
  const configured = environment.OPENAI_BASE_URL?.trim().replace(/\/+$/u, '') || OFFICIAL_ENDPOINT;
  if (manifest.endpoint !== OFFICIAL_ENDPOINT || configured !== OFFICIAL_ENDPOINT) {
    throw new TypeError('OpenAI matrix permits only https://api.openai.com/v1');
  }
}

function pricingRule(plan: OpenAIBlueprintMatrixPlan): TelemetryPricingRule {
  return Object.freeze({
    provider: 'openai',
    model: plan.model,
    currency: plan.pricing.currency,
    inputPerMillionTokens: plan.pricing.input_per_million_tokens,
    outputPerMillionTokens: plan.pricing.output_per_million_tokens,
    source: plan.pricing.source,
    effectiveAt: plan.pricing.verified_at,
  });
}

function sanitizeEvaluation(
  run: number,
  dataset: DatasetEntry,
  artifact: BlueprintEvaluationResultArtifact,
): DatasetResult {
  return Object.freeze({
    run,
    dataset_id: dataset.id,
    role: dataset.role,
    summary: Object.freeze({ ...artifact.summary }),
    cases: Object.freeze(artifact.cases.map(item => Object.freeze({
      id: item.id,
      status: item.status,
      duration_ms: item.duration_ms,
      provider_usage: item.provider_usage ?? Object.freeze([]),
      error_name: item.error?.name ?? null,
      ...(item.limitations === undefined ? {} : { limitations: item.limitations }),
    }))),
  });
}

function sanitizePlayground(caseId: string, artifact: BlueprintPlaygroundArtifact): CaseResult {
  const real = artifact.real;
  if (!real) throw new TypeError(`OpenAI canary did not produce a real result: ${caseId}`);
  return Object.freeze({
    id: caseId,
    status: real.comparison.passed ? 'passed' : 'failed',
    duration_ms: null,
    provider_usage: real.provider_usage ?? Object.freeze([]),
    error_name: null,
    ...(real.comparison.limitations === undefined ? {} : { limitations: real.comparison.limitations }),
  });
}

function summarizeCases(cases: readonly CaseResult[]) {
  return Object.freeze({
    total: cases.length,
    passed: cases.filter(item => item.status === 'passed').length,
    failed: cases.filter(item => item.status === 'failed').length,
    errors: cases.filter(item => item.status === 'error').length,
  });
}

async function snapshotDataset(
  dataset: DatasetEntry,
  cwd: string,
): Promise<OpenAIBlueprintDatasetSnapshot> {
  const datasetPath = resolve(cwd, dataset.path);
  const datasetSource = await readFile(datasetPath, 'utf8');
  const document = parse(datasetSource) as {
    version?: unknown;
    blueprint?: Readonly<{ path?: unknown; version?: unknown }>;
    cases?: readonly Readonly<{ id?: unknown; comparison?: unknown }>[];
  };
  const datasetVersion = nonBlankIdentity(document.version, 'dataset version');
  const blueprintReference = nonBlankIdentity(document.blueprint?.path, 'Blueprint path');
  const declaredBlueprintVersion = nonBlankIdentity(
    document.blueprint?.version,
    'Blueprint version',
  );
  const blueprintSource = await readFile(resolve(dirname(datasetPath), blueprintReference), 'utf8');
  const blueprint = parse(blueprintSource) as { version?: unknown };
  const blueprintVersion = nonBlankIdentity(blueprint.version, 'Blueprint source version');
  if (blueprintVersion !== declaredBlueprintVersion) {
    throw new TypeError(
      `Dataset ${dataset.id} declares Blueprint ${declaredBlueprintVersion} but source is ${blueprintVersion}`,
    );
  }
  if (!Array.isArray(document.cases) || document.cases.length === 0) {
    throw new TypeError(`Dataset ${dataset.id} must contain comparison cases`);
  }
  const comparisonPolicies = document.cases.map((item, index) => Object.freeze({
    id: nonBlankIdentity(item.id, `dataset case ${index + 1} id`),
    comparison: item.comparison,
  }));
  return Object.freeze({
    dataset_id: dataset.id,
    dataset_version: datasetVersion,
    dataset_digest: sha256(datasetSource),
    blueprint_version: blueprintVersion,
    blueprint_digest: sha256(blueprintSource),
    comparison_policy_digest: sha256(stableJson(comparisonPolicies)),
  });
}

function nonBlankIdentity(value: unknown, name: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  throw new TypeError(`${name} must be a non-blank string`);
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized !== undefined) return serialized;
  throw new TypeError('Comparison policy identity contains a non-JSON value');
}

function checkpoint(
  plan: OpenAIBlueprintMatrixPlan,
  startedAt: string,
  now: Date,
  ledger: UsageLedger,
  results: readonly DatasetResult[],
  status: MatrixCheckpoint['status'] = 'running',
  haltReason: string | null = null,
): MatrixCheckpoint {
  const updatedAt = now.toISOString();
  return Object.freeze({
    schema: 'pixiecore.openai-blueprint-matrix-checkpoint/v2',
    status,
    plan,
    started_at: startedAt,
    updated_at: updatedAt,
    completed_at: status === 'running' ? null : updatedAt,
    usage: ledger.snapshot(),
    results: Object.freeze([...results]),
    halt_reason: haltReason,
  });
}

async function writeCheckpoint(path: string, value: MatrixCheckpoint): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function required(value: string | undefined, name: string): string {
  if (value?.trim()) return value.trim();
  throw new TypeError(`${name} is required and must be non-blank`);
}

function selectedDataset(value: string | undefined): string | undefined {
  if (value === undefined || value === 'all') return undefined;
  return required(value, '--dataset');
}

function safeRunId(value: string | undefined): string {
  const id = required(value, '--run-id');
  if (/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(id)) return id;
  throw new TypeError('--run-id must contain only lowercase letters, digits, dot, underscore, or hyphen');
}

function hexadecimalRevision(value: string | undefined): string {
  const revision = required(value, '--source-revision');
  if (/^[0-9a-f]{7,64}$/iu.test(revision)) return revision.toLowerCase();
  throw new TypeError('--source-revision must be a hexadecimal revision');
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 213) return parsed;
  throw new TypeError(`${name} must be an integer from 1 through 213`);
}

function positiveNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 25) return parsed;
  throw new TypeError(`${name} must be greater than zero and at most 25`);
}

function tokenCount(value: number, name: string): number {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`Provider usage ${name} must be a non-negative safe integer`);
}

function cost(inputTokens: number, outputTokens: number, pricing: Pricing): number {
  return (
    inputTokens * pricing.input_per_million_tokens
    + outputTokens * pricing.output_per_million_tokens
  ) / 1_000_000;
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && error.name.trim() ? error.name : 'Error';
}

export function openAIBlueprintMatrixUsage(): string {
  return `Usage:
  npm run benchmark:openai -- --phase=<canary|baseline|repeated> \\
    [--dataset=<dataset-id>] --run-id=<stable-id> --seed=<seed> \\
    --source-revision=<git-sha> --dry-run

Remove --dry-run only after review, then add both --confirm-remote-cost and
--confirm-key-rotated plus explicit --max-calls and --max-budget-usd ceilings.
OPENAI_API_KEY is read only from the environment.`;
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes('--help')) {
    console.log(openAIBlueprintMatrixUsage());
    return;
  }
  const result = await runOpenAIBlueprintMatrix(
    parseOpenAIBlueprintMatrixArgs(process.argv.slice(2)),
  );
  if (result.checkpointPath) console.log(`OpenAI matrix checkpoint: ${result.checkpointPath}`);
  else console.log(JSON.stringify(result.plan, null, 2));
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

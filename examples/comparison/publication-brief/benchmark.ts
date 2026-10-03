import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import {
  createProvider,
  getRuntimeEnvironment,
  type GenerateRequest,
  type GenerateResponse,
  type Provider,
} from '@pixieworks/pixiecore';
import type { PublicationBriefResult } from '../../application-composition/publication-brief.js';
import { createPublicationBriefApproachExecutors } from './benchmark-approaches.js';
import {
  PUBLICATION_BRIEF_BENCHMARK_APPROACHES,
  PUBLICATION_BRIEF_BENCHMARK_ARCHITECTURE,
  type PublicationBriefApproachExecutor,
  type PublicationBriefBenchmarkApproach,
  type PublicationBriefBenchmarkAssertions,
  type PublicationBriefBenchmarkDataset,
  type PublicationBriefBenchmarkPricing,
  type PublicationBriefBenchmarkUsage,
} from './benchmark-contract.js';

const DEFAULT_DATASET = 'examples/comparison/publication-brief/benchmark-dataset.json';
const DEFAULT_OUTPUT_ROOT = 'benchmarks/results/openai/adjacent-patterns';
const DATASET_SCHEMA = new URL('./benchmark-dataset-v1.schema.json', import.meta.url);
const REPORT_SCHEMA = new URL('./benchmark-report-v1.schema.json', import.meta.url);
const OFFICIAL_ENDPOINT = 'https://api.openai.com/v1';
const MODEL = 'gpt-4.1-mini-2025-04-14';
const PRICING = Object.freeze({
  input_per_million_tokens: 0.4,
  output_per_million_tokens: 1.6,
  source: 'https://developers.openai.com/api/docs/pricing',
  verified_at: '2026-08-26T00:00:00.000Z',
});
const MAX_MANIFEST_CALLS = 144;
const MAX_MANIFEST_BUDGET_USD = 0.50;
let reportValidatorPromise: Promise<ValidateFunction> | undefined;

export interface PublicationBriefBenchmarkCommand {
  readonly datasetPath: string;
  readonly outputRoot: string;
  readonly runId: string;
  readonly seed: string;
  readonly runs: number;
  readonly dryRun: boolean;
  readonly confirmRemoteCost: boolean;
  readonly confirmKeyRotated: boolean;
  readonly maxCalls?: number;
  readonly maxBudgetUsd?: number;
}

export interface PublicationBriefBenchmarkPlan {
  readonly schema: 'pixiecore.publication-brief-adjacent-pattern-plan/v1';
  readonly provider: 'openai';
  readonly endpoint: typeof OFFICIAL_ENDPOINT;
  readonly model: typeof MODEL;
  readonly dataset_path: string;
  readonly dataset_sha256: string;
  readonly dataset_version: string;
  readonly cases: number;
  readonly approaches: typeof PUBLICATION_BRIEF_BENCHMARK_APPROACHES;
  readonly runs: number;
  readonly seed: string;
  readonly expected_provider_calls: number;
  readonly max_calls: number;
  readonly max_budget_usd: number;
  readonly output_directory: string;
}

interface BenchmarkDependencies {
  readonly environment?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly cwd?: string;
  readonly createExecutors?: (
    ledger: UsageLedger,
  ) => readonly PublicationBriefApproachExecutor[];
}

interface BenchmarkCaseResult {
  readonly run: number;
  readonly approach: PublicationBriefBenchmarkApproach;
  readonly case_id: string;
  readonly status: 'passed' | 'failed' | 'error';
  readonly duration_ms: number;
  readonly failure_codes: readonly string[];
  readonly error_name: string | null;
  readonly assertions: Readonly<{ total: number; passed: number; failed: number }>;
  readonly usage: PublicationBriefBenchmarkUsage;
}

interface BenchmarkApproachResult {
  readonly id: PublicationBriefBenchmarkApproach;
  readonly architecture: typeof PUBLICATION_BRIEF_BENCHMARK_ARCHITECTURE[PublicationBriefBenchmarkApproach];
  readonly summary: Readonly<{ total: number; passed: number; failed: number; errors: number }>;
  readonly accuracy: number;
  readonly assertion_summary: Readonly<{ total: number; passed: number; failed: number }>;
  readonly assertion_accuracy: number;
  readonly latency_ms: Readonly<{ mean: number; p50: number; p95: number }>;
  readonly usage: PublicationBriefBenchmarkUsage;
  readonly observations: readonly BenchmarkCaseResult[];
}

interface BenchmarkReport {
  readonly $schema: './benchmark-report-v1.schema.json';
  readonly schema: 'pixiecore.publication-brief-adjacent-pattern-benchmark/v1';
  readonly status: 'running' | 'completed' | 'halted';
  readonly plan: PublicationBriefBenchmarkPlan;
  readonly started_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
  readonly methodology: Readonly<{
    input_contract: 'identical-synthetic-cases';
    output_contract: 'publication-brief-typed-result';
    comparison: 'deterministic-term-and-field-assertions';
    retry_policy: 'none';
    execution_order: 'run-case-approach';
    seed_scope: 'runner-order-only';
  }>;
  readonly pricing: typeof PRICING;
  readonly ledger: UsageSnapshot;
  readonly approaches: readonly BenchmarkApproachResult[];
  readonly halt_reason: string | null;
  readonly limitations: readonly string[];
}

interface UsageSnapshot {
  readonly calls: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
  readonly estimated_cost_usd: number;
  readonly complete: boolean;
}

export function parsePublicationBriefBenchmarkArgs(
  args: readonly string[],
): PublicationBriefBenchmarkCommand {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: {
      dataset: { type: 'string', default: DEFAULT_DATASET },
      'output-root': { type: 'string', default: DEFAULT_OUTPUT_ROOT },
      'run-id': { type: 'string' },
      seed: { type: 'string' },
      runs: { type: 'string', default: '3' },
      'dry-run': { type: 'boolean', default: false },
      'confirm-remote-cost': { type: 'boolean', default: false },
      'confirm-key-rotated': { type: 'boolean', default: false },
      'max-calls': { type: 'string' },
      'max-budget-usd': { type: 'string' },
    },
  });
  const command = Object.freeze({
    datasetPath: required(values.dataset, '--dataset'),
    outputRoot: required(values['output-root'], '--output-root'),
    runId: safeRunId(values['run-id']),
    seed: required(values.seed, '--seed'),
    runs: positiveInteger(values.runs, '--runs', 10),
    dryRun: values['dry-run'] ?? false,
    confirmRemoteCost: values['confirm-remote-cost'] ?? false,
    confirmKeyRotated: values['confirm-key-rotated'] ?? false,
    ...(values['max-calls'] === undefined
      ? {}
      : { maxCalls: positiveInteger(values['max-calls'], '--max-calls', MAX_MANIFEST_CALLS) }),
    ...(values['max-budget-usd'] === undefined
      ? {}
      : { maxBudgetUsd: positiveNumber(values['max-budget-usd'], '--max-budget-usd') }),
  });
  if (command.dryRun) return command;
  if (!command.confirmRemoteCost) throw new TypeError('Live benchmark requires --confirm-remote-cost');
  if (!command.confirmKeyRotated) throw new TypeError('Live benchmark requires --confirm-key-rotated');
  if (command.maxCalls === undefined) throw new TypeError('Live benchmark requires --max-calls');
  if (command.maxBudgetUsd === undefined) {
    throw new TypeError('Live benchmark requires --max-budget-usd');
  }
  return command;
}

export async function createPublicationBriefBenchmarkPlan(
  command: PublicationBriefBenchmarkCommand,
  cwd = process.cwd(),
): Promise<PublicationBriefBenchmarkPlan> {
  const { dataset, bytes } = await loadDataset(command.datasetPath, cwd);
  const expectedCalls = dataset.cases.length
    * command.runs
    * PUBLICATION_BRIEF_BENCHMARK_APPROACHES.reduce(
      (total, id) => total + PUBLICATION_BRIEF_BENCHMARK_ARCHITECTURE[id].provider_calls_per_case,
      0,
    );
  const maxCalls = Math.min(command.maxCalls ?? MAX_MANIFEST_CALLS, MAX_MANIFEST_CALLS);
  const maxBudgetUsd = Math.min(
    command.maxBudgetUsd ?? MAX_MANIFEST_BUDGET_USD,
    MAX_MANIFEST_BUDGET_USD,
  );
  if (expectedCalls > maxCalls) {
    throw new TypeError(`Benchmark expects ${expectedCalls} calls but effective cap is ${maxCalls}`);
  }
  return Object.freeze({
    schema: 'pixiecore.publication-brief-adjacent-pattern-plan/v1',
    provider: 'openai',
    endpoint: OFFICIAL_ENDPOINT,
    model: MODEL,
    dataset_path: command.datasetPath,
    dataset_sha256: sha256(bytes),
    dataset_version: dataset.version,
    cases: dataset.cases.length,
    approaches: PUBLICATION_BRIEF_BENCHMARK_APPROACHES,
    runs: command.runs,
    seed: command.seed,
    expected_provider_calls: expectedCalls,
    max_calls: maxCalls,
    max_budget_usd: maxBudgetUsd,
    output_directory: `${command.outputRoot.replace(/\/+$/u, '')}/${command.runId}`,
  });
}

export async function runPublicationBriefBenchmark(
  command: PublicationBriefBenchmarkCommand,
  dependencies: BenchmarkDependencies = {},
): Promise<Readonly<{ plan: PublicationBriefBenchmarkPlan; reportPath?: string; scorecardPath?: string }>> {
  const cwd = dependencies.cwd ?? process.cwd();
  const plan = await createPublicationBriefBenchmarkPlan(command, cwd);
  if (command.dryRun) return Object.freeze({ plan });
  const environment = dependencies.environment ?? getRuntimeEnvironment();
  if (!environment.OPENAI_API_KEY?.trim() && dependencies.createExecutors === undefined) {
    throw new TypeError('OPENAI_API_KEY must be present in the process environment');
  }
  assertOfficialEndpoint(environment);
  const { dataset } = await loadDataset(command.datasetPath, cwd);
  const now = dependencies.now ?? (() => new Date());
  const ledger = new UsageLedger(plan.max_calls, plan.max_budget_usd, PRICING);
  const executors = dependencies.createExecutors?.(ledger)
    ?? createPublicationBriefApproachExecutors({
      pricing: PRICING,
      createProvider: () => guardProvider(
        createProvider('openai', { model: MODEL, environment }),
        ledger,
      ),
    });
  assertExecutorSet(executors);

  const outputDirectory = resolve(cwd, plan.output_directory);
  await mkdir(dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory);
  const reportPath = resolve(outputDirectory, 'report.json');
  const scorecardPath = resolve(outputDirectory, 'scorecard.md');
  const startedAt = now().toISOString();
  const observations: BenchmarkCaseResult[] = [];
  await writeReport(reportPath, createReport(plan, startedAt, now(), ledger, observations));

  try {
    for (let run = 1; run <= plan.runs; run++) {
      for (const benchmarkCase of dataset.cases) {
        for (const executor of executors) {
          observations.push(await executeCase(executor, benchmarkCase, run));
          ledger.assertRunnable();
          await writeReport(reportPath, createReport(plan, startedAt, now(), ledger, observations));
        }
      }
    }
  } catch (error) {
    const halted = createReport(
      plan,
      startedAt,
      now(),
      ledger,
      observations,
      'halted',
      ledger.reason() ?? safeErrorName(error),
    );
    await writeReport(reportPath, halted);
    throw error;
  }

  const report = createReport(plan, startedAt, now(), ledger, observations, 'completed');
  await writeReport(reportPath, report);
  await writeFile(scorecardPath, renderScorecard(report), { encoding: 'utf8', flag: 'wx' });
  return Object.freeze({ plan, reportPath, scorecardPath });
}

/** Recomputes assertion-level scores from value-free failure codes without provider calls. */
export async function reviewPublicationBriefBenchmarkEvidence(options: Readonly<{
  reportPath: string;
  datasetPath?: string;
  outputReportPath: string;
  outputScorecardPath: string;
  cwd?: string;
  reviewedAt?: Date;
}>): Promise<Readonly<{ reportPath: string; scorecardPath: string }>> {
  const cwd = options.cwd ?? process.cwd();
  const sourcePath = resolve(cwd, options.reportPath);
  const source = JSON.parse(await readFile(sourcePath, 'utf8')) as BenchmarkReport;
  const datasetPath = options.datasetPath ?? source.plan.dataset_path;
  const { dataset, bytes } = await loadDataset(datasetPath, cwd);
  if (sha256(bytes) !== source.plan.dataset_sha256) {
    throw new TypeError('Review dataset does not match the benchmark report hash');
  }
  const byId = new Map(dataset.cases.map(item => [item.id, item.assertions]));
  const observations = source.approaches.flatMap(approach => approach.observations.map(item => {
    const assertions = byId.get(item.case_id);
    if (!assertions) throw new TypeError(`Unknown benchmark case in report: ${item.case_id}`);
    const total = assertionCount(assertions);
    const failed = item.status === 'error' ? total : item.failure_codes.length;
    return Object.freeze({
      ...item,
      assertions: Object.freeze({ total, passed: total - failed, failed }),
      usage: item.approach === 'code-only' ? zeroUsage() : item.usage,
    });
  }));
  const reviewedAt = options.reviewedAt ?? new Date();
  const reviewed = Object.freeze({
    ...source,
    updated_at: reviewedAt.toISOString(),
    approaches: Object.freeze(PUBLICATION_BRIEF_BENCHMARK_APPROACHES.map(id => (
      aggregateApproach(id, observations.filter(item => item.approach === id))
    ))),
  });
  const reportPath = resolve(cwd, options.outputReportPath);
  const scorecardPath = resolve(cwd, options.outputScorecardPath);
  if (reportPath === sourcePath) throw new TypeError('Reviewed report must not overwrite source evidence');
  if (reportPath === scorecardPath) throw new TypeError('Reviewed report and scorecard paths must differ');
  await Promise.all([mkdir(dirname(reportPath), { recursive: true }), mkdir(dirname(scorecardPath), { recursive: true })]);
  await validateReport(reviewed);
  await Promise.all([
    writeFile(reportPath, `${JSON.stringify(reviewed, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }),
    writeFile(scorecardPath, renderScorecard(reviewed), { encoding: 'utf8', flag: 'wx' }),
  ]);
  return Object.freeze({ reportPath, scorecardPath });
}

async function executeCase(
  executor: PublicationBriefApproachExecutor,
  benchmarkCase: PublicationBriefBenchmarkDataset['cases'][number],
  run: number,
): Promise<BenchmarkCaseResult> {
  const started = performance.now();
  try {
    const execution = await executor.execute({
      sourceText: benchmarkCase.input.source_text,
      locale: benchmarkCase.input.locale,
    }, { run, caseId: benchmarkCase.id });
    const failureCodes = compareResult(execution.result, benchmarkCase.assertions);
    const assertionTotal = assertionCount(benchmarkCase.assertions);
    return Object.freeze({
      run,
      approach: executor.id,
      case_id: benchmarkCase.id,
      status: failureCodes.length === 0 ? 'passed' : 'failed',
      duration_ms: elapsed(started),
      failure_codes: Object.freeze(failureCodes),
      error_name: null,
      assertions: Object.freeze({
        total: assertionTotal,
        passed: assertionTotal - failureCodes.length,
        failed: failureCodes.length,
      }),
      usage: execution.usage,
    });
  } catch (error) {
    const assertionTotal = assertionCount(benchmarkCase.assertions);
    return Object.freeze({
      run,
      approach: executor.id,
      case_id: benchmarkCase.id,
      status: 'error',
      duration_ms: elapsed(started),
      failure_codes: Object.freeze([]),
      error_name: safeErrorName(error),
      assertions: Object.freeze({ total: assertionTotal, passed: 0, failed: assertionTotal }),
      usage: executor.id === 'code-only' ? zeroUsage() : unknownUsage(),
    });
  }
}

export function compareResult(
  result: PublicationBriefResult,
  expected: PublicationBriefBenchmarkAssertions,
): string[] {
  return [
    ...missingTerms('extraction.title', result.extraction.title, expected.title_terms),
    ...missingTerms('extraction.audience', result.extraction.audience, expected.audience_terms),
    ...missingTerms('extraction.facts', result.extraction.facts.join('\n'), expected.fact_terms),
    ...(result.classification.category === expected.category ? [] : ['classification.category']),
    ...missingTerms('summary.summary', result.summary.summary, expected.summary_terms),
    ...(result.validation.valid === expected.valid ? [] : ['validation.valid']),
    ...(expected.valid && result.validation.issues.length > 0 ? ['validation.issues'] : []),
    ...(result.localization.locale === expected.locale ? [] : ['localization.locale']),
    ...missingTerms(
      'localization.localized_summary',
      result.localization.localized_summary,
      expected.localized_summary_terms,
    ),
  ];
}

function createReport(
  plan: PublicationBriefBenchmarkPlan,
  startedAt: string,
  updatedAt: Date,
  ledger: UsageLedger,
  observations: readonly BenchmarkCaseResult[],
  status: BenchmarkReport['status'] = 'running',
  haltReason: string | null = null,
): BenchmarkReport {
  return Object.freeze({
    $schema: './benchmark-report-v1.schema.json',
    schema: 'pixiecore.publication-brief-adjacent-pattern-benchmark/v1',
    status,
    plan,
    started_at: startedAt,
    updated_at: updatedAt.toISOString(),
    completed_at: status === 'completed' ? updatedAt.toISOString() : null,
    methodology: Object.freeze({
      input_contract: 'identical-synthetic-cases',
      output_contract: 'publication-brief-typed-result',
      comparison: 'deterministic-term-and-field-assertions',
      retry_policy: 'none',
      execution_order: 'run-case-approach',
      seed_scope: 'runner-order-only',
    }),
    pricing: PRICING,
    ledger: ledger.snapshot(),
    approaches: Object.freeze(PUBLICATION_BRIEF_BENCHMARK_APPROACHES.map(id => (
      aggregateApproach(id, observations.filter(item => item.approach === id))
    ))),
    halt_reason: haltReason,
    limitations: Object.freeze([
      'The four-case synthetic corpus is evidence for this task only, not a universal architecture ranking.',
      'The code-only target intentionally supports the two labeled records and rejects prose inputs.',
      'The monolithic target shares PixieCore provider transport and schema validation to isolate prompt shape.',
      'The agent-graph target uses one model planning call plus five schema-constrained worker calls.',
      'Runner seeds identify order and replay; the provider API does not guarantee deterministic output.',
      'Development time and organizational maintainability were not measured.',
    ]),
  });
}

function aggregateApproach(
  id: PublicationBriefBenchmarkApproach,
  observations: readonly BenchmarkCaseResult[],
): BenchmarkApproachResult {
  const passed = observations.filter(item => item.status === 'passed').length;
  const failed = observations.filter(item => item.status === 'failed').length;
  const errors = observations.filter(item => item.status === 'error').length;
  const total = observations.length;
  const assertionSummary = observations.reduce((summary, observation) => ({
    total: summary.total + observation.assertions.total,
    passed: summary.passed + observation.assertions.passed,
    failed: summary.failed + observation.assertions.failed,
  }), { total: 0, passed: 0, failed: 0 });
  const latencies = observations.map(item => item.duration_ms);
  return Object.freeze({
    id,
    architecture: PUBLICATION_BRIEF_BENCHMARK_ARCHITECTURE[id],
    summary: Object.freeze({ total, passed, failed, errors }),
    accuracy: total === 0 ? 0 : passed / total,
    assertion_summary: Object.freeze(assertionSummary),
    assertion_accuracy: assertionSummary.total === 0
      ? 0
      : assertionSummary.passed / assertionSummary.total,
    latency_ms: Object.freeze({
      mean: mean(latencies),
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
    }),
    usage: aggregateUsage(observations.map(item => item.usage)),
    observations: Object.freeze([...observations]),
  });
}

export function renderScorecard(report: BenchmarkReport): string {
  const rows = report.approaches.map(approach => [
    approach.id,
    `${approach.summary.passed}/${approach.summary.total}`,
    percent(approach.accuracy),
    percent(approach.assertion_accuracy),
    String(approach.usage.provider_calls),
    approach.usage.total_tokens === null ? 'n/a' : String(approach.usage.total_tokens),
    approach.usage.estimated_cost_usd === null
      ? 'n/a'
      : approach.usage.estimated_cost_usd.toFixed(6),
    approach.latency_ms.p50.toFixed(1),
    approach.latency_ms.p95.toFixed(1),
  ]);
  return `# Publication brief adjacent-pattern benchmark\n\n`
    + `- Status: ${report.status}\n`
    + `- Provider/model: ${report.plan.provider} / ${report.plan.model}\n`
    + `- Dataset: ${report.plan.dataset_version} (${report.plan.dataset_sha256})\n`
    + `- Runs: ${report.plan.runs}\n`
    + `- Seed: ${report.plan.seed} (runner order only)\n`
    + `- Completed: ${report.completed_at ?? 'not completed'}\n`
    + `- Pricing: ${report.pricing.source}, verified ${report.pricing.verified_at}\n\n`
    + `| Approach | Complete cases | Case accuracy | Assertion accuracy | Calls | Tokens | Estimated USD | p50 ms | p95 ms |\n`
    + `|---|---:|---:|---:|---:|---:|---:|---:|---:|\n`
    + rows.map(row => `| ${row.join(' | ')} |`).join('\n')
    + `\n\n## Claim boundary\n\n`
    + report.limitations.map(item => `- ${item}`).join('\n')
    + '\n';
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
    private readonly pricing: PublicationBriefBenchmarkPricing,
  ) {}

  beforeCall(): void {
    this.assertRunnable();
    if (this.calls >= this.maxCalls) {
      this.haltReason = 'call_cap_reached';
      throw new TypeError('Publication brief benchmark call cap reached');
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
    this.inputTokens += tokenCount(usage.inputTokens);
    this.outputTokens += tokenCount(usage.outputTokens);
    this.totalTokens += tokenCount(usage.totalTokens);
    this.estimatedCostUsd = (
      this.inputTokens * this.pricing.input_per_million_tokens
      + this.outputTokens * this.pricing.output_per_million_tokens
    ) / 1_000_000;
    if (this.estimatedCostUsd > this.budgetUsd) {
      this.haltReason = 'observed_budget_exceeded';
      throw new TypeError('Publication brief benchmark exceeded the USD budget cap');
    }
  }

  afterError(): void {
    if (this.haltReason) return;
    this.complete = false;
    this.haltReason = 'provider_error_cost_unknown';
  }

  assertRunnable(): void {
    if (this.haltReason) throw new TypeError(`Benchmark halted: ${this.haltReason}`);
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

async function loadDataset(
  datasetPath: string,
  cwd: string,
): Promise<Readonly<{ dataset: PublicationBriefBenchmarkDataset; bytes: Buffer }>> {
  const [bytes, schemaSource] = await Promise.all([
    readFile(resolve(cwd, datasetPath)),
    readFile(DATASET_SCHEMA, 'utf8'),
  ]);
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(schemaSource));
  if (!validate(value)) throw new TypeError(`Invalid benchmark dataset: ${validate.errors?.[0]?.message}`);
  const dataset = value as PublicationBriefBenchmarkDataset;
  if (new Set(dataset.cases.map(item => item.id)).size !== dataset.cases.length) {
    throw new TypeError('Benchmark case IDs must be unique');
  }
  return Object.freeze({ dataset, bytes });
}

async function writeReport(path: string, report: BenchmarkReport): Promise<void> {
  await validateReport(report);
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

async function validateReport(report: BenchmarkReport): Promise<void> {
  reportValidatorPromise ??= readFile(REPORT_SCHEMA, 'utf8').then(source => (
    new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(source))
  ));
  const validate = await reportValidatorPromise;
  if (!validate(report)) {
    throw new TypeError(`Invalid benchmark report: ${validate.errors?.[0]?.message}`);
  }
}

function assertExecutorSet(executors: readonly PublicationBriefApproachExecutor[]): void {
  const ids = executors.map(item => item.id);
  if (
    ids.length === PUBLICATION_BRIEF_BENCHMARK_APPROACHES.length
    && PUBLICATION_BRIEF_BENCHMARK_APPROACHES.every(id => ids.includes(id))
    && new Set(ids).size === ids.length
  ) return;
  throw new TypeError('Benchmark executors must contain each required approach exactly once');
}

function assertOfficialEndpoint(environment: NodeJS.ProcessEnv): void {
  const configured = environment.OPENAI_BASE_URL?.trim();
  if (!configured || configured.replace(/\/+$/u, '') === OFFICIAL_ENDPOINT) return;
  throw new TypeError('Benchmark only permits the official OpenAI API endpoint');
}

function missingTerms(fieldName: string, value: string, terms: readonly string[]): string[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US');
  return terms
    .filter(term => !normalized.includes(term.normalize('NFKC').toLocaleLowerCase('en-US')))
    .map(term => `${fieldName}:${term}`);
}

function assertionCount(assertions: PublicationBriefBenchmarkAssertions): number {
  return assertions.title_terms.length
    + assertions.audience_terms.length
    + assertions.fact_terms.length
    + 1
    + assertions.summary_terms.length
    + 1
    + (assertions.valid ? 1 : 0)
    + 1
    + assertions.localized_summary_terms.length;
}

function aggregateUsage(usages: readonly PublicationBriefBenchmarkUsage[]): PublicationBriefBenchmarkUsage {
  const complete = usages.every(item => (
    item.input_tokens !== null
    && item.output_tokens !== null
    && item.total_tokens !== null
    && item.estimated_cost_usd !== null
  ));
  return Object.freeze({
    provider_calls: usages.reduce((total, item) => total + item.provider_calls, 0),
    input_tokens: complete ? usages.reduce((total, item) => total + item.input_tokens!, 0) : null,
    output_tokens: complete ? usages.reduce((total, item) => total + item.output_tokens!, 0) : null,
    total_tokens: complete ? usages.reduce((total, item) => total + item.total_tokens!, 0) : null,
    estimated_cost_usd: complete
      ? usages.reduce((total, item) => total + item.estimated_cost_usd!, 0)
      : null,
  });
}

function unknownUsage(): PublicationBriefBenchmarkUsage {
  return Object.freeze({
    provider_calls: 0,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    estimated_cost_usd: null,
  });
}

function zeroUsage(): PublicationBriefBenchmarkUsage {
  return Object.freeze({
    provider_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
  });
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1]!;
}

function elapsed(started: number): number {
  return Math.max(0, performance.now() - started);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function tokenCount(value: number): number {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError('Provider token usage must be a non-negative safe integer');
}

function safeErrorName(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(error.name)) {
    return error.name;
  }
  return 'UnknownError';
}

function required(value: string | undefined, name: string): string {
  if (value?.trim()) return value.trim();
  throw new TypeError(`${name} is required and must be non-blank`);
}

function positiveInteger(value: string | undefined, name: string, maximum: number): number {
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum) return parsed;
  throw new TypeError(`${name} must be an integer from 1 through ${maximum}`);
}

function positiveNumber(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_MANIFEST_BUDGET_USD) return parsed;
  throw new TypeError(`${name} must be greater than 0 and at most ${MAX_MANIFEST_BUDGET_USD}`);
}

function safeRunId(value: string | undefined): string {
  const result = required(value, '--run-id');
  if (/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(result)) return result;
  throw new TypeError('--run-id must contain only lowercase letters, digits, dot, underscore, or dash');
}

export function publicationBriefBenchmarkUsage(): string {
  return `Usage:
  node --import tsx examples/comparison/publication-brief/benchmark.ts \\
    --run-id=<id> --seed=<seed> --runs=3 --dry-run

Live execution additionally requires --confirm-remote-cost,
--confirm-key-rotated, --max-calls=144, and --max-budget-usd=0.50.
Credentials are read only from the project environment.`;
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes('--help')) {
    console.log(publicationBriefBenchmarkUsage());
    return;
  }
  const output = await runPublicationBriefBenchmark(
    parsePublicationBriefBenchmarkArgs(process.argv.slice(2)),
  );
  if (output.reportPath) {
    console.log(`Benchmark report: ${output.reportPath}`);
    console.log(`Benchmark scorecard: ${output.scorecardPath}`);
  } else console.log(JSON.stringify(output.plan, null, 2));
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

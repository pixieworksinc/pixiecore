/**
 * Coordinates benchmark responsibilities inside the PixieCore kernel.
 */

import { randomUUID } from 'node:crypto';
import type {
  BlueprintBenchmarkArtifact,
  BlueprintBenchmarkOptions,
  BlueprintBenchmarkPricing,
  BlueprintBenchmarkRunResult,
  BlueprintBenchmarkTarget,
  BlueprintBenchmarkTargetResult,
  BlueprintEvaluationResultArtifact,
} from '../../contracts/evaluation/index.js';
import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  RuntimeOptions,
} from '../../contracts/types/index.js';
import { runBlueprintEvaluation } from './runner.js';

export const BLUEPRINT_BENCHMARK_SCHEMA = 'pixiecore.blueprint-benchmark/v1' as const;

interface MeterSnapshot {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

interface CompletedRun {
  readonly artifact: BlueprintEvaluationResultArtifact;
  readonly result: BlueprintBenchmarkRunResult;
  readonly latencies: readonly number[];
}

/** Executes an explicit provider/model matrix. Calling this function may incur provider cost. */
export async function runBlueprintBenchmark(
  options: BlueprintBenchmarkOptions,
): Promise<BlueprintBenchmarkArtifact> {
  const runsPerTarget = positiveRunCount(options.runsPerTarget ?? 3);
  const seed = nonBlank(options.seed ?? randomUUID(), 'seed');
  validateTargets(options.targets);
  const startedAt = new Date();
  let source: BlueprintEvaluationResultArtifact | undefined;
  const targets: BlueprintBenchmarkTargetResult[] = [];

  for (const target of options.targets) {
    const completed: CompletedRun[] = [];
    for (let run = 1; run <= runsPerTarget; run++) {
      const runSeed = `${seed}/${target.id}/${run}`;
      const runtimeOptions = await target.createRuntimeOptions({
        targetId: target.id,
        run,
        seed: runSeed,
      });
      const meter = explicitMeteredProvider(target.id, runtimeOptions);
      const artifact = await runBlueprintEvaluation({
        datasetPath: options.datasetPath,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        seed: runSeed,
        runtimeOptions: { ...runtimeOptions, provider: meter.provider },
        ...(options.customComparators === undefined
          ? {}
          : { customComparators: options.customComparators }),
      });
      if (source === undefined) source = artifact;
      else assertSameSources(source, artifact);
      completed.push(completeRun(run, artifact, meter.snapshot(), target.pricing));
    }
    targets.push(aggregateTarget(target, completed));
  }

  if (source === undefined) throw new TypeError('targets must contain at least one target');
  return Object.freeze({
    schema: BLUEPRINT_BENCHMARK_SCHEMA,
    dataset: Object.freeze({ ...source.dataset }),
    blueprint: Object.freeze({ ...source.blueprint }),
    benchmark: Object.freeze({
      id: randomUUID(),
      seed,
      seed_scope: 'runner',
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      runs_per_target: runsPerTarget,
    }),
    targets: Object.freeze(targets),
  });
}

function explicitMeteredProvider(
  targetId: string,
  options: RuntimeOptions,
): { readonly provider: Provider; readonly snapshot: () => MeterSnapshot } {
  if (!options.provider || typeof options.provider === 'string') {
    throw new TypeError(
      `Benchmark target ${targetId} must create an explicit Provider instance for every run`,
    );
  }
  const source = options.provider;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let calls = 0;
  let completeUsage = true;
  const provider: Provider = {
    name: source.name,
    model: options.model ?? source.model,
    supportsTools: source.supportsTools,
    supportsMultimodal: source.supportsMultimodal,
    supportsVision: () => source.supportsVision(),
    supportsFileInput: () => source.supportsFileInput(),
    getModelList: signal => source.getModelList(signal),
    /**
     * Creates the requested operation according to the containing class contract.
     */
    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      calls++;
      const response = await source.generate(request);
      const usage = response.usage;
      if (
        usage?.inputTokens === undefined
        || usage.outputTokens === undefined
        || usage.totalTokens === undefined
      ) {
        completeUsage = false;
        return response;
      }
      inputTokens += tokenCount(usage.inputTokens, 'inputTokens');
      outputTokens += tokenCount(usage.outputTokens, 'outputTokens');
      totalTokens += tokenCount(usage.totalTokens, 'totalTokens');
      return response;
    },
    ...(source.close === undefined ? {} : { close: () => source.close!() }),
  };
  return {
    provider,
    snapshot: () => completeUsage && calls > 0
      ? { inputTokens, outputTokens, totalTokens }
      : { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function completeRun(
  run: number,
  artifact: BlueprintEvaluationResultArtifact,
  usage: MeterSnapshot,
  pricing: BlueprintBenchmarkPricing | undefined,
): CompletedRun {
  const latencies = artifact.cases.map(item => item.duration_ms);
  const limitations = [...new Set(artifact.cases.flatMap(item => item.limitations ?? []))];
  return {
    artifact,
    latencies,
    result: Object.freeze({
      run,
      seed: artifact.run.seed,
      summary: Object.freeze({ ...artifact.summary }),
      accuracy: ratio(artifact.summary.passed, artifact.summary.total),
      ...(limitations.length === 0 ? {} : { limitations: Object.freeze(limitations) }),
      latency_ms: mean(latencies),
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      cost: calculateCost(usage, pricing),
    }),
  };
}

function aggregateTarget(
  target: BlueprintBenchmarkTarget,
  runs: readonly CompletedRun[],
): BlueprintBenchmarkTargetResult {
  const first = runs[0]!.artifact;
  for (const completed of runs) {
    if (
      completed.artifact.run.provider !== first.run.provider
      || completed.artifact.run.model !== first.run.model
    ) {
      throw new TypeError(`Benchmark target ${target.id} changed provider or model between runs`);
    }
  }
  const totals = sumSummaries(runs.map(item => item.artifact.summary));
  const limitations = [...new Set(runs.flatMap(item => item.result.limitations ?? []))];
  const accuracies = runs.map(item => item.result.accuracy);
  const latencies = runs.flatMap(item => item.latencies);
  const usage = aggregateUsage(runs.map(item => item.result));
  const totalCost = runs.every(item => item.result.cost !== null)
    ? runs.reduce((total, item) => total + item.result.cost!, 0)
    : null;
  return Object.freeze({
    id: target.id,
    provider: first.run.provider,
    model: first.run.model,
    pricing: target.pricing === undefined ? null : Object.freeze({ ...target.pricing }),
    totals: Object.freeze(totals),
    accuracy: ratio(totals.passed, totals.total),
    ...(limitations.length === 0 ? {} : { limitations: Object.freeze(limitations) }),
    accuracy_standard_deviation: standardDeviation(accuracies),
    latency_ms: Object.freeze({
      mean: mean(latencies),
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      standard_deviation: standardDeviation(latencies),
    }),
    usage,
    cost: totalCost === null || target.pricing === undefined
      ? null
      : Object.freeze({
          currency: target.pricing.currency,
          total: totalCost,
          mean_per_case: totalCost / totals.total,
        }),
    runs: Object.freeze(runs.map(item => item.result)),
  });
}

function validateTargets(targets: readonly BlueprintBenchmarkTarget[]): void {
  if (targets.length === 0) throw new TypeError('targets must contain at least one target');
  const ids = new Set<string>();
  for (const target of targets) {
    const id = nonBlank(target.id, 'target id');
    if (ids.has(id)) throw new TypeError(`Duplicate benchmark target id: ${id}`);
    ids.add(id);
    if (typeof target.createRuntimeOptions !== 'function') {
      throw new TypeError(`Benchmark target ${id} requires createRuntimeOptions`);
    }
    if (target.pricing) validatePricing(target.pricing, id);
  }
}

function validatePricing(pricing: BlueprintBenchmarkPricing, targetId: string): void {
  nonBlank(pricing.currency, `pricing currency for ${targetId}`);
  for (const [name, value] of [
    ['inputPerMillionTokens', pricing.inputPerMillionTokens],
    ['outputPerMillionTokens', pricing.outputPerMillionTokens],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`Benchmark target ${targetId} pricing ${name} must be non-negative`);
    }
  }
}

function assertSameSources(
  expected: BlueprintEvaluationResultArtifact,
  actual: BlueprintEvaluationResultArtifact,
): void {
  if (
    expected.dataset.sha256 === actual.dataset.sha256
    && expected.blueprint.sha256 === actual.blueprint.sha256
    && expected.blueprint.version === actual.blueprint.version
  ) return;
  throw new TypeError('Benchmark dataset or Blueprint changed between runs');
}

function aggregateUsage(
  runs: readonly BlueprintBenchmarkRunResult[],
): BlueprintBenchmarkTargetResult['usage'] {
  if (runs.some(run => (
    run.input_tokens === null || run.output_tokens === null || run.total_tokens === null
  ))) return null;
  return Object.freeze({
    input_tokens: runs.reduce((total, run) => total + run.input_tokens!, 0),
    output_tokens: runs.reduce((total, run) => total + run.output_tokens!, 0),
    total_tokens: runs.reduce((total, run) => total + run.total_tokens!, 0),
  });
}

function calculateCost(
  usage: MeterSnapshot,
  pricing: BlueprintBenchmarkPricing | undefined,
): number | null {
  if (pricing === undefined || usage.inputTokens === null || usage.outputTokens === null) return null;
  return (
    usage.inputTokens * pricing.inputPerMillionTokens
    + usage.outputTokens * pricing.outputPerMillionTokens
  ) / 1_000_000;
}

function sumSummaries(
  summaries: readonly BlueprintEvaluationResultArtifact['summary'][],
): BlueprintEvaluationResultArtifact['summary'] {
  return summaries.reduce((total, summary) => ({
    total: total.total + summary.total,
    passed: total.passed + summary.passed,
    failed: total.failed + summary.failed,
    errors: total.errors + summary.errors,
  }), { total: 0, passed: 0, failed: 0, errors: 0 });
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : value / total;
}

function positiveRunCount(value: number): number {
  if (Number.isSafeInteger(value) && value >= 1 && value <= 100) return value;
  throw new TypeError('runsPerTarget must be a safe integer from 1 through 100');
}

function tokenCount(value: number, name: string): number {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`Provider usage ${name} must be a non-negative safe integer`);
}

function nonBlank(value: string, name: string): string {
  if (value.trim()) return value;
  throw new TypeError(`${name} must be non-blank`);
}

/**
 * Coordinates scorecard responsibilities inside the PixieCore kernel.
 */

import type {
  BlueprintBenchmarkArtifact,
  BlueprintBenchmarkScorecardOptions,
  BlueprintBenchmarkTargetResult,
} from '../../contracts/evaluation/index.js';

/** Renders a value-free release scorecard from one benchmark artifact. */
export function renderBlueprintBenchmarkScorecard(
  artifact: BlueprintBenchmarkArtifact,
  options: BlueprintBenchmarkScorecardOptions,
): string {
  const release = nonBlank(options.release, 'release');
  const generatedAt = isoTimestamp(options.generatedAt);
  const reproductionCommand = nonBlank(
    options.reproductionCommand,
    'reproductionCommand',
  );
  const methodology = nonBlank(options.methodology, 'methodology');
  const priced = artifact.targets.some(target => target.pricing !== null);
  const pricingSource = options.pricingSource?.trim();
  if (priced && !pricingSource) {
    throw new TypeError('pricingSource is required when the benchmark contains pricing');
  }

  const lines = [
    `# PixieCore Blueprint benchmark scorecard — ${markdown(release)}`,
    '',
    '## Reproducibility',
    '',
    '| Field | Value |',
    '|---|---|',
    row('Generated at', generatedAt),
    row('Dataset', `${artifact.dataset.name} ${artifact.dataset.version}`),
    row('Dataset path', artifact.dataset.path),
    row('Dataset SHA-256', artifact.dataset.sha256),
    row('Blueprint', `${artifact.blueprint.path} @ ${artifact.blueprint.version}`),
    row('Blueprint SHA-256', artifact.blueprint.sha256),
    row('Benchmark ID', artifact.benchmark.id),
    row('Runner seed', artifact.benchmark.seed),
    row('Runs per target', artifact.benchmark.runs_per_target),
    row('Methodology', methodology),
    ...(pricingSource ? [row('Pricing source', pricingSource)] : []),
    '',
    '```bash',
    reproductionCommand,
    '```',
    '',
    '## Results',
    '',
    '| Target | Provider / model | Runs | Cases | Comparator pass rate | Pass rate SD | Latency mean / p50 / p95 | Tokens | Cost |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|',
    ...artifact.targets.map(targetRow),
    '',
    '> The accuracy fields report configured comparator pass rates, not a general factuality guarantee.',
    ...artifact.targets.filter(target => target.limitations?.includes('factuality_not_evaluated'))
      .map(target => `> ${markdown(target.id)}: includes structural comparisons; factuality was not evaluated for those comparisons.`),
    '> Pass rate is always shown with passed and total case counts. The runner seed identifies',
    '> this benchmark; it does not prove control over remote model sampling.',
    '',
  ];
  return lines.join('\n');
}

function targetRow(target: BlueprintBenchmarkTargetResult): string {
  const runs = target.runs.length;
  const accuracy = `${target.totals.passed}/${target.totals.total} (${percent(target.accuracy)})`;
  const latency = [
    target.latency_ms.mean,
    target.latency_ms.p50,
    target.latency_ms.p95,
  ].map(milliseconds).join(' / ');
  const tokens = target.usage === null
    ? 'n/a'
    : `${target.usage.input_tokens} in + ${target.usage.output_tokens} out = ${target.usage.total_tokens}`;
  const cost = target.cost === null
    ? 'n/a'
    : `${target.cost.currency} ${decimal(target.cost.total)}`;
  return `| ${markdown(target.id)} | ${markdown(`${target.provider} / ${target.model}`)} | ${runs} | ${target.totals.total} | ${accuracy} | ${decimal(target.accuracy_standard_deviation)} | ${latency} | ${tokens} | ${cost} |`;
}

function row(name: string, value: string | number): string {
  return `| ${markdown(name)} | ${markdown(String(value))} |`;
}

function percent(value: number): string {
  return `${decimal(value * 100)}%`;
}

function milliseconds(value: number): string {
  return `${decimal(value)} ms`;
}

function decimal(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function markdown(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\r', ' ').replaceAll('\n', ' ');
}

function isoTimestamp(value: string): string {
  const normalized = nonBlank(value, 'generatedAt');
  if (new Date(normalized).toISOString() === normalized) return normalized;
  throw new TypeError('generatedAt must be an ISO UTC timestamp');
}

function nonBlank(value: string, name: string): string {
  if (value.trim()) return value;
  throw new TypeError(`${name} must be non-blank`);
}

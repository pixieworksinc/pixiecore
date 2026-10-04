import { mkdir, open, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import type { EvaluationLimitation } from '@pixieworks/pixiecore/eval';

interface ReportCommand {
  readonly checkpointPath: string;
  readonly manifestPath: string;
  readonly jsonPath: string;
  readonly markdownPath: string;
}

interface ProviderUsage {
  readonly calls: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
  readonly estimated_cost?: Readonly<{ currency: string; amount: number }>;
}

interface CaseResult {
  readonly id: string;
  readonly status: 'passed' | 'failed' | 'error';
  readonly duration_ms: number | null;
  readonly provider_usage: readonly ProviderUsage[];
  readonly error_name: string | null;
  readonly limitations?: readonly EvaluationLimitation[];
}

interface DatasetResult {
  readonly run: number;
  readonly dataset_id: string;
  readonly role: string;
  readonly cases: readonly CaseResult[];
}

interface DatasetSnapshot {
  readonly dataset_id: string;
  readonly dataset_version: string;
  readonly dataset_digest: string;
  readonly blueprint_version: string;
  readonly blueprint_digest: string;
  readonly comparison_policy_digest: string;
}

interface Checkpoint {
  readonly schema: string;
  readonly status: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly usage: Readonly<{
    calls: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
    complete: boolean;
  }>;
  readonly plan: Readonly<{
    provider: string;
    model: string;
    phase: string;
    run_id: string;
    seed: string;
    source_revision?: string;
    runs: number;
    datasets: readonly string[];
    dataset_snapshots?: readonly DatasetSnapshot[];
    expected_calls: number;
    max_calls: number;
    budget_usd: number;
    pricing: Readonly<{
      currency: string;
      input_per_million_tokens: number;
      output_per_million_tokens: number;
      source: string;
      verified_at: string;
    }>;
  }>;
  readonly results: readonly DatasetResult[];
}

type VerifiedCheckpoint = Checkpoint & Readonly<{
  schema: 'pixiecore.openai-blueprint-matrix-checkpoint/v2';
  completed_at: string;
  plan: Checkpoint['plan'] & Readonly<{
    source_revision: string;
    dataset_snapshots: readonly DatasetSnapshot[];
  }>;
}>;

interface AttachmentEntry {
  readonly case_id: string;
  readonly kind: string;
  readonly path: string;
}

interface ManifestDataset {
  readonly id: string;
  readonly role: string;
  readonly path: string;
  readonly attachments: readonly AttachmentEntry[];
}

interface Manifest {
  readonly release: string;
  readonly datasets: readonly ManifestDataset[];
  readonly phases: readonly Readonly<{
    readonly id: string;
    readonly dataset_ids: readonly string[];
  }>[];
}

export interface OpenAIExtractorAttachmentResult {
  readonly case_id: string;
  readonly attachment_kind: string;
  readonly attachment_path: string;
  readonly runs: number;
  readonly passed: number;
  readonly failed: number;
  readonly errors: number;
  readonly accuracy: number;
  readonly limitations?: readonly EvaluationLimitation[];
  readonly latency_ms: Readonly<{ mean: number; p50: number; p95: number }>;
  readonly usage: Readonly<{
    calls: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
  }>;
}

export interface OpenAIExtractorAttachmentReport {
  readonly schema: 'pixiecore.openai-extractor-attachment-report/v2';
  readonly generated_at: string;
  readonly release: string;
  readonly provider: string;
  readonly model: string;
  readonly seed: string;
  readonly source_revision: string;
  readonly runs: number;
  readonly dataset: Readonly<{
    id: string;
    version: string;
    digest: string;
    blueprint_version: string;
    blueprint_digest: string;
    comparison_policy_digest: string;
  }>;
  readonly comparison_note: string;
  readonly totals: Readonly<{
    cases: number;
    observations: number;
    passed: number;
    failed: number;
    errors: number;
    accuracy: number;
  }>;
  readonly attachments: readonly OpenAIExtractorAttachmentResult[];
  readonly pricing: Checkpoint['plan']['pricing'];
}

export interface OpenAIBlueprintRoleScore {
  readonly limitations?: readonly EvaluationLimitation[];
  readonly dataset_id: string;
  readonly role: string;
  readonly dataset_version: string;
  readonly dataset_digest: string;
  readonly blueprint_version: string;
  readonly blueprint_digest: string;
  readonly comparison_policy_digest: string;
  readonly runs: number;
  readonly observations: number;
  readonly passed: number;
  readonly failed: number;
  readonly errors: number;
  readonly accuracy: number;
  readonly accuracy_by_run: readonly number[];
  readonly accuracy_standard_deviation: number;
  readonly latency_ms: Readonly<{ mean: number; p50: number; p95: number }>;
  readonly usage: Readonly<{
    calls: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
  }>;
  readonly known_failures: readonly Readonly<{
    case_id: string;
    failed_runs: readonly number[];
    error_runs: readonly number[];
    error_names: readonly string[];
  }>[];
}

export interface OpenAIBlueprintScorecard {
  readonly schema: 'pixiecore.openai-blueprint-scorecard/v2';
  readonly release: string;
  readonly generated_at: string;
  readonly execution: Readonly<{
    started_at: string;
    completed_at: string;
    provider: string;
    model: string;
    phase: string;
    run_id: string;
    seed: string;
    source_revision: string;
    runs: number;
    expected_calls: number;
  }>;
  readonly methodology: string;
  readonly reproduction_command: string;
  readonly totals: Readonly<{
    observations: number;
    passed: number;
    failed: number;
    errors: number;
    accuracy: number;
    accuracy_by_run: readonly number[];
    accuracy_standard_deviation: number;
    latency_ms: Readonly<{ mean: number; p50: number; p95: number }>;
    usage: Checkpoint['usage'];
  }>;
  readonly roles: readonly OpenAIBlueprintRoleScore[];
  readonly pricing: Checkpoint['plan']['pricing'];
  readonly known_limitations: readonly string[];
}

export function parseOpenAIExtractorReportArgs(args: readonly string[]): ReportCommand {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: {
      checkpoint: { type: 'string' },
      manifest: { type: 'string' },
      json: { type: 'string' },
      markdown: { type: 'string' },
    },
  });
  const command = Object.freeze({
    checkpointPath: required(values.checkpoint, '--checkpoint'),
    manifestPath: required(values.manifest, '--manifest'),
    jsonPath: required(values.json, '--json'),
    markdownPath: required(values.markdown, '--markdown'),
  });
  if (resolve(command.jsonPath) === resolve(command.markdownPath)) {
    throw new TypeError('--json and --markdown must identify different files');
  }
  return command;
}

export async function createOpenAIExtractorAttachmentReport(
  checkpointPath: string,
  manifestPath: string,
  cwd = process.cwd(),
): Promise<OpenAIExtractorAttachmentReport> {
  const [checkpoint, manifest] = await Promise.all([
    loadJson<Checkpoint>(resolve(cwd, checkpointPath)),
    loadJson<Manifest>(resolve(cwd, manifestPath)),
  ]);
  assertCompletedCheckpoint(checkpoint, 'Extractor report');
  const dataset = manifest.datasets.find(item => item.role === 'extractor');
  if (!dataset || dataset.attachments.length === 0) {
    throw new TypeError('OpenAI manifest must declare one extractor dataset with attachments');
  }
  const results = checkpoint.results.filter(item => item.dataset_id === dataset.id);
  if (results.length !== checkpoint.plan.runs) {
    throw new TypeError('Extractor result count does not match checkpoint run count');
  }
  const identity = datasetSnapshot(checkpoint, dataset.id);
  const attachments = dataset.attachments.map(attachment => aggregateAttachment(
    attachment,
    results,
    checkpoint.plan.runs,
  ));
  const totals = attachments.reduce((summary, item) => ({
    cases: summary.cases + 1,
    observations: summary.observations + item.runs,
    passed: summary.passed + item.passed,
    failed: summary.failed + item.failed,
    errors: summary.errors + item.errors,
  }), { cases: 0, observations: 0, passed: 0, failed: 0, errors: 0 });
  return Object.freeze({
    schema: 'pixiecore.openai-extractor-attachment-report/v2',
    generated_at: checkpoint.completed_at,
    release: manifest.release,
    provider: checkpoint.plan.provider,
    model: checkpoint.plan.model,
    seed: checkpoint.plan.seed,
    source_revision: checkpoint.plan.source_revision,
    runs: checkpoint.plan.runs,
    dataset: Object.freeze({
      id: dataset.id,
      version: identity.dataset_version,
      digest: identity.dataset_digest,
      blueprint_version: identity.blueprint_version,
      blueprint_digest: identity.blueprint_digest,
      comparison_policy_digest: identity.comparison_policy_digest,
    }),
    comparison_note: 'Pass rates use each versioned dataset comparison policy; exact comparison may reject other contract-valid outputs.',
    totals: Object.freeze({
      ...totals,
      accuracy: ratio(totals.passed, totals.observations),
    }),
    attachments: Object.freeze(attachments),
    pricing: Object.freeze({ ...checkpoint.plan.pricing }),
  });
}

export function renderOpenAIExtractorAttachmentReport(
  report: OpenAIExtractorAttachmentReport,
): string {
  return [
    '# OpenAI Extractor attachment quality',
    '',
    '| Field | Value |',
    '|---|---|',
    row('Generated at', report.generated_at),
    row('Release', report.release),
    row('Provider / model', `${report.provider} / ${report.model}`),
    row('Source revision', report.source_revision),
    row('Dataset', `${report.dataset.id} ${report.dataset.version}`),
    row('Blueprint version', report.dataset.blueprint_version),
    row('Runs', report.runs),
    row('Seed', report.seed),
    row('Overall', `${report.totals.passed}/${report.totals.observations} (${percent(report.totals.accuracy)})`),
    row('Pricing source', report.pricing.source),
    '',
    '## Results by attachment kind',
    '',
    '| Kind | Case | Pass / observations | Comparator pass rate | Latency mean / p50 / p95 | Tokens | Estimated cost |',
    '|---|---|---:|---:|---:|---:|---:|',
    ...report.attachments.map(item => `| ${markdown(item.attachment_kind)} | ${markdown(item.case_id)} | ${item.passed}/${item.runs} | ${percent(item.accuracy)} | ${milliseconds(item.latency_ms.mean)} / ${milliseconds(item.latency_ms.p50)} / ${milliseconds(item.latency_ms.p95)} | ${item.usage.input_tokens} in + ${item.usage.output_tokens} out = ${item.usage.total_tokens} | USD ${decimal(item.usage.estimated_cost_usd)} |`),
    '',
    `> ${report.comparison_note}`,
    ...report.attachments.filter(item => item.limitations?.includes('factuality_not_evaluated'))
      .map(item => `> ${markdown(item.case_id)}: includes structural comparisons; factuality was not evaluated for those observations.`),
    '',
  ].join('\n');
}

export async function createOpenAIBlueprintScorecard(
  checkpointPath: string,
  manifestPath: string,
  cwd = process.cwd(),
): Promise<OpenAIBlueprintScorecard> {
  const [checkpoint, manifest] = await Promise.all([
    loadJson<Checkpoint>(resolve(cwd, checkpointPath)),
    loadJson<Manifest>(resolve(cwd, manifestPath)),
  ]);
  assertCompletedCheckpoint(checkpoint, 'Scorecard');
  const datasets = selectedManifestDatasets(manifest, checkpoint.plan.datasets);
  const roleScores = datasets.map(dataset => {
    const identity = datasetSnapshot(checkpoint, dataset.id);
    return aggregateRole(
      dataset,
      checkpoint.results.filter(item => item.dataset_id === dataset.id),
      checkpoint.plan.runs,
      identity,
    );
  });
  const allCases = checkpoint.results.flatMap(result => result.cases);
  const runAccuracies = Array.from({ length: checkpoint.plan.runs }, (_, index) => {
    const run = index + 1;
    const cases = checkpoint.results.filter(result => result.run === run)
      .flatMap(result => result.cases);
    return ratio(cases.filter(item => item.status === 'passed').length, cases.length);
  });
  const observations = allCases.length;
  const passed = allCases.filter(item => item.status === 'passed').length;
  const durations = allCases.map(item => item.duration_ms)
    .filter((value): value is number => value !== null);
  if (durations.length !== observations) {
    throw new TypeError('Scorecard requires latency for every matrix observation');
  }
  return Object.freeze({
    schema: 'pixiecore.openai-blueprint-scorecard/v2',
    release: manifest.release,
    generated_at: checkpoint.completed_at!,
    execution: Object.freeze({
      started_at: checkpoint.started_at,
      completed_at: checkpoint.completed_at!,
      provider: checkpoint.plan.provider,
      model: checkpoint.plan.model,
      phase: checkpoint.plan.phase,
      run_id: checkpoint.plan.run_id,
      seed: checkpoint.plan.seed,
      source_revision: checkpoint.plan.source_revision,
      runs: checkpoint.plan.runs,
      expected_calls: checkpoint.plan.expected_calls,
    }),
    methodology: 'Versioned dataset comparison policies executed serially with retry disabled; accuracy is the configured comparator pass rate, not a general factuality guarantee.',
    reproduction_command: reproductionCommand(checkpoint, manifest),
    totals: Object.freeze({
      observations,
      passed,
      failed: allCases.filter(item => item.status === 'failed').length,
      errors: allCases.filter(item => item.status === 'error').length,
      accuracy: ratio(passed, observations),
      accuracy_by_run: Object.freeze(runAccuracies),
      accuracy_standard_deviation: standardDeviation(runAccuracies),
      latency_ms: distribution(durations),
      usage: Object.freeze({ ...checkpoint.usage }),
    }),
    roles: Object.freeze(roleScores),
    pricing: Object.freeze({ ...checkpoint.plan.pricing }),
    known_limitations: Object.freeze([
      'Results apply only to the pinned provider model and versioned synthetic corpus.',
      ...roleScores.filter(role => role.limitations?.includes('factuality_not_evaluated'))
        .map(role => `${role.dataset_id}: includes structural comparisons; factuality was not evaluated for those observations.`),
      'Exact natural-language comparisons may reject other contract-valid summaries or translations.',
      'The recorded seed identifies the run but does not prove control over remote model sampling.',
      'Extractor attachment quality is reported separately by media kind.',
    ]),
  });
}

function selectedManifestDatasets(
  manifest: Manifest,
  selectedIds: readonly string[],
): readonly ManifestDataset[] {
  if (selectedIds.length === 0) throw new TypeError('Checkpoint must select at least one dataset');
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new TypeError('Checkpoint selected duplicate datasets');
  }
  const byId = new Map(manifest.datasets.map(dataset => [dataset.id, dataset]));
  return Object.freeze(selectedIds.map(id => {
    const dataset = byId.get(id);
    if (!dataset) throw new TypeError(`Checkpoint selected unknown dataset: ${id}`);
    return dataset;
  }));
}

export function renderOpenAIBlueprintScorecard(report: OpenAIBlueprintScorecard): string {
  return [
    `# PixieCore OpenAI Blueprint scorecard ${markdown(report.release)}`,
    '',
    '## Reproducibility',
    '',
    '| Field | Value |',
    '|---|---|',
    row('Generated at', report.generated_at),
    row('Execution window', `${report.execution.started_at} to ${report.execution.completed_at}`),
    row('Provider / model', `${report.execution.provider} / ${report.execution.model}`),
    row('Run ID', report.execution.run_id),
    row('Runs', report.execution.runs),
    row('Seed', report.execution.seed),
    row('Source revision', report.execution.source_revision),
    row('Pricing source', report.pricing.source),
    row('Methodology', report.methodology),
    '',
    '```bash',
    report.reproduction_command,
    '```',
    '',
    '## Overall',
    '',
    `- Configured comparator pass rate: ${report.totals.passed}/${report.totals.observations} (${percent(report.totals.accuracy)})`,
    `- Run pass rate: ${report.totals.accuracy_by_run.map(percent).join(', ')}`,
    `- Pass rate standard deviation: ${decimal(report.totals.accuracy_standard_deviation)}`,
    `- Failures / errors: ${report.totals.failed} / ${report.totals.errors}`,
    `- Latency mean / p50 / p95: ${milliseconds(report.totals.latency_ms.mean)} / ${milliseconds(report.totals.latency_ms.p50)} / ${milliseconds(report.totals.latency_ms.p95)}`,
    `- Tokens: ${report.totals.usage.input_tokens} input + ${report.totals.usage.output_tokens} output = ${report.totals.usage.total_tokens}`,
    `- Estimated cost: USD ${decimal(report.totals.usage.estimated_cost_usd)}`,
    '',
    '## Results by Role',
    '',
    '| Role | Dataset / Blueprint version | Pass / observations | Comparator pass rate | Pass rate SD | Latency mean / p50 / p95 | Tokens | Cost |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
    ...report.roles.map(role => `| ${markdown(role.role)} | ${markdown(`${role.dataset_id} ${role.dataset_version} / ${role.blueprint_version}`)} | ${role.passed}/${role.observations} | ${percent(role.accuracy)} | ${decimal(role.accuracy_standard_deviation)} | ${milliseconds(role.latency_ms.mean)} / ${milliseconds(role.latency_ms.p50)} / ${milliseconds(role.latency_ms.p95)} | ${role.usage.input_tokens} in + ${role.usage.output_tokens} out | USD ${decimal(role.usage.estimated_cost_usd)} |`),
    '',
    '## Known failures',
    '',
    ...report.roles.flatMap(role => role.known_failures.length === 0
      ? [`- ${role.role}: none`]
      : role.known_failures.map(item => `- ${role.role}/${item.case_id}: failed runs [${item.failed_runs.join(', ')}], error runs [${item.error_runs.join(', ')}]${item.error_names.length === 0 ? '' : `, errors ${item.error_names.join(', ')}`}`)),
    '',
    '## Limitations',
    '',
    ...report.known_limitations.map(item => `- ${item}`),
    '',
  ].join('\n');
}

export async function writeOpenAIBlueprintScorecard(
  checkpointPath: string,
  manifestPath: string,
  jsonPath: string,
  markdownPath: string,
): Promise<void> {
  if (resolve(jsonPath) === resolve(markdownPath)) {
    throw new TypeError('JSON and Markdown scorecard outputs must identify different files');
  }
  const report = await createOpenAIBlueprintScorecard(checkpointPath, manifestPath);
  await writePair(
    resolve(jsonPath),
    `${JSON.stringify(report, null, 2)}\n`,
    resolve(markdownPath),
    renderOpenAIBlueprintScorecard(report),
  );
}

export async function writeOpenAIExtractorAttachmentReport(
  command: ReportCommand,
): Promise<void> {
  const report = await createOpenAIExtractorAttachmentReport(
    command.checkpointPath,
    command.manifestPath,
  );
  await writePair(
    resolve(command.jsonPath),
    `${JSON.stringify(report, null, 2)}\n`,
    resolve(command.markdownPath),
    renderOpenAIExtractorAttachmentReport(report),
  );
}

async function writePair(
  jsonPath: string,
  json: string,
  markdownPath: string,
  markdown: string,
): Promise<void> {
  await Promise.all([
    mkdir(dirname(jsonPath), { recursive: true }),
    mkdir(dirname(markdownPath), { recursive: true }),
  ]);
  let jsonFile: FileHandle | undefined;
  let markdownFile: FileHandle | undefined;
  try {
    jsonFile = await open(jsonPath, 'wx');
    markdownFile = await open(markdownPath, 'wx');
    await Promise.all([
      jsonFile.writeFile(json, 'utf8'),
      markdownFile.writeFile(markdown, 'utf8'),
    ]);
  } catch (error) {
    await Promise.all([
      jsonFile?.close(),
      markdownFile?.close(),
      jsonFile === undefined ? undefined : unlink(jsonPath),
      markdownFile === undefined ? undefined : unlink(markdownPath),
    ]);
    throw error;
  }
  await Promise.all([jsonFile.close(), markdownFile.close()]);
}

function aggregateRole(
  dataset: ManifestDataset,
  results: readonly DatasetResult[],
  runs: number,
  identity: DatasetSnapshot,
): OpenAIBlueprintRoleScore {
  if (results.length !== runs) throw new TypeError(`Run count mismatch: ${dataset.id}`);
  const cases = results.flatMap(result => result.cases);
  const limitations = [...new Set(cases.flatMap(item => item.limitations ?? []))];
  const observations = cases.length;
  const passed = cases.filter(item => item.status === 'passed').length;
  const durations = cases.map(item => item.duration_ms)
    .filter((value): value is number => value !== null);
  if (durations.length !== observations) throw new TypeError(`Missing latency: ${dataset.id}`);
  const accuracyByRun = results.map(result => ratio(
    result.cases.filter(item => item.status === 'passed').length,
    result.cases.length,
  ));
  const usage = aggregateUsage(cases);
  const caseIds = [...new Set(cases.map(item => item.id))].sort();
  const knownFailures = caseIds.flatMap(caseId => {
    const observationsForCase = results.map(result => ({
      run: result.run,
      case: result.cases.find(item => item.id === caseId),
    }));
    const failedRuns = observationsForCase
      .filter(item => item.case?.status === 'failed').map(item => item.run);
    const errorRuns = observationsForCase
      .filter(item => item.case?.status === 'error').map(item => item.run);
    if (failedRuns.length === 0 && errorRuns.length === 0) return [];
    return [Object.freeze({
      case_id: caseId,
      failed_runs: Object.freeze(failedRuns),
      error_runs: Object.freeze(errorRuns),
      error_names: Object.freeze([...new Set(observationsForCase.flatMap(item =>
        item.case?.status === 'error' && item.case.error_name !== null
          ? [item.case.error_name]
          : [],
      ))].sort()),
    })];
  });
  return Object.freeze({
    dataset_id: dataset.id,
    ...(limitations.length === 0 ? {} : { limitations: Object.freeze(limitations) }),
    role: dataset.role,
    dataset_version: identity.dataset_version,
    dataset_digest: identity.dataset_digest,
    blueprint_version: identity.blueprint_version,
    blueprint_digest: identity.blueprint_digest,
    comparison_policy_digest: identity.comparison_policy_digest,
    runs,
    observations,
    passed,
    failed: cases.filter(item => item.status === 'failed').length,
    errors: cases.filter(item => item.status === 'error').length,
    accuracy: ratio(passed, observations),
    accuracy_by_run: Object.freeze(accuracyByRun),
    accuracy_standard_deviation: standardDeviation(accuracyByRun),
    latency_ms: distribution(durations),
    usage,
    known_failures: Object.freeze(knownFailures),
  });
}

function aggregateUsage(cases: readonly CaseResult[]): OpenAIBlueprintRoleScore['usage'] {
  return Object.freeze(cases.flatMap(item => item.provider_usage).reduce<
    OpenAIBlueprintRoleScore['usage']
  >((total, item) => ({
    calls: total.calls + item.calls,
    input_tokens: total.input_tokens + item.input_tokens,
    output_tokens: total.output_tokens + item.output_tokens,
    total_tokens: total.total_tokens + item.total_tokens,
    estimated_cost_usd: total.estimated_cost_usd + (item.estimated_cost?.amount ?? 0),
  }), { calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 }));
}

function assertCompletedCheckpoint(
  checkpoint: Checkpoint,
  reportName: string,
): asserts checkpoint is VerifiedCheckpoint {
  if (checkpoint.schema !== 'pixiecore.openai-blueprint-matrix-checkpoint/v2'
      || checkpoint.status !== 'completed' || checkpoint.completed_at === null) {
    throw new TypeError(
      `${reportName} requires one completed v2 OpenAI matrix checkpoint with immutable identity`,
    );
  }
  if (!checkpoint.usage.complete) throw new TypeError(`${reportName} requires complete provider usage`);
  const revision = checkpoint.plan.source_revision;
  if (typeof revision !== 'string' || !/^[0-9a-f]{7,64}$/iu.test(revision)) {
    throw new TypeError(`${reportName} requires a hexadecimal source revision`);
  }
  const snapshots = checkpoint.plan.dataset_snapshots;
  if (!Array.isArray(snapshots) || snapshots.length !== checkpoint.plan.datasets.length) {
    throw new TypeError(`${reportName} requires one immutable identity per selected dataset`);
  }
  const selected = new Set(checkpoint.plan.datasets);
  const snapshotIds = new Set<string>();
  for (const snapshot of snapshots) {
    if (!selected.has(snapshot.dataset_id) || snapshotIds.has(snapshot.dataset_id)) {
      throw new TypeError(`${reportName} contains inconsistent dataset identities`);
    }
    snapshotIds.add(snapshot.dataset_id);
    version(snapshot.dataset_version, 'dataset version');
    version(snapshot.blueprint_version, 'Blueprint version');
    digest(snapshot.dataset_digest, 'dataset digest');
    digest(snapshot.blueprint_digest, 'Blueprint digest');
    digest(snapshot.comparison_policy_digest, 'comparison policy digest');
  }
}

/** Creates argv that the guarded matrix CLI can parse without shell evaluation. */
export function createOpenAIBlueprintReproductionArgs(
  checkpoint: Pick<VerifiedCheckpoint, 'plan'>,
  manifest: Pick<Manifest, 'phases'>,
): readonly string[] {
  const phase = manifest.phases.find(candidate => candidate.id === checkpoint.plan.phase);
  if (!phase) {
    throw new TypeError(`Checkpoint selected unknown phase: ${checkpoint.plan.phase}`);
  }
  const selected = checkpoint.plan.datasets;
  const isFullPhase = selected.length === phase.dataset_ids.length
    && selected.every((id, index) => id === phase.dataset_ids[index]);
  if (selected.length !== 1 && !isFullPhase) {
    throw new TypeError('Checkpoint dataset selection cannot be reproduced by the matrix CLI');
  }
  return Object.freeze([
    `--phase=${checkpoint.plan.phase}`,
    ...(selected.length === 1 ? [`--dataset=${selected[0]}`] : []),
    `--run-id=${checkpoint.plan.run_id}-replay`,
    `--seed=${checkpoint.plan.seed}`,
    `--source-revision=${checkpoint.plan.source_revision}`,
    '--confirm-remote-cost',
    '--confirm-key-rotated',
    `--max-calls=${checkpoint.plan.max_calls}`,
    `--max-budget-usd=${checkpoint.plan.budget_usd}`,
  ]);
}

function reproductionCommand(checkpoint: VerifiedCheckpoint, manifest: Manifest): string {
  return [
    'npm run benchmark:openai --',
    ...createOpenAIBlueprintReproductionArgs(checkpoint, manifest).map(shellArgument),
  ].join(' ');
}

function shellArgument(value: string): string {
  if (/^[a-zA-Z0-9_./:=+-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function standardDeviation(values: readonly number[]): number {
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + ((value - mean) ** 2), 0)
    / values.length;
  return Math.sqrt(variance);
}

function aggregateAttachment(
  attachment: AttachmentEntry,
  results: readonly DatasetResult[],
  runs: number,
): OpenAIExtractorAttachmentResult {
  const cases = results.map(result => {
    const item = result.cases.find(candidate => candidate.id === attachment.case_id);
    if (!item) throw new TypeError(`Missing extractor case: ${attachment.case_id}`);
    return item;
  });
  const limitations = [...new Set(cases.flatMap(item => item.limitations ?? []))];
  const durations = cases.map(item => item.duration_ms).filter((value): value is number => value !== null);
  if (durations.length !== runs) throw new TypeError(`Missing latency: ${attachment.case_id}`);
  const usage = cases.flatMap(item => item.provider_usage).reduce<
    OpenAIExtractorAttachmentResult['usage']
  >((total, item) => ({
    calls: total.calls + item.calls,
    input_tokens: total.input_tokens + item.input_tokens,
    output_tokens: total.output_tokens + item.output_tokens,
    total_tokens: total.total_tokens + item.total_tokens,
    estimated_cost_usd: total.estimated_cost_usd + (item.estimated_cost?.amount ?? 0),
  }), { calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 });
  const passed = cases.filter(item => item.status === 'passed').length;
  return Object.freeze({
    case_id: attachment.case_id,
    attachment_kind: attachment.kind,
    attachment_path: attachment.path,
    runs,
    passed,
    failed: cases.filter(item => item.status === 'failed').length,
    errors: cases.filter(item => item.status === 'error').length,
    accuracy: ratio(passed, runs),
    ...(limitations.length === 0 ? {} : { limitations: Object.freeze(limitations) }),
    latency_ms: distribution(durations),
    usage: Object.freeze(usage),
  });
}

function distribution(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return Object.freeze({
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  });
}

function percentile(sorted: readonly number[], quantile: number): number {
  return sorted[Math.ceil(quantile * sorted.length) - 1]!;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator > 0) return numerator / denominator;
  throw new TypeError('Cannot calculate an accuracy with zero observations');
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

function version(value: unknown, name: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  throw new TypeError(`${name} must be a non-blank string`);
}

function digest(value: unknown, name: string): string {
  if (typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value)) return value;
  throw new TypeError(`${name} must be a SHA-256 identity`);
}

function datasetSnapshot(checkpoint: VerifiedCheckpoint, datasetId: string): DatasetSnapshot {
  const snapshot = checkpoint.plan.dataset_snapshots.find(item => item.dataset_id === datasetId);
  if (snapshot) return snapshot;
  throw new TypeError(`Checkpoint is missing immutable dataset identity: ${datasetId}`);
}

function required(value: string | undefined, name: string): string {
  if (value?.trim()) return value.trim();
  throw new TypeError(`${name} is required and must be non-blank`);
}

async function loadJson<Value>(path: string): Promise<Value> {
  return JSON.parse(await readFile(path, 'utf8')) as Value;
}

async function main(): Promise<void> {
  const command = parseOpenAIExtractorReportArgs(process.argv.slice(2));
  await writeOpenAIExtractorAttachmentReport(command);
  console.log(`OpenAI Extractor report: ${resolve(command.markdownPath)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}

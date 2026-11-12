/** Multi-case fixture evaluation. This entry point cannot select a live provider. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareEvaluationOutput, type EvaluationComparisonResult } from '@pixieworks/pixiecore/eval';
import type { AgentRunResult, JsonObject, JsonValue } from './agent.js';
import { createSpendLedger } from './budget.js';
import { createOfflineManifest, type OfflineManifest } from './evidence.js';
import { createBoundedTransport, executeTriageGoal, OFFLINE_POLICY, OFFLINE_SPEND_POLICY,
  preflight, type RequestReceipt } from './harness.js';

export interface EvaluationCase {
  readonly id: string;
  readonly goal: string;
  readonly expected: { readonly category: string; readonly severity: string };
  readonly reviewNote: string;
}

export interface EvaluationData {
  readonly suite: { readonly schema: 'pixieagent.evaluation-cases/v0'; readonly cases: readonly EvaluationCase[] };
  readonly fixtures: { readonly schema: 'pixieagent.evaluation-fixtures/v0';
    readonly responses: Readonly<Record<string, readonly JsonValue[]>> };
}

export interface EvaluationScore {
  readonly passed: boolean;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly classification: EvaluationComparisonResult;
  /** Informational only: a legitimate summary may paraphrase the observation. */
  readonly reasonTextUnchanged: boolean;
  readonly factualityEvaluated: false;
}

export interface EvaluationCaseResult {
  readonly id: string;
  readonly expected: EvaluationCase['expected'];
  readonly reviewNote: string;
  readonly status: 'passed' | 'failed';
  readonly score: EvaluationScore | null;
  /** Includes attempted calls that can fail before producing an observation. */
  readonly attemptedBlueprints: readonly string[];
  readonly providerRequests: number;
  readonly requests: readonly RequestReceipt[];
  readonly simulatedSpend: { readonly reservedNanoUsd: number; readonly maxCostNanoUsd: number };
  readonly agent?: AgentRunResult;
  readonly errorCode?: 'execution_failed';
}

export interface EvaluationReport {
  readonly schema: 'pixieagent.evaluation-report/v0';
  readonly mode: 'scripted-fixture';
  readonly status: 'passed' | 'failed';
  readonly manifest: OfflineManifest;
  readonly dataSha256: { readonly cases: string; readonly fixtures: string };
  readonly sourceUnchanged: boolean;
  readonly networkRequests: 0;
  readonly costUsd: null;
  readonly modelAccuracyMeasured: false;
  readonly factualityEvaluated: false;
  readonly summary: { readonly cases: number; readonly passed: number; readonly failed: number };
  readonly cases: readonly EvaluationCaseResult[];
}

const base = dirname(fileURLToPath(import.meta.url));
const categories = ['security', 'testing', 'architecture', 'other'];
const severities = ['low', 'medium', 'high'];
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Validate the complete corpus and fixture coverage before constructing any runtime. */
export function validateEvaluationData(suite: unknown, fixtures: unknown): EvaluationData {
  if (!object(suite) || suite.schema !== 'pixieagent.evaluation-cases/v0'
    || !Array.isArray(suite.cases) || suite.cases.length < 1 || suite.cases.length > 16
    || !object(fixtures) || fixtures.schema !== 'pixieagent.evaluation-fixtures/v0'
    || !object(fixtures.responses)) throw new Error('Invalid evaluation dataset or fixtures');
  const ids = new Set<string>();
  for (const entry of suite.cases as unknown[]) {
    if (!object(entry) || typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(entry.id)
      || ids.has(entry.id) || !nonempty(entry.goal) || Buffer.byteLength(entry.goal, 'utf8') > 4096
      || !nonempty(entry.reviewNote) || !object(entry.expected)
      || typeof entry.expected.category !== 'string' || !categories.includes(entry.expected.category)
      || typeof entry.expected.severity !== 'string' || !severities.includes(entry.expected.severity)) {
      throw new Error('Invalid or duplicate evaluation case');
    }
    ids.add(entry.id);
    const script = fixtures.responses[entry.id];
    if (!Object.hasOwn(fixtures.responses, entry.id) || !Array.isArray(script)
      || script.length < 1 || script.length > OFFLINE_POLICY.maxRequests) throw new Error('Missing or invalid fixture script');
  }
  if (Object.keys(fixtures.responses).some(id => !ids.has(id))) throw new Error('Unknown fixture case');
  const encoded = JSON.stringify({ suite, fixtures });
  if (Buffer.byteLength(encoded, 'utf8') > 256 * 1024) throw new Error('Evaluation data exceeds size limit');
  // Detach caller-owned data before asynchronous execution.
  return JSON.parse(encoded) as EvaluationData;
}

/** Read only the bundled synthetic data; never discover environment or credential files. */
export async function loadEvaluationData(): Promise<EvaluationData> {
  const [suite, fixtures] = await Promise.all([
    readFile(resolve(base, 'evaluation/cases.json'), 'utf8'),
    readFile(resolve(base, 'evaluation/fixtures.json'), 'utf8'),
  ]);
  return validateEvaluationData(JSON.parse(suite), JSON.parse(fixtures));
}

/** Score observable contracts; nonempty reasons are not a semantic-factuality judgment. */
export async function scoreEvaluationCase(
  entry: EvaluationCase,
  agent: AgentRunResult,
  attemptedBlueprints: readonly string[],
  expectedPath: readonly string[],
): Promise<EvaluationScore> {
  const result: JsonObject = object(agent.result) ? agent.result : {};
  const observation = agent.observations[0];
  const output: JsonObject = object(observation?.output) ? observation.output : {};
  const classification = await compareEvaluationOutput(result, { ...entry.expected },
    { mode: 'fields', pointers: ['/category', '/severity'] });
  const agreement = await compareEvaluationOutput(result, output,
    { mode: 'fields', pointers: ['/category', '/severity'] });
  const checks = {
    classification: classification.passed,
    reasonPresent: nonempty(result.reason) && nonempty(output.reason),
    declaredAction: agent.observations.length === 1 && observation?.action_id === 'classify-issue',
    inputFidelity: observation?.input.issue_text === entry.goal && Object.keys(observation.input).length === 1,
    finalAgreement: agreement.passed,
    decisionCount: agent.decisions === 2,
    executionPath: attemptedBlueprints.length === expectedPath.length
      && attemptedBlueprints.every((path, i) => path === expectedPath[i]),
  };
  return { passed: Object.values(checks).every(Boolean), checks, classification,
    reasonTextUnchanged: result.reason === output.reason, factualityEvaluated: false };
}

/** Run independently authored responses through the public runtime, not through the expectations. */
export async function runEvaluation(data?: EvaluationData): Promise<EvaluationReport> {
  const input = data ?? await loadEvaluationData();
  const { suite, fixtures } = validateEvaluationData(input.suite, input.fixtures);
  const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const dataSha256 = { cases: digest(suite), fixtures: digest(fixtures) };
  const manifest = await createOfflineManifest('fixture');
  const definition = await preflight();
  const action = definition.actions.find(item => item.id === 'classify-issue');
  if (!action) throw new Error('Classification action is unavailable');
  const expectedPath = [definition.planner.path, action.blueprint.path, definition.planner.path];
  const cases: EvaluationCaseResult[] = [];
  for (const entry of suite.cases) {
    const responses = fixtures.responses[entry.id]!;
    let index = 0;
    const spending = createSpendLedger(OFFLINE_SPEND_POLICY, () => 256);
    const bounded = createBoundedTransport(OFFLINE_POLICY, async () => {
      if (index >= responses.length) throw new Error('Fixture script exhausted');
      return Response.json({ choices: [{ finish_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(responses[index++]) } }] });
    }, spending);
    const trace: string[] = [];
    const evidence = (): Omit<EvaluationCaseResult, 'status' | 'score'> => ({
      id: entry.id, expected: entry.expected, reviewNote: entry.reviewNote,
      attemptedBlueprints: [...trace], providerRequests: bounded.requestCount(),
      requests: bounded.receipts(), simulatedSpend: spending.snapshot(),
    });
    try {
      const agent = await executeTriageGoal(bounded.fetch, 'offline-not-a-credential', 'fixture', trace, entry.goal);
      const result = await scoreEvaluationCase(entry, agent, trace, expectedPath);
      const score = { ...result, passed: result.passed && index === responses.length,
        checks: { ...result.checks, fixtureConsumed: index === responses.length } };
      cases.push({ ...evidence(), status: score.passed ? 'passed' : 'failed', score, agent });
    } catch {
      // Preserve bounded accounting and attempted paths without raw provider errors.
      cases.push({ ...evidence(), status: 'failed', score: null, errorCode: 'execution_failed' });
    }
  }
  const after = await createOfflineManifest('fixture');
  const sourceUnchanged = JSON.stringify(manifest.source) === JSON.stringify(after.source);
  const passed = cases.filter(entry => entry.status === 'passed').length;
  return { schema: 'pixieagent.evaluation-report/v0', mode: 'scripted-fixture',
    status: sourceUnchanged && passed === cases.length ? 'passed' : 'failed',
    manifest, dataSha256, sourceUnchanged, networkRequests: 0, costUsd: null,
    modelAccuracyMeasured: false, factualityEvaluated: false,
    summary: { cases: cases.length, passed, failed: cases.length - passed }, cases };
}

/** Human-readable output deliberately omits source hashes and provider-authored prose. */
export function renderEvaluationMarkdown(report: EvaluationReport): string {
  const rows = report.cases.map(entry => {
    const failed = entry.score
      ? Object.entries(entry.score.checks).filter(([, passed]) => !passed).map(([name]) => name).join(', ')
      : entry.errorCode;
    const actual = entry.agent?.result;
    const observed = object(actual) && categories.includes(String(actual.category)) && severities.includes(String(actual.severity))
      ? `${actual.category}/${actual.severity}` : 'unavailable';
    return `| ${entry.id} | ${entry.expected.category}/${entry.expected.severity} | ${observed} | ${entry.status} | ${failed || 'none'} | ${entry.providerRequests} |`;
  });
  return ['# PixieAgent scripted-fixture evaluation', '',
    `Status: ${report.status}; fixture cases passed: ${report.summary.passed}/${report.summary.cases}.`,
    `Source unchanged: ${report.sourceUnchanged}.`,
    'Real network requests: 0. Actual cost: unknown. Model accuracy and reason factuality: not evaluated.', '',
    '| Case | Expected | Observed | Status | Failed checks | Simulated requests |', '|---|---|---|---|---|---|', ...rows, '',
    'The responses are scripted fixtures, not sampled model answers. Review the corpus reviewNote fields before real-model use.',
  ].join('\n') + '\n';
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Ambient networking prohibited'); };
  try {
    const args = process.argv.slice(2);
    if (args[0] !== '--offline' || args.length > 2 || (args[1] !== undefined && args[1] !== '--markdown')) {
      throw new Error('Use --offline [--markdown]');
    }
    const report = await runEvaluation();
    console.log(args[1] === '--markdown' ? renderEvaluationMarkdown(report) : JSON.stringify(report, null, 2));
    if (report.status !== 'passed') process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ status: 'failed', errorCode: 'evaluation_setup_failed', networkRequests: 0 }));
    process.exitCode = 1;
  } finally {
    globalThis.fetch = savedFetch;
  }
}

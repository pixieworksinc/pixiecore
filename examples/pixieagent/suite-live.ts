/** One-shot six-case handoff. Preparation/import never reads credentials or uses a network. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import type { AgentRunResult } from './agent.js';
import { loadEvaluationData, scoreEvaluationCase, type EvaluationCase, type EvaluationScore } from './evaluate.js';
import { createOfflineManifest, type OfflineManifest } from './evidence.js';
import { createBoundedTransport, executeTriageGoal, preflight, transportPolicyFor, type RequestReceipt } from './harness.js';
import type { CredentialSource, LiveHost } from './live.js';
import { LUNA_PLAN } from './luna.js';
import { createSuiteSpendLedger, type SuiteSpendSnapshot, type UsageSettlement } from './suite-budget.js';

export const SUITE_POLICY = Object.freeze({ maxCases: 6, maxRequests: 30, expectedRequests: 18,
  maxRequestsPerCase: LUNA_PLAN.maxRequests,
  maxCostUsd: 1, maxDurationMs: 540_000, planLifetimeMs: 86_400_000, requestMode: 'sequential',
  accounting: 'full-context-hold-then-validated-usage-at-long-context-rates' });
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runDirectory = join(workspace, '.pixiecore/pixieagent-runs');
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export interface PreparedSuitePlan {
  readonly schema: 'pixieagent.suite-live-plan/v0';
  readonly runId: string;
  readonly preparedAt: string;
  readonly expiresAt: string;
  readonly workspaceRoot: string;
  readonly source: OfflineManifest['source'];
  readonly requestPolicy: typeof LUNA_PLAN;
  readonly cases: readonly EvaluationCase[];
  readonly policy: typeof SUITE_POLICY;
  readonly credentialSource: CredentialSource;
  readonly exclusions: readonly string[];
  readonly approvalDigest: string;
}

function checkCredentialSource(source: CredentialSource): void {
  if (source?.kind !== 'environment' && (source?.kind !== 'dotenv' || !isAbsolute(source.path))) {
    throw new Error('Invalid explicit credential source');
  }
}

/** Bind corpus, runtime, prices and limits without inspecting any credential. */
export async function prepareSuitePlan(source: CredentialSource = { kind: 'environment' }): Promise<PreparedSuitePlan> {
  checkCredentialSource(source);
  await preflight();
  const { suite } = await loadEvaluationData();
  if (suite.cases.length !== SUITE_POLICY.maxCases) throw new Error('Expected the reviewed six-case corpus');
  const preparedAt = new Date();
  const payload = { schema: 'pixieagent.suite-live-plan/v0' as const, runId: randomUUID(),
    preparedAt: preparedAt.toISOString(), expiresAt: new Date(preparedAt.getTime() + SUITE_POLICY.planLifetimeMs).toISOString(),
    workspaceRoot: await realpath(workspace), source: (await createOfflineManifest('luna')).source,
    requestPolicy: LUNA_PLAN,
    cases: suite.cases, policy: SUITE_POLICY, credentialSource: { ...source },
    exclusions: ['model-list probes', 'retries', 'reruns/resume', 'tools/MCP', 'source/GitHub writes',
      'real issue data', 'publication', 'other models/endpoints', 'automatic semantic acceptance'] };
  return { ...payload, approvalDigest: hash(payload) };
}

/** An approved one-case plan, changed corpus, expired artifact or changed runtime is insufficient. */
export async function verifySuitePlan(plan: PreparedSuitePlan, approvedDigest: string | undefined): Promise<void> {
  const { approvalDigest, ...payload } = plan;
  if (!approvedDigest || approvedDigest !== approvalDigest || approvalDigest !== hash(payload)) {
    throw new Error('Explicit approval for this exact suite plan is required');
  }
  checkCredentialSource(plan.credentialSource);
  const preparedAt = Date.parse(plan.preparedAt);
  const expiresAt = Date.parse(plan.expiresAt);
  if (plan.schema !== 'pixieagent.suite-live-plan/v0' || !/^[0-9a-f-]{36}$/.test(plan.runId)
    || plan.workspaceRoot !== await realpath(workspace) || !Number.isFinite(preparedAt) || !Number.isFinite(expiresAt)
    || expiresAt - preparedAt !== SUITE_POLICY.planLifetimeMs || preparedAt > Date.now() || Date.now() > expiresAt
    || hash(plan.policy) !== hash(SUITE_POLICY)
    || hash(plan.requestPolicy) !== hash(LUNA_PLAN)) {
    throw new Error('Suite plan expired or policy changed');
  }
  const { suite } = await loadEvaluationData();
  if (hash(plan.cases) !== hash(suite.cases)) throw new Error('Suite corpus changed');
  const current = await createOfflineManifest('luna');
  if (hash(current.source) !== hash(plan.source)) throw new Error('Suite source or runtime changed');
}

export interface SuiteCaseReceipt {
  readonly id: string;
  readonly score: EvaluationScore;
  readonly agent: AgentRunResult;
  readonly attemptedBlueprints: readonly string[];
}

export interface SuiteLiveReceipt {
  readonly schema: 'pixieagent.suite-live-receipt/v0';
  readonly runId: string;
  readonly approvalDigest: string;
  readonly transportMode: 'network' | 'fixture';
  readonly status: 'running' | 'completed' | 'failed';
  readonly humanReviewStatus: 'pending';
  readonly generalModelAccuracyEstablished: false;
  readonly providerRequests: number;
  readonly networkRequests: number;
  readonly httpStatuses: readonly number[];
  readonly budget: SuiteSpendSnapshot;
  readonly usageSettlements: readonly UsageSettlement[];
  readonly requests: readonly { caseId: string; receipts: readonly RequestReceipt[]; attemptedBlueprints: readonly string[] }[];
  readonly cases: readonly SuiteCaseReceipt[];
  readonly costUsd: null;
  readonly errorCode?: 'suite_execution_failed';
}

/** Render model text only inside escaped JSON code blocks; never auto-approve reason quality. */
export function renderSuiteReview(plan: PreparedSuitePlan, receipt: SuiteLiveReceipt): string {
  const escaped = (value: unknown): string => JSON.stringify(value, null, 2).replace(/`/g, '\\u0060').replace(/</g, '\\u003c');
  const lines = ['# PixieAgent suite review', '', `Execution status: ${receipt.status}. Human review: pending.`,
    `Transport: ${receipt.transportMode}. Requests: ${receipt.providerRequests}. Actual billed cost: unknown.`,
    'A completed run means mechanical checks passed; it does not establish reason factuality or general accuracy.', ''];
  for (const entry of plan.cases) {
    const observed = receipt.cases.find(item => item.id === entry.id);
    lines.push(`## ${entry.id}`, '', '```json', escaped({ goal: entry.goal, expected: entry.expected,
      reviewNote: entry.reviewNote, observed: observed?.agent.result ?? null,
      mechanicalChecks: observed?.score.checks ?? null }), '```', '',
    '- [ ] Category supported by the supplied text.', '- [ ] Severity justified without invented impact.',
    '- [ ] Reason supported; ambiguity and quoted instructions handled appropriately.', '');
  }
  return lines.join('\n');
}

/** Claim before credentials; fail fast across the whole corpus, never reset budget per case. */
export async function executeSuitePlan(
  plan: PreparedSuitePlan, approvedDigest: string | undefined, host: LiveHost,
): Promise<SuiteLiveReceipt> {
  // Detach the exact reviewed payload before the first asynchronous verification.
  plan = structuredClone(plan);
  await verifySuitePlan(plan, approvedDigest);
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  await writeFile(join(runDirectory, `${plan.runId}.claimed`), JSON.stringify({ runId: plan.runId,
    approvalDigest: plan.approvalDigest, claimedAt: new Date().toISOString(), transportMode: host.transportMode,
  }), { flag: 'wx', mode: 0o600 });
  const receiptPath = join(runDirectory, `${plan.runId}.suite.receipt.json`);
  const spending = createSuiteSpendLedger(SUITE_POLICY.maxRequests);
  const cases: SuiteCaseReceipt[] = [];
  const requestGroups: { caseId: string; receipts: () => readonly RequestReceipt[]; trace: readonly string[] }[] = [];
  const httpStatuses: number[] = [];
  let networkRequests = 0;
  const snapshot = (status: SuiteLiveReceipt['status']): SuiteLiveReceipt => ({
    schema: 'pixieagent.suite-live-receipt/v0', runId: plan.runId, approvalDigest: plan.approvalDigest,
    transportMode: host.transportMode, status, humanReviewStatus: 'pending', generalModelAccuracyEstablished: false,
    providerRequests: spending.snapshot().requests, networkRequests, httpStatuses: [...httpStatuses],
    budget: spending.snapshot(), usageSettlements: spending.settlements(),
    requests: requestGroups.map(group => ({ caseId: group.caseId, receipts: group.receipts(), attemptedBlueprints: [...group.trace] })),
    cases: [...cases], costUsd: null, ...(status === 'failed' ? { errorCode: 'suite_execution_failed' as const } : {}),
  });
  const persist = async (receipt: SuiteLiveReceipt): Promise<void> => {
    await writeFile(receiptPath + '.tmp', JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    await rename(receiptPath + '.tmp', receiptPath);
  };
  await persist(snapshot('running'));
  const signal = AbortSignal.timeout(SUITE_POLICY.maxDurationMs);
  try {
    const credential = await (host.readCredential ? host.readCredential(plan.credentialSource) :
      plan.credentialSource.kind === 'dotenv'
        ? readFile(plan.credentialSource.path, { signal }).then(bytes => parse(bytes).OPENAI_API_KEY ?? '')
        : Promise.resolve(process.env.OPENAI_API_KEY ?? ''));
    if (!credential.trim()) throw new Error('Configured credential unavailable');
    signal.throwIfAborted();
    const definition = await preflight();
    const action = definition.actions.find(item => item.id === 'classify-issue');
    if (!action) throw new Error('Classification action unavailable');
    const expectedPath = [definition.planner.path, action.blueprint.path, definition.planner.path];
    for (const entry of plan.cases) {
      signal.throwIfAborted();
      const trace: string[] = [];
      const bounded = createBoundedTransport(transportPolicyFor('luna'), async (input, init) => {
        await verifySuitePlan(plan, approvedDigest);
        init?.signal?.throwIfAborted();
        if (host.transportMode === 'network') networkRequests++;
        await persist(snapshot('running'));
        init?.signal?.throwIfAborted();
        const response = await host.transport(input, init);
        httpStatuses.push(response.status);
        // Do not release a hold using usage from a response the transport will reject.
        if (response.redirected || (response.url && response.url !== LUNA_PLAN.endpoint)
          || (response.status >= 300 && response.status < 400)) throw new Error('Suite provider redirect rejected');
        if (response.ok) {
          const data: unknown = await response.clone().json();
          const usage = data && typeof data === 'object' && !Array.isArray(data)
            ? (data as Record<string, unknown>).usage : undefined;
          spending.settle(usage);
        }
        await persist(snapshot('running'));
        return response;
      }, spending);
      requestGroups.push({ caseId: entry.id, receipts: bounded.receipts, trace });
      const agent = await executeTriageGoal(bounded.fetch, credential.trim(), 'luna', trace, entry.goal, signal);
      const score = await scoreEvaluationCase(entry, agent, trace, expectedPath);
      cases.push({ id: entry.id, score, agent, attemptedBlueprints: [...trace] });
      await persist(snapshot('running'));
      if (!score.passed) throw new Error('Suite mechanical checks failed');
    }
    await verifySuitePlan(plan, approvedDigest);
    signal.throwIfAborted();
    const receipt = snapshot('completed');
    await persist(receipt);
    await writeFile(join(runDirectory, `${plan.runId}.suite.review.md`), renderSuiteReview(plan, receipt), { mode: 0o600 });
    return receipt;
  } catch {
    const receipt = snapshot('failed');
    await persist(receipt);
    await writeFile(join(runDirectory, `${plan.runId}.suite.review.md`), renderSuiteReview(plan, receipt), { mode: 0o600 });
    return receipt;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const networkFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async () => { throw new Error('Ambient networking is prohibited'); };
  try {
    const args = process.argv.slice(2);
    if (args[0] === '--prepare' && (args.length === 1 || (args.length === 3 && args[1] === '--credential-file'))) {
      const source: CredentialSource = args[2] ? { kind: 'dotenv', path: args[2] } : { kind: 'environment' };
      console.log(JSON.stringify(await prepareSuitePlan(source), null, 2));
    } else if (args[0] === '--execute' && args.length === 2 && args[1]) {
      const plan = JSON.parse(await readFile(args[1], 'utf8')) as PreparedSuitePlan;
      const receipt = await executeSuitePlan(plan, process.env.PIXIEAGENT_APPROVED_SUITE_PLAN_SHA256,
        { transport: networkFetch, transportMode: 'network' });
      console.log(JSON.stringify(receipt, null, 2));
      if (receipt.status !== 'completed') process.exitCode = 1;
    } else throw new Error('Use --prepare [--credential-file <absolute path>] or --execute <plan.json>');
  } catch {
    console.log(JSON.stringify({ status: 'failed', errorCode: 'suite_approval_setup_or_claim_failed' }));
    process.exitCode = 1;
  } finally {
    globalThis.fetch = networkFetch;
  }
}

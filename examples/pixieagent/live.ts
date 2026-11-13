/** One-shot host approval handoff. Importing this module never accesses credentials or the network. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import type { AgentRunResult } from './agent.js';
import { createSpendLedger } from './budget.js';
import { createOfflineManifest, type OfflineManifest } from './evidence.js';
import { createBoundedTransport, executeTriage, preflight, spendPolicyFor, SYNTHETIC_GOAL,
  transportPolicyFor, type RequestReceipt } from './harness.js';
import { LUNA_PLAN } from './luna.js';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const runDirectory = join(workspace, '.pixiecore', 'pixieagent-runs');
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export type CredentialSource = { readonly kind: 'environment' }
  | { readonly kind: 'dotenv'; readonly path: string };

export interface PreparedLivePlan {
  readonly schema: 'pixieagent.live-plan/v0';
  readonly runId: string;
  readonly preparedAt: string;
  readonly expiresAt: string;
  readonly workspaceRoot: string;
  readonly manifest: OfflineManifest;
  readonly credentialSource: CredentialSource;
  readonly goal: string;
  readonly exclusions: readonly string[];
  readonly approvalDigest: string;
}

/** Prepare concrete source and runtime identity, without reading credentials. */
export async function prepareLivePlan(credentialSource: CredentialSource = { kind: 'environment' }): Promise<PreparedLivePlan> {
  if (credentialSource.kind === 'dotenv' && !isAbsolute(credentialSource.path)) throw new Error('Credential path must be absolute');
  await preflight();
  const preparedAt = new Date();
  const payload = {
    schema: 'pixieagent.live-plan/v0' as const, runId: randomUUID(), preparedAt: preparedAt.toISOString(),
    expiresAt: new Date(preparedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    workspaceRoot: await realpath(workspace), manifest: await createOfflineManifest('luna'),
    credentialSource, goal: SYNTHETIC_GOAL,
    exclusions: ['model-list probes', 'retries', 'reruns', 'tools/MCP', 'repository writes',
      'real issue data', 'publication', 'other models/endpoints'],
  };
  return { ...payload, approvalDigest: hash(payload) };
}

/** Host assertion must match the exact reviewed artifact. Presence of credentials is never approval. */
export async function verifyLivePlan(plan: PreparedLivePlan, approvedDigest: string | undefined): Promise<void> {
  const { approvalDigest, ...payload } = plan;
  if (!approvedDigest || approvedDigest !== approvalDigest || approvalDigest !== hash(payload)) {
    throw new Error('Explicit approval for this exact plan is required');
  }
  if (plan.schema !== 'pixieagent.live-plan/v0' || !/^[0-9a-f-]{36}$/.test(plan.runId)
    || plan.goal !== SYNTHETIC_GOAL || plan.workspaceRoot !== await realpath(workspace)
    || !Number.isFinite(Date.parse(plan.expiresAt)) || Date.now() > Date.parse(plan.expiresAt)
    || plan.manifest.profile !== 'luna' || hash(plan.manifest.realModel.plan) !== hash(LUNA_PLAN)) {
    throw new Error('Plan is expired or does not match this prepared scenario');
  }
  const current = await createOfflineManifest('luna');
  if (hash(current.source) !== hash(plan.manifest.source)) throw new Error('Approved source or runtime changed');
}

export interface LiveReceipt {
  readonly schema: 'pixieagent.live-receipt/v0';
  readonly runId: string;
  readonly approvalDigest: string;
  readonly transportMode: 'network' | 'fixture';
  readonly status: 'running' | 'passed' | 'failed';
  readonly providerRequests: number;
  readonly networkRequests: number;
  readonly reservations: { readonly reservedNanoUsd: number; readonly maxCostNanoUsd: number };
  readonly requests: readonly RequestReceipt[];
  readonly usageObserved: readonly { inputTokens: number | null; outputTokens: number | null }[];
  readonly httpStatuses: readonly number[];
  readonly costUsd: null;
  readonly trace: readonly string[];
  readonly agent?: AgentRunResult;
  readonly errorCode?: string;
}

export interface LiveHost {
  readonly transport: typeof globalThis.fetch;
  readonly transportMode: 'network' | 'fixture';
  readonly readCredential?: (source: CredentialSource) => Promise<string>;
}

async function readCredential(source: CredentialSource): Promise<string> {
  const value = source.kind === 'dotenv'
    ? parse(await readFile(source.path)).OPENAI_API_KEY : process.env.OPENAI_API_KEY;
  if (!value?.trim()) throw new Error('Configured OpenAI credential is unavailable');
  return value.trim();
}

/** Claim once before any request. A failed run cannot reuse this approval, even from a copied plan file. */
export async function executePreparedPlan(
  plan: PreparedLivePlan, approvedDigest: string | undefined, host: LiveHost,
): Promise<LiveReceipt> {
  await verifyLivePlan(plan, approvedDigest);
  const credential = await (host.readCredential ?? readCredential)(plan.credentialSource);
  if (!credential.trim()) throw new Error('Configured OpenAI credential is unavailable');
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  await writeFile(join(runDirectory, `${plan.runId}.claimed`), JSON.stringify({
    runId: plan.runId, approvalDigest: plan.approvalDigest, claimedAt: new Date().toISOString(),
    transportMode: host.transportMode,
  }), { flag: 'wx', mode: 0o600 });
  const receiptPath = join(runDirectory, `${plan.runId}.receipt.json`);
  const spending = createSpendLedger(spendPolicyFor('luna'), () => LUNA_PLAN.maxInputTokens);
  const trace: string[] = [];
  const usage: { inputTokens: number | null; outputTokens: number | null }[] = [];
  const httpStatuses: number[] = [];
  let networkRequests = 0;
  const persist = async (receipt: LiveReceipt): Promise<void> => {
    const temporary = `${receiptPath}.tmp`;
    await writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, receiptPath);
  };
  const tokenValue = (value: unknown): number | null =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const bounded = createBoundedTransport(transportPolicyFor('luna'), async (input, init) => {
    await verifyLivePlan(plan, approvedDigest);
    if (host.transportMode === 'network') networkRequests++;
    await persist(snapshot('running'));
    const response = await host.transport(input, init);
    httpStatuses.push(response.status);
    // Read only numeric usage from a clone, never retain raw headers/errors/provider bodies.
    try {
      const data = await response.clone().json() as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
      usage.push({ inputTokens: tokenValue(data?.usage?.prompt_tokens), outputTokens: tokenValue(data?.usage?.completion_tokens) });
    } catch {
      usage.push({ inputTokens: null, outputTokens: null });
    }
    return response;
  }, spending);
  function snapshot(status: LiveReceipt['status'], extra: Partial<LiveReceipt> = {}): LiveReceipt {
    return { schema: 'pixieagent.live-receipt/v0', runId: plan.runId, approvalDigest: plan.approvalDigest,
      transportMode: host.transportMode, status, providerRequests: bounded.requestCount(), networkRequests,
      reservations: spending.snapshot(), requests: bounded.receipts(), usageObserved: [...usage],
      httpStatuses: [...httpStatuses], costUsd: null, trace: [...trace], ...extra };
  }
  await persist(snapshot('running'));
  try {
    const agent = await executeTriage(bounded.fetch, credential, 'luna', trace);
    await verifyLivePlan(plan, approvedDigest);
    const receipt = snapshot('passed', { agent });
    await persist(receipt);
    return receipt;
  } catch {
    const receipt = snapshot('failed', { errorCode: 'execution_failed' });
    await persist(receipt);
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
      console.log(JSON.stringify(await prepareLivePlan(source), null, 2));
    } else if (args[0] === '--execute' && args.length === 2 && args[1]) {
      const plan = JSON.parse(await readFile(args[1], 'utf8')) as PreparedLivePlan;
      const receipt = await executePreparedPlan(plan, process.env.PIXIEAGENT_APPROVED_PLAN_SHA256,
        { transport: networkFetch, transportMode: 'network' });
      console.log(JSON.stringify(receipt, null, 2));
      if (receipt.status !== 'passed') process.exitCode = 1;
    } else {
      throw new Error('Use --prepare [--credential-file <absolute path>] or --execute <plan.json>');
    }
  } catch {
    console.log(JSON.stringify({ status: 'failed', errorCode: 'approval_setup_or_claim_failed' }));
    process.exitCode = 1;
  } finally {
    globalThis.fetch = networkFetch;
  }
}

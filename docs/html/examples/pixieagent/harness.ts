/** Offline preparation for a bounded provider transport; never opens a socket. */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { PromptRuntime } from '@pixieworks/pixiecore';
import { createApplicationSchemaBoundary } from '@pixieworks/pixiecore/application';
import { PixieAgent, type AgentDefinition, type AgentRunResult } from './agent.js';
import { createSpendLedger, type SpendLedger, type SpendPolicy, type SpendReservation } from './budget.js';
import { checkStrictOutputSchema, createLunaRequestAdapter, LUNA_BUDGET_NANO_USD, LUNA_PLAN } from './luna.js';

export interface TransportPolicy {
  readonly endpoint: string;
  readonly model: string;
  readonly maxRequests: number;
  readonly maxRequestBytes: number;
  readonly maxOutputTokens: number;
  readonly wireFormat?: 'pixiecore' | 'luna';
}

export interface BoundedTransport {
  readonly fetch: typeof globalThis.fetch;
  readonly requestCount: () => number;
  readonly receipts: () => readonly RequestReceipt[];
}

export interface RequestReceipt extends SpendReservation {
  readonly index: number;
  readonly status: 'reserved' | 'succeeded' | 'failed';
}

/** The injected transport is mandatory. Never defaults to real fetch. */
export function createBoundedTransport(
  policy: TransportPolicy,
  transport: typeof globalThis.fetch,
  spending: SpendLedger,
): BoundedTransport {
  const limits = { ...policy };
  const endpoint = new URL(limits.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash || !limits.model.trim()
    || ![limits.maxRequests, limits.maxRequestBytes, limits.maxOutputTokens]
      .every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Invalid transport policy');
  }
  let requestCount = 0;
  let reservationQueue = Promise.resolve();
  const receipts: RequestReceipt[] = [];
  return {
    requestCount: () => requestCount,
    receipts: () => receipts.map(receipt => ({ ...receipt })),
    fetch: async (input, init) => {
      if ((typeof input !== 'string' && !(input instanceof URL))
        || String(input) !== endpoint.href || init?.method !== 'POST'
        || typeof init.body !== 'string') {
        throw new Error('Transport permits only JSON POST to the pinned endpoint');
      }
      init.signal?.throwIfAborted();
      if (Buffer.byteLength(init.body, 'utf8') > limits.maxRequestBytes) {
        throw new Error('Request byte limit exceeded');
      }
      const body: unknown = JSON.parse(init.body);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('Expected a JSON object');
      }
      const request = body as Record<string, unknown>;
      const luna = limits.wireFormat === 'luna';
      const outputLimit = luna ? request.max_completion_tokens : request.max_tokens;
      const permittedFields = luna
        ? ['model', 'messages', 'max_completion_tokens', 'response_format', 'reasoning_effort',
          'service_tier', 'prompt_cache_options', 'store']
        : ['model', 'messages', 'temperature', 'max_tokens', 'response_format'];
      if (request.model !== limits.model || !Number.isSafeInteger(outputLimit)
        || Number(outputLimit) < 1 || Number(outputLimit) > limits.maxOutputTokens
        || Object.keys(request).some(key => !permittedFields.includes(key))) {
        throw new Error('Request violates the model, token, or tool policy');
      }
      if (luna && (limits.model !== LUNA_PLAN.model || limits.endpoint !== LUNA_PLAN.endpoint
        || request.reasoning_effort !== 'none' || request.service_tier !== 'default'
        || request.store !== false || JSON.stringify(request.prompt_cache_options) !== '{"mode":"explicit"}')) {
        throw new Error('Luna requires pinned reasoning, tier, cache, and storage settings');
      }
      // Serialize asynchronous counting and reservations; never reserve a sixth request.
      const allocation = reservationQueue.then(async () => {
        init.signal?.throwIfAborted();
        if (requestCount >= limits.maxRequests) throw new Error('Request budget exhausted');
        const reservation = await spending.reserve(request, Number(outputLimit), init.signal ?? undefined);
        const index = ++requestCount;
        receipts.push({ ...reservation, index, status: 'reserved' });
        return { reservation, index };
      });
      reservationQueue = allocation.then(() => undefined, () => undefined);
      const { reservation, index } = await allocation;
      // Failed attempts consume the budget too. Never follow credential-bearing redirects.
      try {
        const response = await transport(endpoint.href, { ...init, redirect: 'error' });
        if (response.redirected || (response.url && response.url !== endpoint.href)
          || (response.status >= 300 && response.status < 400)) {
          throw new Error('Provider redirect rejected');
        }
        receipts[index - 1] = { ...reservation, index, status: response.ok ? 'succeeded' : 'failed' };
        return response;
      } catch (error) {
        receipts[index - 1] = { ...reservation, index, status: 'failed' };
        throw error;
      }
    },
  };
}

const base = dirname(fileURLToPath(import.meta.url));
export const SYNTHETIC_GOAL = 'An untrusted repository URL bypasses authentication.';
export const OFFLINE_POLICY: TransportPolicy = Object.freeze({
  endpoint: 'https://pixieagent.invalid/v1/chat/completions',
  model: 'offline-fixture', maxRequests: 5, maxRequestBytes: 16 * 1024, maxOutputTokens: 512,
});
/** Entirely synthetic rates and counter values, never a model price quotation. */
export const OFFLINE_SPEND_POLICY: SpendPolicy = Object.freeze({
  maxInputTokens: 4096, maxCostNanoUsd: 30_720_000,
  inputNanoUsdPerToken: 1000, outputNanoUsdPerToken: 4000,
});

export function transportPolicyFor(profile: 'fixture' | 'luna'): TransportPolicy {
  return profile === 'luna' ? { ...LUNA_PLAN, wireFormat: 'luna' } : { ...OFFLINE_POLICY };
}

export function spendPolicyFor(profile: 'fixture' | 'luna'): SpendPolicy {
  return profile === 'luna' ? {
    maxInputTokens: LUNA_PLAN.maxInputTokens, maxCostNanoUsd: LUNA_BUDGET_NANO_USD,
    inputNanoUsdPerToken: LUNA_PLAN.prices.inputNanoUsdPerToken,
    outputNanoUsdPerToken: LUNA_PLAN.prices.outputNanoUsdPerToken,
  } : { ...OFFLINE_SPEND_POLICY };
}

/** Acceptance of this fixed synthetic scenario is separate from successful JSON parsing. */
export function acceptTriageRun(agent: AgentRunResult): void {
  const result = agent.result;
  const observation = agent.observations[0];
  const output = observation?.output;
  if (agent.decisions !== 2 || agent.observations.length !== 1 || observation?.action_id !== 'classify-issue'
    || !result || typeof result !== 'object' || Array.isArray(result)
    || !output || typeof output !== 'object' || Array.isArray(output)
    || result.category !== 'security' || result.category !== output.category
    || !['low', 'medium', 'high'].includes(String(result.severity)) || result.severity !== output.severity
    || typeof result.reason !== 'string' || !result.reason.trim()) {
    throw new Error('Synthetic triage acceptance failed');
  }
}

/** Validate the definition and pinned Blueprints without constructing a provider. */
export async function preflight(): Promise<AgentDefinition> {
  const definition = YAML.parse(await readFile(resolve(base, 'agent.yaml'), 'utf8')) as AgentDefinition;
  new PixieAgent(definition, { execute: async () => { throw new Error('Preflight cannot execute'); } });
  if (definition.actions.some(action => action.permission !== 'read')) {
    throw new Error('This harness permits only read actions');
  }
  await createApplicationSchemaBoundary([
    { id: 'planner', blueprintPath: resolve(base, definition.planner.path),
      blueprintVersion: definition.planner.version },
    ...definition.actions.map(action => ({ id: action.id,
      blueprintPath: resolve(base, action.blueprint.path), blueprintVersion: action.blueprint.version })),
  ]);
  for (const ref of [definition.planner, ...definition.actions.map(action => action.blueprint)]) {
    const blueprint = YAML.parse(await readFile(resolve(base, ref.path), 'utf8')) as { output_schema: unknown };
    checkStrictOutputSchema(blueprint.output_schema);
  }
  return definition;
}

export interface OfflineEvidence {
  readonly mode: 'offline';
  readonly providerRequests: number;
  readonly networkRequests: 0;
  readonly costUsd: null;
  readonly trace: readonly string[];
  readonly simulatedSpend: ReturnType<SpendLedger['snapshot']>;
  readonly requests: readonly RequestReceipt[];
  readonly profile: 'fixture' | 'luna';
  readonly inputTokensSynthetic: boolean;
  readonly inputAccounting: 'fixture' | 'model-context-upper-bound';
}

export type OfflineResult = OfflineEvidence & (
  | { readonly status: 'passed'; readonly agent: AgentRunResult }
  | { readonly status: 'failed'; readonly errorCode: 'runtime_error' }
);

/** Shared acceptance path. Every caller must explicitly supply transport and credential. */
export async function executeTriage(
  transport: typeof globalThis.fetch,
  credential: string,
  profile: 'fixture' | 'luna',
  trace: string[],
): Promise<AgentRunResult> {
  const agent = await executeTriageGoal(transport, credential, profile, trace, SYNTHETIC_GOAL);
  acceptTriageRun(agent);
  return agent;
}

/** Shared runtime path for an explicit goal; the live wrapper above keeps its fixed acceptance. */
export async function executeTriageGoal(
  transport: typeof globalThis.fetch,
  credential: string,
  profile: 'fixture' | 'luna',
  trace: string[],
  goal: string,
  signal?: AbortSignal,
): Promise<AgentRunResult> {
  const definition = await preflight();
  const policy = transportPolicyFor(profile);
  await using runtime = new PromptRuntime({
    provider: 'openai', model: policy.model,
    environment: { OPENAI_API_KEY: credential,
      OPENAI_BASE_URL: profile === 'luna' ? 'https://api.openai.com/v1' : 'https://pixieagent.invalid/v1' },
    fetch: profile === 'luna' ? createLunaRequestAdapter(transport) : transport,
    maxRetry: 0, maxToolRounds: 0, toolChoice: 'none', usePseudoToolCalling: false,
    requestTimeout: 30, pluginConfigPath: 'disabled', mcpConfigPath: 'disabled',
    promotionsPath: 'disabled', logFullPayloads: false, logToFile: false, logToConsole: false,
  });
  const agent = await new PixieAgent(definition, {
    execute: async (path, inputs, options) => {
      // The planner selects an action; it cannot change the issue being classified.
      const classification = definition.actions.find(action => action.id === 'classify-issue');
      if (path === classification?.blueprint.path
        && (inputs.issue_text !== goal || Object.keys(inputs).length !== 1)) {
        throw new Error('Planner changed the issue being classified');
      }
      trace.push(path);
      const output = await runtime.execute(resolve(base, path), inputs, { ...options, maxTokens: policy.maxOutputTokens });
      if (path === definition.planner.path
        && ((output.kind === 'act' && output.result !== null)
          || (output.kind === 'finish' && (output.input !== null || output.action_id !== null || output.result === null)))) {
        throw new Error('Planner mixed active and inactive decision fields');
      }
      return output;
    },
  }).run(goal, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000) });
  return agent;
}

/** Exercise real loading, rendering, HTTP serialization, and validation with fixtures. */
export async function runOfflineExample(
  mode: 'scripted' | 'rejecting' = 'scripted',
  profile: 'fixture' | 'luna' = 'fixture',
): Promise<OfflineResult> {
  const policy = transportPolicyFor(profile);
  const spending = createSpendLedger(spendPolicyFor(profile), () => profile === 'luna' ? LUNA_PLAN.maxInputTokens : 256);
  const classification = { category: 'security', severity: 'high', reason: 'Authentication bypass is described.' };
  const responses = [
    { kind: 'act', action_id: 'classify-issue', input: { issue_text: SYNTHETIC_GOAL }, result: null },
    classification,
    { kind: 'finish', action_id: null, input: null, result: classification },
  ];
  const bounded = createBoundedTransport(policy, async () => {
    if (mode === 'rejecting') throw new Error('Offline transport rejects all requests');
    const content = responses.shift();
    if (!content) throw new Error('Unexpected fixture request');
    return Response.json({ choices: [{ finish_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify(content) } }] });
  }, spending);
  const trace: string[] = [];
  const evidence = (): OfflineEvidence => ({
    mode: 'offline', providerRequests: bounded.requestCount(), networkRequests: 0,
    costUsd: null, trace: [...trace], simulatedSpend: spending.snapshot(), requests: bounded.receipts(),
    profile, inputTokensSynthetic: profile === 'fixture',
    inputAccounting: profile === 'luna' ? 'model-context-upper-bound' : 'fixture',
  });
  try {
    const agent = await executeTriage(bounded.fetch, 'offline-not-a-credential', profile, trace);
    return { ...evidence(), status: 'passed', agent };
  } catch {
    // Store value-free failure evidence, never provider error messages or credentials.
    return { ...evidence(), status: 'failed', errorCode: 'runtime_error' };
  }
}

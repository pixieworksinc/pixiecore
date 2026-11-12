/** Offline transport and public-runtime integration checks; no credentials required. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import YAML from 'yaml';
import {
  createBoundedTransport as createTransport, executeTriage, executeTriageGoal, OFFLINE_POLICY, OFFLINE_SPEND_POLICY,
  runOfflineExample, SYNTHETIC_GOAL,
  type TransportPolicy,
} from '../harness.js';
import { createSpendLedger } from '../budget.js';

const createBoundedTransport = (policy: TransportPolicy, transport: typeof globalThis.fetch) =>
  createTransport(policy, transport, createSpendLedger(OFFLINE_SPEND_POLICY, () => 256));

const request = (overrides: Record<string, unknown> = {}): RequestInit => ({
  method: 'POST',
  body: JSON.stringify({ model: OFFLINE_POLICY.model, max_tokens: 512, messages: [], ...overrides }),
});

test('the real classifier wire prompt contains every severity clause after YAML rendering', async () => {
  const blueprint = YAML.parse(await readFile(new URL('../blueprints/classify-issue.yaml', import.meta.url), 'utf8')) as {
    prompt: { Scenario: { Instruction: { And: string[] } }[] };
  };
  const clauses = blueprint.prompt.Scenario[0]!.Instruction.And;
  assert.ok(Array.isArray(clauses) && clauses.length > 0, 'Expected explicit severity clauses');
  const goal = 'A test intermittently fails due to a clock assumption. Production is unaffected.';
  const result = { category: 'testing', severity: 'medium', reason: 'Unreliable test behavior affects verification confidence.' };
  const responses = [
    { kind: 'act', action_id: 'classify-issue', input: { issue_text: goal }, result: null }, result,
    { kind: 'finish', action_id: null, input: null, result },
  ];
  let calls = 0;
  const transport = createBoundedTransport(OFFLINE_POLICY, async (_input, init) => {
    if (calls === 1) {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      const rendered = body.messages.map(message => message.content).join('\n');
      assert.ok(rendered.includes(goal));
      for (const clause of clauses) assert.ok(rendered.includes(clause), 'Renderer dropped a severity clause');
      assert.ok(!rendered.includes('{{ issue_text }}'));
    }
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant',
      content: JSON.stringify(responses[calls++]) } }] });
  });
  const agent = await executeTriageGoal(transport.fetch, 'offline-not-a-credential', 'fixture', [], goal);
  assert.equal(calls, 3);
  assert.deepEqual(agent.result, result);
});

test('planner cannot substitute or truncate the issue before classifier execution', async () => {
  for (const issueText of ['An unrelated documentation question.', SYNTHETIC_GOAL.slice(0, -1)]) {
    const trace: string[] = [];
    let calls = 0;
    const transport: typeof globalThis.fetch = async () => {
      calls++;
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        kind: 'act', action_id: 'classify-issue', input: { issue_text: issueText }, result: null,
      }) } }] });
    };
    await assert.rejects(executeTriage(transport, 'offline-not-a-credential', 'fixture', trace),
      /Planner changed the issue/);
    assert.equal(calls, 1);
    assert.deepEqual(trace, ['./blueprints/planner.yaml']);
  }
});

test('public runtime completes planner/action/planner using only the injected fixture transport', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Ambient networking prohibited'); };
  try {
    const result = await runOfflineExample();
    assert.equal(result.status, 'passed');
    if (result.status !== 'passed') throw new Error('Expected a passing fixture');
    assert.equal(result.networkRequests, 0);
    assert.equal(result.costUsd, null);
    assert.equal(result.providerRequests, 3);
    assert.deepEqual(result.trace, [
      './blueprints/planner.yaml', './blueprints/classify-issue.yaml', './blueprints/planner.yaml',
    ]);
    assert.equal(result.agent.decisions, 2);
    assert.equal(result.agent.observations.length, 1);
    assert.deepEqual(result.agent.result, result.agent.observations[0]?.output);
    assert.equal((result.agent.result as Record<string, unknown>).category, 'security');
    assert.equal(result.requests.length, 3);
    assert.ok(result.requests.every(receipt => receipt.status === 'succeeded'));
    assert.equal(result.simulatedSpend.reservedNanoUsd, 3 * (256 * 1000 + 512 * 4000));
    const rejected = await runOfflineExample('rejecting');
    assert.equal(rejected.status, 'failed');
    assert.equal(rejected.providerRequests, 1);
    assert.equal(rejected.requests[0]?.status, 'failed');
    assert.equal(rejected.simulatedSpend.reservedNanoUsd, 256 * 1000 + 512 * 4000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('transport denies endpoint, method, model, tools, and output changes before delegation', async () => {
  let delegated = 0;
  const bounded = createBoundedTransport(OFFLINE_POLICY, async () => { delegated++; return Response.json({}); });
  await assert.rejects(bounded.fetch('https://other.invalid/v1/chat/completions', request()));
  await assert.rejects(bounded.fetch(OFFLINE_POLICY.endpoint, { ...request(), method: 'GET' }));
  for (const overrides of [{ model: 'other' }, { max_tokens: 513 }, { max_tokens: 0 },
    { max_tokens: 1.5 }, { tools: [] }, { functions: [] }, { function_call: 'auto' },
    { tool_choice: 'none' }, { stream: true }, { n: 2 }, { service_tier: 'priority' }]) {
    await assert.rejects(bounded.fetch(OFFLINE_POLICY.endpoint, request(overrides)));
  }
  await assert.rejects(bounded.fetch(OFFLINE_POLICY.endpoint, { method: 'POST', body: 'null' }));
  await assert.rejects(bounded.fetch(OFFLINE_POLICY.endpoint, { method: 'POST', body: '{' }));
  assert.equal(bounded.requestCount(), 0);
  assert.equal(delegated, 0);
});

test('transport bounds UTF-8 request bytes and honors a pre-aborted signal', async () => {
  let delegated = 0;
  const bounded = createBoundedTransport({ ...OFFLINE_POLICY, maxRequestBytes: 150 }, async () => {
    delegated++; return Response.json({});
  });
  await assert.rejects(bounded.fetch(OFFLINE_POLICY.endpoint, request({ messages: ['界'.repeat(40)] })), /byte limit/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(bounded.fetch(OFFLINE_POLICY.endpoint, { ...request(), signal: aborted.signal }));
  assert.equal(delegated, 0);
});

test('transport counts failed attempts, blocks request six, and rejects redirects', async () => {
  let delegated = 0;
  const bounded = createBoundedTransport(OFFLINE_POLICY, async (_input, init) => {
    assert.equal(init?.redirect, 'error');
    delegated++;
    throw new Error('Simulated failure');
  });
  for (let i = 0; i < 5; i++) {
    await assert.rejects(bounded.fetch(OFFLINE_POLICY.endpoint, request()), /Simulated failure/);
  }
  await assert.rejects(bounded.fetch(OFFLINE_POLICY.endpoint, request()), /budget exhausted/);
  assert.equal(bounded.requestCount(), 5);
  assert.equal(delegated, 5);
  assert.ok(bounded.receipts().every(receipt => receipt.status === 'failed'));
  const redirecting = createBoundedTransport(OFFLINE_POLICY, async () => Response.redirect('https://other.invalid'));
  await assert.rejects(redirecting.fetch(OFFLINE_POLICY.endpoint, request()), /redirect rejected/);
});

test('simultaneous requests cannot reserve or transmit beyond the request cap', async () => {
  const ledger = createSpendLedger(OFFLINE_SPEND_POLICY, async () => 256);
  let delegated = 0;
  const bounded = createTransport({ ...OFFLINE_POLICY, maxRequests: 1 }, async () => {
    delegated++; return Response.json({});
  }, ledger);
  const results = await Promise.allSettled([
    bounded.fetch(OFFLINE_POLICY.endpoint, request()), bounded.fetch(OFFLINE_POLICY.endpoint, request()),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(delegated, 1);
  assert.equal(ledger.snapshot().reservedNanoUsd, 256 * 1000 + 512 * 4000);
});

test('missing token counts and insufficient spend reject before transport delegation', async () => {
  let delegated = 0;
  for (const tokens of [0, -1, Number.NaN, 1.5, 4097]) {
    const ledger = createSpendLedger(OFFLINE_SPEND_POLICY, () => tokens);
    const bounded = createTransport(OFFLINE_POLICY, async () => { delegated++; return Response.json({}); }, ledger);
    await assert.rejects(bounded.fetch(OFFLINE_POLICY.endpoint, request()), /Token limit/);
    assert.equal(ledger.snapshot().reservedNanoUsd, 0);
  }
  const ledger = createSpendLedger({ ...OFFLINE_SPEND_POLICY, maxCostNanoUsd: 1 }, () => 256);
  const bounded = createTransport(OFFLINE_POLICY, async () => { delegated++; return Response.json({}); }, ledger);
  await assert.rejects(bounded.fetch(OFFLINE_POLICY.endpoint, request()), /Spend budget exhausted/);
  assert.equal(delegated, 0);
});

test('ledger rejects invalid prices, handles large integers, and does not overbook concurrent spend', async () => {
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    assert.throws(() => createSpendLedger({ ...OFFLINE_SPEND_POLICY, inputNanoUsdPerToken: value }, () => 1));
  }
  const policy = { maxInputTokens: 10, maxCostNanoUsd: 5, inputNanoUsdPerToken: 1, outputNanoUsdPerToken: 1 };
  const ledger = createSpendLedger(policy, async () => 2);
  const results = await Promise.allSettled([ledger.reserve({}, 3), ledger.reserve({}, 3)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(ledger.snapshot().reservedNanoUsd, 5);
  const huge = createSpendLedger({ ...policy, inputNanoUsdPerToken: Number.MAX_SAFE_INTEGER }, () => 2);
  await assert.rejects(huge.reserve({}, 3), /Spend budget exhausted/);
});

test('cancellation during token counting leaves no reservation', async () => {
  const controller = new AbortController();
  const ledger = createSpendLedger(OFFLINE_SPEND_POLICY, async () => { controller.abort(); return 256; });
  await assert.rejects(ledger.reserve({}, 512, controller.signal));
  assert.equal(ledger.snapshot().reservedNanoUsd, 0);
});

test('transport validates and snapshots policy before use', async () => {
  const transport: typeof globalThis.fetch = async () => Response.json({});
  for (const endpoint of ['http://example.invalid', 'https://user:secret@example.invalid',
    'https://example.invalid/?query=1', 'https://example.invalid/#fragment']) {
    assert.throws(() => createBoundedTransport({ ...OFFLINE_POLICY, endpoint }, transport));
  }
  for (const maxRequests of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createBoundedTransport({ ...OFFLINE_POLICY, maxRequests }, transport));
  }
  const policy = { ...OFFLINE_POLICY, maxRequests: 1 };
  const bounded = createBoundedTransport(policy, transport);
  policy.maxRequests = 100;
  await bounded.fetch(OFFLINE_POLICY.endpoint, request());
  await assert.rejects(bounded.fetch(OFFLINE_POLICY.endpoint, request()), /budget exhausted/);
});

/** Multi-case approval and failure paths use injected credentials/transports exclusively. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { loadEvaluationData, scoreEvaluationCase } from '../evaluate.js';
import { executeTriageGoal } from '../harness.js';
import { prepareLivePlan, type LiveHost } from '../live.js';
import { executeSuitePlan, prepareSuitePlan, renderSuiteReview, type PreparedSuitePlan, type SuiteLiveReceipt } from '../suite-live.js';
import { createSuiteSpendLedger } from '../suite-budget.js';

const key = 'fixture-suite-credential';
const sensitive = 'sensitive-provider-error-payload';
const usage = { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 };
const resign = (plan: PreparedSuitePlan): PreparedSuitePlan => {
  const { approvalDigest: _old, ...payload } = plan;
  return { ...payload, approvalDigest: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
};

async function fixtureHost(
  customize?: (index: number, content: unknown) => Response,
): Promise<{ host: LiveHost; counts: { calls: number; reads: number } }> {
  const { suite, fixtures } = await loadEvaluationData();
  const responses = suite.cases.flatMap(entry => fixtures.responses[entry.id]!);
  const counts = { calls: 0, reads: 0 };
  return { counts, host: { transportMode: 'fixture',
    readCredential: async source => { assert.equal(source.kind, 'environment'); counts.reads++; return key; },
    transport: async (input, init) => {
      const index = counts.calls++;
      const entry = suite.cases[Math.floor(index / 3)]!;
      const body = JSON.parse(String(init?.body));
      assert.equal(String(input), 'https://api.openai.com/v1/chat/completions');
      assert.equal(body.model, 'gpt-6-luna');
      assert.equal(body.max_completion_tokens, 512);
      assert.equal(init?.redirect, 'error');
      assert.ok(!JSON.stringify(body.messages).includes(entry.reviewNote));
      return customize ? customize(index, responses[index]) : Response.json({
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(responses[index]) } }], usage,
      });
    },
  } };
}

async function savedReceipt(plan: PreparedSuitePlan): Promise<SuiteLiveReceipt> {
  return JSON.parse(await readFile(join(plan.workspaceRoot, '.pixiecore/pixieagent-runs', `${plan.runId}.suite.receipt.json`), 'utf8'));
}

test('missing/wrong approval, expiry, changed corpus/source/policy and old plans stop before credentials', async () => {
  const plan = await prepareSuitePlan();
  const { host, counts } = await fixtureHost();
  await assert.rejects(executeSuitePlan(plan, undefined, host));
  await assert.rejects(executeSuitePlan(plan, 'wrong', host));
  const variants = [
    resign({ ...plan, expiresAt: '2000-01-01T00:00:00Z' }),
    resign({ ...plan, expiresAt: '2099-01-01T00:00:00Z' }),
    resign({ ...plan, cases: plan.cases.map((entry, i) => i ? entry : { ...entry, goal: 'Different input' }) }),
    resign({ ...plan, source: { ...plan.source, headSha: '0'.repeat(40) } }),
    resign({ ...plan, policy: { ...plan.policy, maxCostUsd: 2 } } as unknown as PreparedSuitePlan),
  ];
  for (const changed of variants) await assert.rejects(executeSuitePlan(changed, changed.approvalDigest, host));
  const old = await prepareLivePlan();
  await assert.rejects(executeSuitePlan(old as unknown as PreparedSuitePlan, old.approvalDigest, host));
  assert.equal(counts.reads, 0);
  assert.equal(counts.calls, 0);
  await assert.rejects(prepareSuitePlan({ kind: 'dotenv', path: 'relative.env' }));
});

test('six fixture cases share one reconciled budget and persist mechanical completion with review pending', async () => {
  const plan = await prepareSuitePlan();
  const { host, counts } = await fixtureHost();
  const receipt = await executeSuitePlan(plan, plan.approvalDigest, host);
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.humanReviewStatus, 'pending');
  assert.equal(receipt.generalModelAccuracyEstablished, false);
  assert.equal(receipt.cases.length, 6);
  assert.ok(receipt.cases.every(entry => entry.score.passed));
  assert.equal(receipt.providerRequests, 18);
  assert.equal(receipt.networkRequests, 0);
  assert.equal(counts.calls, 18);
  assert.equal(counts.reads, 1);
  assert.equal(receipt.budget.usageCeilingNanoUsd, 1_260_000);
  assert.equal(receipt.budget.pendingReservationNanoUsd, 0);
  assert.equal(receipt.budget.maxCostNanoUsd, 1_000_000_000);
  assert.equal(receipt.usageSettlements.length, 18);
  assert.equal(receipt.costUsd, null);
  assert.deepEqual(await savedReceipt(plan), receipt);
  assert.ok(!JSON.stringify(receipt).includes(key));
  const review = await readFile(join(plan.workspaceRoot, '.pixiecore/pixieagent-runs', `${plan.runId}.suite.review.md`), 'utf8');
  assert.match(review, /Human review: pending/);
  assert.equal((review.match(/## /g) ?? []).length, 6);
  await assert.rejects(executeSuitePlan(structuredClone(plan), plan.approvalDigest, host));
  assert.equal(counts.calls, 18);
  assert.equal(counts.reads, 1);
});

test('the historical second-case testing low mismatch still fails and consumes the suite approval', async () => {
  const plan = await prepareSuitePlan();
  assert.deepEqual(plan.cases[1]?.expected, { category: 'testing', severity: 'medium' });
  const wrong = { category: 'testing', severity: 'low', reason: 'The test is intermittent and production is unaffected.' };
  const { host, counts } = await fixtureHost((index, content) => Response.json({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(
      index === 4 ? wrong : index === 5
        ? { kind: 'finish', action_id: null, input: null, result: wrong } : content,
    ) } }], usage,
  }));
  const receipt = await executeSuitePlan(plan, plan.approvalDigest, host);
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.cases.length, 2);
  assert.equal(receipt.cases[0]?.score.passed, true);
  assert.equal(receipt.cases[1]?.score.checks.classification, false);
  assert.equal(receipt.cases[1]?.score.checks.finalAgreement, true);
  assert.deepEqual(receipt.cases[1]?.score.classification.differences,
    [{ pointer: '/severity', reason: 'not_equal', expected: 'medium', actual: 'low' }]);
  assert.equal(receipt.providerRequests, 6);
  assert.equal(counts.calls, 6);
  assert.equal(receipt.budget.settledRequests, 6);
  assert.equal(receipt.budget.pendingReservationNanoUsd, 0);
  assert.equal(receipt.humanReviewStatus, 'pending');
  assert.deepEqual(await savedReceipt(plan), receipt);
  await assert.rejects(executeSuitePlan(plan, plan.approvalDigest, host));
  assert.equal(counts.calls, 6);
  assert.equal(counts.reads, 1);
});

test('missing/invalid usage stops globally, retains the full hold and cannot be replayed', async () => {
  for (const reported of [undefined, { ...usage, total_tokens: 239 }]) {
    const plan = await prepareSuitePlan();
    const { host, counts } = await fixtureHost((_index, content) => Response.json({
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }], usage: reported,
    }));
    const receipt = await executeSuitePlan(plan, plan.approvalDigest, host);
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.providerRequests, 1);
    assert.equal(receipt.budget.pendingReservationNanoUsd, 210_384_000);
    assert.equal(receipt.budget.usageCeilingNanoUsd, 0);
    assert.deepEqual(receipt.usageSettlements, []);
    assert.equal(receipt.cases.length, 0);
    assert.deepEqual(receipt.requests[0]?.attemptedBlueprints, ['./blueprints/planner.yaml']);
    assert.deepEqual(await savedReceipt(plan), receipt);
    await assert.rejects(executeSuitePlan(plan, plan.approvalDigest, host));
    assert.equal(counts.calls, 1);
    assert.equal(counts.reads, 1);
  }
});

test('credential setup failures consume the claim without making any provider request', async () => {
  for (const throws of [false, true]) {
    const plan = await prepareSuitePlan();
    let reads = 0;
    let calls = 0;
    const host: LiveHost = { transportMode: 'fixture', readCredential: async () => {
      reads++;
      if (throws) throw new Error(sensitive);
      return ' ';
    }, transport: async () => { calls++; throw new Error('Unexpected delegation'); } };
    const receipt = await executeSuitePlan(plan, plan.approvalDigest, host);
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.providerRequests, 0);
    assert.equal(receipt.budget.reservedNanoUsd, 0);
    assert.equal(calls, 0);
    assert.ok(!JSON.stringify(receipt).includes(sensitive));
    assert.deepEqual(await savedReceipt(plan), receipt);
    await assert.rejects(executeSuitePlan(plan, plan.approvalDigest, host));
    assert.equal(reads, 1);
  }
});

test('worst-case usage crosses a case boundary without resetting the USD 1 ceiling', async () => {
  const plan = await prepareSuitePlan();
  const { host, counts } = await fixtureHost((_index, content) => Response.json({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }],
    usage: { prompt_tokens: plan.requestPolicy.maxInputTokens, completion_tokens: 512,
      total_tokens: plan.requestPolicy.maxInputTokens + 512 },
  }));
  const receipt = await executeSuitePlan(plan, plan.approvalDigest, host);
  assert.equal(receipt.status, 'failed');
  assert.equal(counts.calls, 4);
  assert.equal(receipt.cases.length, 1);
  assert.equal(receipt.providerRequests, 4);
  assert.equal(receipt.budget.reservedNanoUsd, 841_536_000);
  assert.equal(receipt.budget.pendingReservationNanoUsd, 0);
  assert.equal(receipt.requests.length, 2);
  assert.deepEqual(await savedReceipt(plan), receipt);
});

test('transport/HTTP failures keep the hold and errors private; interrupted responses stop after reconciliation', async () => {
  for (const status of [0, 401, 429, 503, 200]) {
    const plan = await prepareSuitePlan();
    const { host, counts } = await fixtureHost((_index, content) => {
      if (status === 0) throw new Error(sensitive);
      return status === 200
        ? Response.json({ choices: [{ finish_reason: 'length', message: { role: 'assistant', content: JSON.stringify(content) } }], usage })
        : Response.json({ error: { message: sensitive }, usage }, { status });
    });
    const receipt = await executeSuitePlan(plan, plan.approvalDigest, host);
    assert.equal(receipt.status, 'failed');
    assert.equal(counts.calls, 1);
    assert.equal(receipt.cases.length, 0);
    assert.equal(receipt.budget.pendingReservationNanoUsd, status === 200 ? 0 : 210_384_000);
    assert.equal(receipt.budget.usageCeilingNanoUsd, status === 200 ? 70_000 : 0);
    assert.ok(!JSON.stringify(receipt).includes(sensitive));
    assert.ok(!JSON.stringify(receipt).includes(key));
    assert.deepEqual(await savedReceipt(plan), receipt);
  }
});

test('an already-aborted parent signal stops the shared goal runtime before provider delegation', async () => {
  const reason = new Error('Suite stopped');
  const trace: string[] = [];
  let calls = 0;
  await assert.rejects(executeTriageGoal(async () => { calls++; return Response.json({}); },
    key, 'fixture', trace, 'Synthetic goal', AbortSignal.abort(reason)), error => error === reason);
  assert.equal(calls, 0);
  assert.deepEqual(trace, []);
});

test('redirected or wrong-origin responses cannot release a hold even with valid-looking usage', async () => {
  for (const field of ['redirected', 'url']) {
    const plan = await prepareSuitePlan();
    const { host, counts } = await fixtureHost((_index, content) => {
      const response = Response.json({ choices: [{ finish_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(content) } }], usage });
      Object.defineProperty(response, field, { value: field === 'redirected' ? true : 'https://other.invalid' });
      return response;
    });
    const receipt = await executeSuitePlan(plan, plan.approvalDigest, host);
    assert.equal(receipt.status, 'failed');
    assert.equal(counts.calls, 1);
    assert.equal(receipt.budget.pendingReservationNanoUsd, 210_384_000);
    assert.deepEqual(receipt.usageSettlements, []);
  }
});

test('a mechanical mismatch prevents the next case even though the first case returned valid JSON', async () => {
  const plan = await prepareSuitePlan();
  const wrong = { category: 'other', severity: 'low', reason: 'Deliberately wrong synthetic classification.' };
  const { host, counts } = await fixtureHost((index, content) => Response.json({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(index === 1 ? wrong
      : index === 2 ? { kind: 'finish', action_id: null, input: null, result: wrong } : content) } }], usage,
  }));
  const receipt = await executeSuitePlan(plan, plan.approvalDigest, host);
  assert.equal(receipt.status, 'failed');
  assert.equal(counts.calls, 3);
  assert.equal(receipt.cases.length, 1);
  assert.equal(receipt.cases[0]?.score.checks.classification, false);
  assert.equal(receipt.budget.usageCeilingNanoUsd, 210_000);
  assert.equal(receipt.humanReviewStatus, 'pending');
});

test('execution snapshots the approved plan rather than rereading caller-mutated credential/corpus fields', async () => {
  const plan = await prepareSuitePlan();
  const { host, counts } = await fixtureHost();
  const run = executeSuitePlan(plan, plan.approvalDigest, host);
  (plan as unknown as { credentialSource: unknown }).credentialSource = { kind: 'dotenv', path: '/must-not-be-read.env' };
  (plan as unknown as { cases: unknown }).cases = [];
  const receipt = await run;
  assert.equal(receipt.status, 'completed');
  assert.equal(counts.reads, 1);
  assert.equal(counts.calls, 18);
});

test('review rendering keeps model-authored Markdown/HTML inert and never checks semantic acceptance boxes', async () => {
  const plan = await prepareSuitePlan();
  const entry = plan.cases[0]!;
  const result = { category: 'security', severity: 'high', reason: '```\n![external](https://example.invalid)\n<img src=x>' };
  const agent = { result, decisions: 2, observations: [{ action_id: 'classify-issue', input: { issue_text: entry.goal }, output: result }] };
  const path = ['./blueprints/planner.yaml', './blueprints/classify-issue.yaml', './blueprints/planner.yaml'];
  const score = await scoreEvaluationCase(entry, agent, path, path);
  const receipt: SuiteLiveReceipt = { schema: 'pixieagent.suite-live-receipt/v0', runId: plan.runId,
    approvalDigest: plan.approvalDigest, transportMode: 'fixture', status: 'completed', humanReviewStatus: 'pending',
    generalModelAccuracyEstablished: false, providerRequests: 0, networkRequests: 0, httpStatuses: [],
    budget: createSuiteSpendLedger(30).snapshot(), usageSettlements: [], requests: [], costUsd: null,
    cases: [{ id: entry.id, agent, score, attemptedBlueprints: path }] };
  const text = renderSuiteReview(plan, receipt);
  assert.match(text, /Human review: pending/);
  assert.ok(text.includes('\\u0060'));
  assert.ok(!text.includes('<img'));
  assert.ok(!text.includes('- [x]'));
});

test('the suite CLI prepares an unread credential path and refuses execution without exact approval', async () => {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const exec = promisify(execFile);
  const args = ['--import', './examples/pixieagent/tests/deny-network.mjs', '--import', 'tsx', 'examples/pixieagent/suite-live.ts'];
  const options = { cwd, env: { ...process.env, OPENAI_API_KEY: '', PIXIEAGENT_APPROVED_SUITE_PLAN_SHA256: '', NODE_OPTIONS: '' } };
  const prepared = await exec(process.execPath, [...args, '--prepare', '--credential-file', '/must-not-be-read.env'], options);
  const plan = JSON.parse(prepared.stdout) as PreparedSuitePlan;
  assert.equal(plan.cases.length, 6);
  assert.equal(plan.policy.maxCostUsd, 1);
  assert.equal(plan.policy.maxRequests, 30);
  const directory = await mkdtemp(join(tmpdir(), 'pixieagent-suite-test-'));
  const file = join(directory, 'plan.json');
  await writeFile(file, prepared.stdout, { mode: 0o600 });
  await assert.rejects(exec(process.execPath, [...args, '--execute', file], options), error => {
    const failure = error as Error & { code?: number; stdout?: string };
    assert.equal(failure.code, 1);
    assert.equal(JSON.parse(failure.stdout!).errorCode, 'suite_approval_setup_or_claim_failed');
    return true;
  });
  await assert.rejects(access(join(plan.workspaceRoot, '.pixiecore/pixieagent-runs', `${plan.runId}.claimed`)));
});

/** Approval handoff tests. All delegated calls use fixtures; no credentials or network are accessed. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { executePreparedPlan, prepareLivePlan } from '../live.js';
import { SYNTHETIC_GOAL } from '../harness.js';

test('missing/mismatched approval and changed sources stop before credential access', async () => {
  const plan = await prepareLivePlan();
  let reads = 0;
  const host = { transportMode: 'fixture' as const,
    readCredential: async () => { reads++; return 'fixture-only'; },
    transport: (async () => { throw new Error('Unexpected delegation'); }) as typeof globalThis.fetch };
  await assert.rejects(executePreparedPlan(plan, undefined, host), /Explicit approval/);
  await assert.rejects(executePreparedPlan(plan, 'wrong', host), /Explicit approval/);
  const changed = structuredClone(plan);
  (changed.manifest.source.sha256 as Record<string, string>)['agent.ts'] = 'changed';
  await assert.rejects(executePreparedPlan(changed, plan.approvalDigest, host), /Explicit approval/);
  const { approvalDigest: _oldDigest, ...payload } = changed;
  const signedChange = { ...payload, approvalDigest: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
  await assert.rejects(executePreparedPlan(signedChange, signedChange.approvalDigest, host), /source or runtime changed/);
  assert.equal(reads, 0);
});

test('approved fixture run persists one-shot evidence and rejects reuse of a copied plan', async () => {
  const plan = await prepareLivePlan();
  const classification = { category: 'security', severity: 'high', reason: 'Synthetic reason' };
  const responses = [
    { kind: 'act', action_id: 'classify-issue', input: { issue_text: SYNTHETIC_GOAL }, result: null },
    classification, { kind: 'finish', action_id: null, input: null, result: classification },
  ];
  let calls = 0;
  const host = { transportMode: 'fixture' as const, readCredential: async () => 'fixture-only',
    transport: (async () => {
      calls++;
      return Response.json({ choices: [{ finish_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(responses.shift()) } }],
        usage: { prompt_tokens: 123, completion_tokens: 45 } });
    }) as typeof globalThis.fetch };
  const receipt = await executePreparedPlan(plan, plan.approvalDigest, host);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.networkRequests, 0);
  assert.equal(calls, 3);
  assert.equal(receipt.reservations.reservedNanoUsd, 631_152_000);
  assert.deepEqual(receipt.usageObserved[0], { inputTokens: 123, outputTokens: 45 });
  assert.equal(receipt.costUsd, null);
  assert.deepEqual(receipt.httpStatuses, [200, 200, 200]);
  const saved = JSON.parse(await readFile(join(plan.workspaceRoot, '.pixiecore', 'pixieagent-runs', `${plan.runId}.receipt.json`), 'utf8'));
  assert.deepEqual(saved, receipt);
  await assert.rejects(executePreparedPlan(structuredClone(plan), plan.approvalDigest, host));
  assert.equal(calls, 3);
});

test('a failed approved fixture run retains its reservation and cannot be replayed', async () => {
  const plan = await prepareLivePlan();
  let calls = 0;
  const host = { transportMode: 'fixture' as const, readCredential: async () => 'fixture-only',
    transport: (async () => { calls++; throw new Error('Sensitive provider error must not be recorded'); }) as typeof globalThis.fetch };
  const receipt = await executePreparedPlan(plan, plan.approvalDigest, host);
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.reservations.reservedNanoUsd, 210_384_000);
  assert.equal(receipt.requests[0]?.status, 'failed');
  assert.ok(!JSON.stringify(receipt).includes('Sensitive provider error'));
  await assert.rejects(executePreparedPlan(plan, plan.approvalDigest, host));
  assert.equal(calls, 1);
});

const sensitiveFixture = 'sensitive-fixture-provider-payload';

/** Exercise the actual approval/runtime/receipt path without opening a connection. */
async function expectFailedFixture(response: (index: number) => Response, expectedStatuses: number[]): Promise<void> {
  const plan = await prepareLivePlan();
  let calls = 0;
  const host = { transportMode: 'fixture' as const, readCredential: async () => 'fixture-only',
    transport: (async () => response(calls++)) as typeof globalThis.fetch };
  const receipt = await executePreparedPlan(plan, plan.approvalDigest, host);
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.errorCode, 'execution_failed');
  assert.equal(receipt.agent, undefined);
  assert.equal(receipt.networkRequests, 0);
  assert.equal(receipt.providerRequests, expectedStatuses.length);
  assert.equal(calls, expectedStatuses.length);
  assert.equal(receipt.reservations.reservedNanoUsd, 210_384_000 * calls);
  assert.deepEqual(receipt.httpStatuses, expectedStatuses);
  assert.equal(receipt.costUsd, null);
  const saved = JSON.parse(await readFile(join(plan.workspaceRoot, '.pixiecore', 'pixieagent-runs', `${plan.runId}.receipt.json`), 'utf8'));
  assert.deepEqual(saved, receipt);
  assert.ok(!JSON.stringify(saved).includes(sensitiveFixture));
  assert.ok(!JSON.stringify(saved).includes('fixture-only'));
  await assert.rejects(executePreparedPlan(structuredClone(plan), plan.approvalDigest, host));
  assert.equal(calls, expectedStatuses.length);
}

test('interrupted or refused completions stop before the next action or decision', async () => {
  const classification = { category: 'security', severity: 'high', reason: sensitiveFixture };
  const outputs = [
    { kind: 'act', action_id: 'classify-issue', input: { issue_text: SYNTHETIC_GOAL }, result: null },
    classification, { kind: 'finish', action_id: null, input: null, result: classification },
  ];
  for (const failedAt of [0, 1]) {
    for (const refusal of [false, true]) {
      await expectFailedFixture(index => Response.json({ choices: [{
        finish_reason: index === failedAt && !refusal ? 'length' : 'stop',
        message: { role: 'assistant', content: JSON.stringify(outputs[index]),
          ...(index === failedAt && refusal ? { refusal: sensitiveFixture } : {}) },
      }] }), Array.from({ length: failedAt + 1 }, () => 200));
    }
  }
});

test('HTTP authorization, rate-limit and service failures do not retry or expose provider payloads', async () => {
  for (const status of [401, 429, 503]) {
    await expectFailedFixture(() => Response.json({ error: { message: sensitiveFixture } }, {
      status, headers: { 'retry-after': '0' },
    }), [status]);
  }
});

test('malformed provider JSON or structured content persists failure without another request', async () => {
  for (const body of [sensitiveFixture, JSON.stringify({ choices: [{ finish_reason: 'stop',
    message: { role: 'assistant', content: sensitiveFixture } }] })]) {
    await expectFailedFixture(() => new Response(body, { headers: { 'content-type': 'application/json' } }), [200]);
  }
});

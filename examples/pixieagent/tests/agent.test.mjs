import { test } from 'node:test';
import assert from 'node:assert/strict';
// Native Node type stripping requires the source extension, without tsx or a build.
// @ts-expect-error TS5097: the repository examples config forbids .ts imports.
import { PixieAgent, PixieAgentError } from '../agent.ts';

/**
 * @param {'read' | 'write'} permission
 * @param {number} max_actions
 * @returns {import('../agent.js').AgentDefinition}
 */
const definition = (permission = 'read', max_actions = 2) => ({
  schema: 'pixieagent.definition/v0', id: 'example', version: '0.1.0',
  planner: { path: 'planner.yaml', version: '1.0.0' }, max_actions,
  actions: [{
    id: 'check', description: 'Check the supplied issue', permission,
    blueprint: { path: 'check.yaml', version: '1.0.0' },
  }],
});

/** @param {unknown[]} responses */
function fake(responses) {
  /** @type {{path: string, inputs: import('../agent.js').JsonObject}[]} */
  const calls = [];
  return {
    calls,
    /** @param {string} path @param {import('../agent.js').JsonObject} inputs */
    async execute(path, inputs) {
      calls.push({ path, inputs });
      if (!responses.length) throw new Error('Unexpected Blueprint execution');
      return responses.shift();
    },
  };
}

const act = { kind: 'act', action_id: 'check', input: { issue: 'test' } };
const finish = { kind: 'finish', result: { verdict: 'ok' } };

test('planner selects allowlisted Blueprint then finishes with a typed result', async () => {
  const executor = fake([act, { safe: true }, finish]);
  const result = await new PixieAgent(definition(), executor).run('Review issue');
  assert.deepEqual(result.result, { verdict: 'ok' });
  assert.deepEqual(result.observations, [{ action_id: 'check', input: { issue: 'test' }, output: { safe: true } }]);
  assert.equal(result.decisions, 2);
  assert.deepEqual(executor.calls.map(call => call.path), ['planner.yaml', 'check.yaml', 'planner.yaml']);
  assert.deepEqual(executor.calls[2]?.inputs.observations, [
    { action_id: 'check', input: { issue: 'test' }, output: { safe: true } },
  ]);
});

test('write-capable Blueprint is denied by default before the action executes', async () => {
  const executor = fake([act]);
  await assert.rejects(new PixieAgent(definition('write'), executor).run('Update file'),
    err => err instanceof PixieAgentError && err.code === 'write_not_authorized');
  assert.equal(executor.calls.length, 1);
});

test('host approval permits one explicitly selected write action', async () => {
  const executor = fake([act, { done: true }, finish]);
  let approvals = 0;
  const result = await new PixieAgent(definition('write'), executor).run('Update file', {
    authorizeWrite: async (action, input) => {
      approvals++;
      assert.equal(action.id, 'check');
      assert.equal(input.issue, 'test');
      return true;
    },
  });
  assert.equal(approvals, 1);
  assert.equal(result.observations.length, 1);
});

test('unknown action from LLM is rejected before execution', async () => {
  const executor = fake([{ kind: 'act', action_id: 'shell', input: {} }]);
  await assert.rejects(new PixieAgent(definition(), executor).run('Test'),
    err => err instanceof PixieAgentError && err.code === 'unknown_action');
  assert.equal(executor.calls.length, 1);
});

test('decision/action budget terminates an agent that never finishes', async () => {
  const executor = fake([act, { ok: 1 }, act, { ok: 2 }]);
  await assert.rejects(new PixieAgent(definition('read', 1), executor).run('Test'),
    err => err instanceof PixieAgentError && err.code === 'action_budget_exhausted');
  assert.deepEqual(executor.calls.map(call => call.path), ['planner.yaml', 'check.yaml', 'planner.yaml']);
});

test('invalid planner response fails closed', async () => {
  for (const decision of [{ kind: 'act', action_id: 'check' }, { kind: 'finish' }, [], null]) {
    const executor = fake([decision]);
    await assert.rejects(new PixieAgent(definition(), executor).run('Test'),
      err => err instanceof PixieAgentError && err.code === 'invalid_decision');
    assert.equal(executor.calls.length, 1);
  }
});

test('invalid or duplicate declared actions fail at construction', () => {
  const d = definition();
  const firstAction = d.actions[0];
  assert.ok(firstAction);
  assert.throws(() => new PixieAgent({ ...d, actions: [...d.actions, firstAction] }, fake([])),
    err => err instanceof PixieAgentError && err.code === 'invalid_definition');
});

test('abort signal prevents any Blueprint invocation', async () => {
  const ac = new AbortController();
  ac.abort();
  const executor = fake([]);
  await assert.rejects(new PixieAgent(definition(), executor).run('Test', { signal: ac.signal }));
  assert.equal(executor.calls.length, 0);
});

test('non-JSON and circular Blueprint outputs are rejected', async () => {
  for (const bad of [Number.NaN, () => {}, { date: new Date() }]) {
    const executor = fake([act, bad]);
    await assert.rejects(new PixieAgent(definition(), executor).run('Test'),
      err => err instanceof PixieAgentError && err.code === 'invalid_json');
  }
  /** @type {Record<string, unknown>} */
  const c = {}; c.self = c;
  const executor = fake([act, c]);
  await assert.rejects(new PixieAgent(definition(), executor).run('Test'),
    err => err instanceof PixieAgentError && err.code === 'invalid_json');
});

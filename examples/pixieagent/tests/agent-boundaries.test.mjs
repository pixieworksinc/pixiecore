/** Dependency-free regression tests for agent configuration, approval, and JSON boundaries. */
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test } from 'node:test';
// @ts-expect-error TS5097: native Node type stripping needs the source extension.
import { PixieAgent, PixieAgentError } from '../agent.ts';

function declaration() {
  const planner = { path: 'planner.yaml', version: '1.0.0' };
  const action = { id: 'write', description: 'Write the selected artifact',
    permission: /** @type {'read' | 'write'} */ ('write'), blueprint: { path: 'write.yaml', version: '1.0.0' } };
  return { action, planner, definition: { schema: /** @type {'pixieagent.definition/v0'} */ ('pixieagent.definition/v0'),
    id: 'boundary-test', version: '0.1.0', planner, max_actions: 1, actions: [action] } };
}

/** @param {string} code */
const hasCode = code => /** @param {unknown} error */ error => error instanceof PixieAgentError && error.code === code;
const act = { kind: 'act', action_id: 'write', input: { artifact: 'requested', nested: { value: 'original' } } };
const finish = { kind: 'finish', result: { ok: true } };

test('agent pins an immutable definition independently of the caller', async () => {
  const d = declaration();
  /** @type {string[]} */
  const paths = [];
  const agent = new PixieAgent(d.definition, { execute: async path => { paths.push(path); return act; } });
  d.action.permission = 'read';
  d.action.blueprint.path = 'unapproved.yaml';
  d.planner.path = 'changed-planner.yaml';
  d.definition.max_actions = 32;
  assert.equal(agent.definition.actions[0]?.permission, 'write');
  assert.equal(agent.definition.max_actions, 1);
  assert.ok(Object.isFrozen(agent.definition));
  assert.ok(Object.isFrozen(agent.definition.actions));
  assert.equal(Reflect.set(agent, 'definition', d.definition), false);
  await assert.rejects(agent.run('Test'), hasCode('write_not_authorized'));
  assert.deepEqual(paths, ['planner.yaml']);
});

test('definition accessors are rejected before they can change authorization policy', () => {
  const d = declaration();
  let reads = 0;
  Object.defineProperty(d.action, 'permission', { enumerable: true, get: () => {
    reads++;
    return reads === 1 ? 'read' : 'unexpected';
  } });
  assert.throws(() => new PixieAgent(d.definition, { execute: async () => finish }), hasCode('invalid_definition'));
  assert.equal(reads, 0);
});

test('write authorization requires literal true rather than a truthy value', async () => {
  for (const approval of ['false', 'YES', 1, {}, []]) {
    let calls = 0;
    const agent = new PixieAgent(declaration().definition, { execute: async () => { calls++; return act; } });
    await assert.rejects(agent.run('Test', {
      // @ts-expect-error Runtime validation must also reject invalid JavaScript host results.
      authorizeWrite: async () => approval,
    }), hasCode('write_not_authorized'));
    assert.equal(calls, 1);
  }
});

test('authorization snapshots and observations cannot be changed by host or executor mutation', async () => {
  let call = 0;
  const agent = new PixieAgent(declaration().definition, {
    execute: async (_path, input) => {
      call++;
      if (call === 1) return act;
      if (call === 2) { input.artifact = 'executor changed it'; return { done: true }; }
      return finish;
    },
  });
  const result = await agent.run('Test', { authorizeWrite: async (action, input) => {
    assert.equal(Reflect.set(action.blueprint, 'path', 'unapproved.yaml'), false);
    assert.ok(Object.isFrozen(input));
    assert.ok(Object.isFrozen(input.nested));
    assert.equal(Reflect.set(input, 'artifact', 'different approval'), false);
    return true;
  } });
  assert.equal(result.observations[0]?.input.artifact, 'requested');
});

test('UTF-8 limits apply to outputs and the entire planner input before invocation', async () => {
  const text = '界'.repeat(23_000);
  assert.ok(Buffer.byteLength(JSON.stringify(text), 'utf8') > 64 * 1024);
  const agent = new PixieAgent(declaration().definition, { execute: async () => ({ kind: 'finish', result: text }) });
  await assert.rejects(agent.run('Test'), hasCode('output_too_large'));
  let calls = 0;
  const inputAgent = new PixieAgent(declaration().definition, { execute: async () => { calls++; return finish; } });
  await assert.rejects(inputAgent.run(text), hasCode('output_too_large'));
  assert.equal(calls, 0);
});

test('malformed action entries and more than 32 declared actions use the definition error', () => {
  const d = declaration();
  for (const entry of [null, undefined, 'bad', 1, {}]) {
    // @ts-expect-error Invalid external data is intentionally supplied to the constructor.
    assert.throws(() => new PixieAgent({ ...d.definition, actions: [entry] }, { execute: async () => finish }), hasCode('invalid_definition'));
  }
  assert.throws(() => new PixieAgent({ ...d.definition,
    actions: Array.from({ length: 33 }, (_, i) => ({ ...d.action, id: `a${i}` })),
  }, { execute: async () => finish }), hasCode('invalid_definition'));
});

test('accessors and custom array serialization are rejected without executing their code', async () => {
  let callbacks = 0;
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: () => { callbacks++; return 1; } });
  const customized = Object.defineProperty(/** @type {unknown[]} */ ([]), 'toJSON', {
    value: () => { callbacks++; return { injected: true }; },
  });
  for (const value of [accessor, customized]) {
    const agent = new PixieAgent(declaration().definition, { execute: async () => ({ kind: 'finish', result: value }) });
    await assert.rejects(agent.run('Test'), hasCode('invalid_json'));
  }
  const decision = Object.defineProperty({ result: {} }, 'kind', { enumerable: true,
    get: () => { callbacks++; return 'finish'; } });
  const agent = new PixieAgent(declaration().definition, { execute: async () => decision });
  await assert.rejects(agent.run('Test'), hasCode('invalid_json'));
  assert.equal(callbacks, 0);
});

test('deep JSON returns a controlled limit error before exhausting the JavaScript stack', async () => {
  /** @type {import('../agent.js').JsonValue} */
  let value = null;
  for (let i = 0; i < 1000; i++) value = [value];
  const agent = new PixieAgent(declaration().definition, { execute: async () => ({ kind: 'finish', result: value }) });
  await assert.rejects(agent.run('Test'), hasCode('output_too_deep'));
});

test('cancellation after an action wins over malformed output and prevents another decision', async () => {
  const controller = new AbortController();
  const reason = new Error('Stopped after action');
  let calls = 0;
  const agent = new PixieAgent(declaration().definition, { execute: async () => {
    calls++;
    if (calls === 1) return act;
    controller.abort(reason);
    return Number.NaN;
  } });
  await assert.rejects(agent.run('Test', { signal: controller.signal, authorizeWrite: async () => true }), error => error === reason);
  assert.equal(calls, 2);
});

test('cancellation settles pending host approval and ignores a late grant or rejection', { timeout: 1000 }, async () => {
  for (const rejectLater of [false, true]) {
    const controller = new AbortController();
    const reason = new Error('Cancelled while waiting for approval');
    /** @type {(value: boolean) => void} */
    let grant = () => {};
    /** @type {(reason: Error) => void} */
    let reject = () => {};
    /** @type {Promise<boolean>} */
    const approval = new Promise((resolve, rejectPromise) => { grant = resolve; reject = rejectPromise; });
    let entered = () => {};
    const ready = new Promise(resolve => { entered = () => resolve(undefined); });
    /** @type {string[]} */
    const paths = [];
    const agent = new PixieAgent(declaration().definition, {
      execute: async path => { paths.push(path); return act; },
    });
    const run = agent.run('Test', { signal: controller.signal, authorizeWrite: () => { entered(); return approval; } });
    await ready;
    controller.abort(reason);
    await assert.rejects(run, error => error === reason);
    if (rejectLater) reject(new Error('Late host rejection'));
    if (!rejectLater) grant(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(paths, ['planner.yaml']);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});

test('host approval removes its abort listener on grant, denial and error', async () => {
  for (const outcome of ['grant', 'deny', 'error']) {
    const controller = new AbortController();
    const reason = new Error('Host approval failed');
    let call = 0;
    const agent = new PixieAgent(declaration().definition, {
      execute: async () => {
        call++;
        if (call === 1) return act;
        return call === 2 ? {} : finish;
      },
    });
    const run = agent.run('Test', { signal: controller.signal, authorizeWrite: async () => {
      if (outcome === 'error') throw reason;
      return outcome === 'grant';
    } });
    if (outcome === 'grant') await run;
    if (outcome === 'deny') await assert.rejects(run, hasCode('write_not_authorized'));
    if (outcome === 'error') await assert.rejects(run, error => error === reason);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});

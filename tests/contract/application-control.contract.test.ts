import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApplicationBudgetExceededError,
  ApplicationConcurrencyLimitError,
  ApplicationControlContractError,
  ApplicationDeadlineExceededError,
  ApplicationExecutionController,
  ApplicationRateLimitError,
} from '../../src/core/kernel/application/index.js';
import { testData } from '../helpers/test-data.js';

const data = testData('application execution control');
const baseTime = Date.parse('2026-08-25T18:00:00.000Z');

test('controller accounts budget and releases concurrency after successful work', async () => {
  let now = baseTime;
  const controller = createController({ now: () => new Date(now) });
  const first = await controller.run({ unitId: data.text('first unit'), budgetUnits: 2.5 }, async context => {
    assert.equal(context.signal.aborted, false);
    assert.equal(controller.snapshot().active, 1);
    return data.text('controlled result');
  });
  now += 10;
  const second = await controller.run({ unitId: data.text('second unit'), budgetUnits: 1.5 }, () => 42);
  const snapshot = controller.snapshot();

  assert.equal(first, data.text('controlled result'));
  assert.equal(second, 42);
  assert.equal(snapshot.used_budget_units, 4);
  assert.equal(snapshot.remaining_budget_units, 6);
  assert.equal(snapshot.active, 0);
  assert.equal(snapshot.starts_in_window, 2);
  assert.equal(Object.isFrozen(snapshot), true);
});

test('budget, concurrency, and rolling start-rate limits reject before task start', async () => {
  let now = baseTime;
  const controller = createController({
    maxBudgetUnits: 3,
    maxConcurrent: 1,
    rateLimit: { maxStarts: 2, intervalMs: 100 },
    now: () => new Date(now),
  });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const active = controller.run({ unitId: 'active', budgetUnits: 1 }, () => held);
  let rejectedCalls = 0;
  await assert.rejects(
    controller.run({ unitId: 'concurrent', budgetUnits: 1 }, () => { rejectedCalls++; }),
    ApplicationConcurrencyLimitError,
  );
  release();
  await active;
  await controller.run({ unitId: 'second', budgetUnits: 1 }, () => undefined);
  await assert.rejects(
    controller.run({ unitId: 'rate-limited', budgetUnits: 1 }, () => { rejectedCalls++; }),
    error => error instanceof ApplicationRateLimitError && error.retryAfterMs === 100,
  );
  now += 100;
  await controller.run({ unitId: 'after-window', budgetUnits: 1 }, () => undefined);
  await assert.rejects(
    controller.run({ unitId: 'over-budget', budgetUnits: 0.1 }, () => { rejectedCalls++; }),
    error => error instanceof ApplicationBudgetExceededError
      && error.requestedUnits === 0.1
      && error.remainingUnits === 0,
  );
  assert.equal(rejectedCalls, 0);
});

test('deadline aborts active work with a value-free typed reason', async () => {
  const privateValue = data.text('deadline private value');
  const controller = createController({
    deadlineAt: new Date(Date.now() + 20),
    now: () => new Date(),
  });
  await assert.rejects(controller.run({ unitId: 'deadline', budgetUnits: 1 }, ({ signal }) => (
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  )), error => {
    assert.ok(error instanceof ApplicationDeadlineExceededError);
    assert.doesNotMatch(error.message, new RegExp(privateValue));
    return true;
  });

  const expired = createController({ deadlineAt: new Date(baseTime), now: () => new Date(baseTime) });
  await assert.rejects(
    expired.run({ unitId: 'expired', budgetUnits: 1 }, () => undefined),
    ApplicationDeadlineExceededError,
  );
});

test('explicit and parent cancellation propagate their exact reason and start no later task', async () => {
  const parent = new AbortController();
  const controller = createController({ signal: parent.signal });
  const activeReason = new Error(data.text('active cancellation'));
  const active = controller.run({ unitId: 'active', budgetUnits: 1 }, ({ signal }) => (
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  ));
  controller.cancel(activeReason);
  await assert.rejects(active, error => error === activeReason);

  const parentReason = new Error(data.text('parent cancellation'));
  parent.abort(parentReason);
  await assert.rejects(
    controller.run({ unitId: 'later', budgetUnits: 1 }, () => undefined),
    error => error === parentReason,
  );
  assert.equal(controller.snapshot().cancelled, true);
});

test('controller validates limits, deadlines, tasks, and clock values', async () => {
  const invalidOptions = [
    { maxBudgetUnits: 0 },
    { maxConcurrent: 0 },
    { rateLimit: { maxStarts: 0, intervalMs: 1 } },
    { rateLimit: { maxStarts: 1, intervalMs: 0 } },
    { deadlineAt: 'invalid' },
  ];
  for (const override of invalidOptions) {
    assert.throws(() => createController(override as never), ApplicationControlContractError);
  }

  const controller = createController();
  for (const options of [
    { unitId: '', budgetUnits: 1 },
    { unitId: 'unit', budgetUnits: 0 },
    { unitId: 'unit', budgetUnits: Number.NaN },
  ]) {
    await assert.rejects(controller.run(options, () => undefined), ApplicationControlContractError);
  }
  await assert.rejects(
    controller.run({ unitId: 'unit', budgetUnits: 1 }, null as never),
    /task must be a function/u,
  );
  const invalidClock = createController({ now: () => new Date(Number.NaN) });
  await assert.rejects(
    invalidClock.run({ unitId: 'unit', budgetUnits: 1 }, () => undefined),
    /now\(\) must return a valid Date/u,
  );
});

function createController(overrides: Record<string, unknown> = {}): ApplicationExecutionController {
  return new ApplicationExecutionController({
    maxBudgetUnits: 10,
    maxConcurrent: 2,
    rateLimit: { maxStarts: 10, intervalMs: 1_000 },
    deadlineAt: new Date(baseTime + 60_000),
    now: () => new Date(baseTime),
    ...overrides,
  });
}

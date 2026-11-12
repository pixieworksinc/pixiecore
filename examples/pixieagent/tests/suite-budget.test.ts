/** Global-budget regressions use numeric usage fixtures only. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSuiteSpendLedger } from '../suite-budget.js';
import { LUNA_PLAN, LUNA_REQUEST_RESERVATION_NANO_USD } from '../luna.js';

const usage = { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 };

test('one global balance can reconcile eighteen sequential small requests without resetting per case', async () => {
  const ledger = createSuiteSpendLedger(30);
  for (let index = 0; index < 18; index++) {
    await ledger.reserve({}, 512);
    assert.ok(ledger.snapshot().reservedNanoUsd <= 1_000_000_000);
    assert.equal(ledger.snapshot().pendingReservationNanoUsd, LUNA_REQUEST_RESERVATION_NANO_USD);
    const entry = ledger.settle(usage);
    assert.equal(entry.request, index + 1);
    assert.equal(entry.usageCeilingNanoUsd, 70_000);
    assert.equal(entry.releasedReservationNanoUsd, LUNA_REQUEST_RESERVATION_NANO_USD - 70_000);
  }
  assert.equal(ledger.snapshot().usageCeilingNanoUsd, 1_260_000);
  assert.equal(ledger.snapshot().pendingReservationNanoUsd, 0);
  assert.equal(ledger.snapshot().settledRequests, 18);
  assert.throws(() => ledger.settle(usage), /No pending/);
});

test('worst-case usage still blocks request five before taking another hold', async () => {
  const ledger = createSuiteSpendLedger(30);
  for (let i = 0; i < 4; i++) {
    await ledger.reserve({}, 512);
    ledger.settle({ prompt_tokens: LUNA_PLAN.maxInputTokens, completion_tokens: 512,
      total_tokens: LUNA_PLAN.maxInputTokens + 512 });
  }
  await assert.rejects(ledger.reserve({}, 512), /budget exhausted/);
  assert.equal(ledger.snapshot().requests, 4);
  assert.equal(ledger.snapshot().reservedNanoUsd, 841_536_000);
  assert.equal(ledger.snapshot().pendingReservationNanoUsd, 0);
});

test('missing, inconsistent or out-of-range usage never releases the pending reservation', async () => {
  for (const invalid of [undefined, null, {}, { ...usage, total_tokens: 239 },
    { ...usage, prompt_tokens: -1 }, { ...usage, prompt_tokens: 0, total_tokens: 40 },
    { ...usage, prompt_tokens: '200' }, { ...usage, prompt_tokens: Number.MAX_SAFE_INTEGER },
    { ...usage, completion_tokens: 513, total_tokens: 713 }, { ...usage, completion_tokens: 1.5 }]) {
    const ledger = createSuiteSpendLedger(30);
    await ledger.reserve({}, 512);
    assert.throws(() => ledger.settle(invalid));
    await assert.rejects(ledger.reserve({}, 512), /unsettled/);
    assert.equal(ledger.snapshot().reservedNanoUsd, LUNA_REQUEST_RESERVATION_NANO_USD);
    assert.equal(ledger.snapshot().usageCeilingNanoUsd, 0);
    assert.deepEqual(ledger.settlements(), []);
  }
});

test('concurrent reservations cannot share a hold and the request cap survives settlement', async () => {
  const ledger = createSuiteSpendLedger(2);
  const outcomes = await Promise.allSettled([ledger.reserve({}, 512), ledger.reserve({}, 512)]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(ledger.snapshot().requests, 1);
  ledger.settle(usage);
  await ledger.reserve({}, 512);
  ledger.settle({ prompt_tokens: 200, completion_tokens: 0, total_tokens: 200 });
  await assert.rejects(ledger.reserve({}, 512), /request cap/);
  assert.equal(ledger.snapshot().requests, 2);
  assert.equal(ledger.snapshot().usageCeilingNanoUsd, 110_000);
});

test('invalid limits, output bounds and pre-aborted calls take no reservation', async () => {
  for (const cap of [0, -1, 81, 1.5, Number.MAX_SAFE_INTEGER]) assert.throws(() => createSuiteSpendLedger(cap));
  const ledger = createSuiteSpendLedger(30);
  for (const output of [0, 513, Number.NaN]) await assert.rejects(ledger.reserve({}, output));
  const reason = new Error('Stopped');
  await assert.rejects(ledger.reserve({}, 512, AbortSignal.abort(reason)), error => error === reason);
  assert.equal(ledger.snapshot().reservedNanoUsd, 0);
  assert.equal(ledger.snapshot().requests, 0);
});

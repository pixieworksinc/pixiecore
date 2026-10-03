import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEvaluationPropertyCorpus,
  EvaluationPropertyCorpusError,
} from '../../src/core/kernel/evaluation/index.js';
import { testData } from '../helpers/test-data.js';

const data = testData('evaluation property corpus contract');

test('property corpus is deterministic within one seed and isolated across seeds', () => {
  const seed = data.text('primary corpus seed', 'seed');
  const first = createEvaluationPropertyCorpus({ seed, casesPerKind: 8 });
  const replay = createEvaluationPropertyCorpus({ seed, casesPerKind: 8 });
  const different = createEvaluationPropertyCorpus({
    seed: data.text('different corpus seed', 'seed'),
    casesPerKind: 8,
  });

  assert.deepEqual(replay, first);
  assert.notDeepEqual(different, first);
  assert.equal(first.cases.length, 48);
  assert.equal(new Set(first.cases.map(item => item.id)).size, 48);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.cases), true);
  assert.equal(first.cases.every(item => Object.isFrozen(item) && Object.isFrozen(item.tags)), true);
});

test('property corpus covers date, amount, locale, Unicode, whitespace, and boundaries', () => {
  const corpus = createEvaluationPropertyCorpus({
    seed: data.text('coverage corpus seed', 'seed'),
    casesPerKind: 8,
  });
  const byKind = new Map<string, typeof corpus.cases[number][]>();
  for (const item of corpus.cases) {
    const cases = byKind.get(item.kind) ?? [];
    cases.push(item);
    byKind.set(item.kind, cases);
  }
  assert.deepEqual([...byKind.keys()].sort(), [
    'amount', 'boundary', 'date', 'locale', 'unicode', 'whitespace',
  ]);
  for (const cases of byKind.values()) assert.equal(cases.length, 8);

  const dates = byKind.get('date')!.map(item => item.value);
  assert.deepEqual(dates.slice(0, 2), ['2000-02-29', '2100-02-28']);
  for (const value of dates) {
    assert.equal(typeof value, 'string');
    assert.match(value as string, /^\d{4}-\d{2}-\d{2}$/u);
    assert.equal(Number.isNaN(Date.parse(`${String(value)}T00:00:00.000Z`)), false);
  }

  const amounts = byKind.get('amount')!.map(item => item.value);
  assert.deepEqual(amounts.slice(0, 2), [0, -0.01]);
  for (const value of amounts) {
    assert.equal(typeof value, 'number');
    assert.equal(Number.isSafeInteger(Math.round(Number(value) * 100)), true);
  }

  for (const item of byKind.get('locale')!) {
    assert.equal(new Intl.Locale(String(item.value)).toString(), item.value);
  }
  assert.equal(byKind.get('unicode')!.every(item => (
    typeof item.value === 'string' && [...item.value].length > 0
  )), true);
  assert.equal(byKind.get('whitespace')!.some(item => item.value === ''), true);
  assert.deepEqual(byKind.get('boundary')!.slice(0, 5).map(item => item.value), [
    Number.MIN_SAFE_INTEGER, -1, 0, 1, Number.MAX_SAFE_INTEGER,
  ]);
});

test('property corpus validates seed and bounded case count', () => {
  for (const options of [
    { seed: ' ' },
    { seed: data.text('zero count seed'), casesPerKind: 0 },
    { seed: data.text('fractional count seed'), casesPerKind: 1.5 },
    { seed: data.text('oversized count seed'), casesPerKind: 1_001 },
  ]) {
    assert.throws(
      () => createEvaluationPropertyCorpus(options),
      EvaluationPropertyCorpusError,
    );
  }
});

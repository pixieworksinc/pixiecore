import assert from 'node:assert/strict';
import test from 'node:test';
import { testData } from '../helpers/test-data.js';

const FIXED_SEED = 'test-data-reproducibility';
const OTHER_SEED = 'test-data-other-seed';

test('seeded test data is reproducible, scope-isolated, and safe for fixture formats', () => {
  const first = testData('fixture scope', FIXED_SEED);
  const same = testData('fixture scope', FIXED_SEED);
  const other = testData('fixture scope', OTHER_SEED);

  assert.equal(first.text('name'), same.text('name'));
  assert.notEqual(first.text('name'), other.text('name'));
  assert.notEqual(first.text('name'), testData('other scope', FIXED_SEED).text('name'));
  assert.match(first.person('name'), /^Person_[0-9a-f]{10}$/);
  assert.match(first.text('fixture', 'plugin value'), /^plugin_value_[0-9a-f]{12}$/);
});

test('seeded test data respects integer, decimal, and UTC-date ranges', () => {
  const data = testData('value ranges', FIXED_SEED);
  const integer = data.integer('integer', 17, 83);
  const decimal = data.decimal('decimal', 1, 9, 2);
  const date = data.date('date', new Date('2024-01-01T00:00:00.000Z'), new Date('2024-12-31T00:00:00.000Z'));

  assert.ok(integer >= 17 && integer <= 83);
  assert.ok(decimal >= 1 && decimal <= 9);
  assert.notEqual(decimal, Math.trunc(decimal));
  assert.ok(date >= new Date('2024-01-01T00:00:00.000Z'));
  assert.ok(date <= new Date('2024-12-31T00:00:00.000Z'));
  assert.match(data.isoDate('date'), /^20\d{2}-\d{2}-\d{2}$/);
});

test('test data rejects blank scopes, seeds, and labels', () => {
  assert.throws(
    () => testData('   ', FIXED_SEED),
    { name: 'TypeError', message: 'scope must be non-blank' },
  );
  assert.throws(
    () => testData('blank seed', '\t'),
    { name: 'TypeError', message: 'seed must be non-blank' },
  );

  const data = testData('blank labels', FIXED_SEED);
  const operations = [
    () => data.text(' '),
    () => data.person('\n'),
    () => data.integer('\t', 0, 1),
    () => data.decimal('  ', 0, 1),
    () => data.date('\r'),
    () => data.isoDate('\n\t'),
  ];
  for (const operation of operations) {
    assert.throws(
      operation,
      { name: 'TypeError', message: 'label must be non-blank' },
    );
  }
});

test('integer data rejects unsafe, fractional, and reversed ranges', () => {
  const data = testData('invalid integer ranges', FIXED_SEED);
  const ranges = [
    [0.5, 2],
    [0, 2.5],
    [Number.NaN, 2],
    [0, Number.POSITIVE_INFINITY],
    [2, 1],
  ] as const;

  for (const [minimum, maximum] of ranges) {
    assert.throws(
      () => data.integer('invalid integer', minimum, maximum),
      {
        name: 'RangeError',
        message: 'integer range must use ascending safe integers',
      },
    );
  }
});

test('integer data rejects ranges wider than its 48-bit source', () => {
  const data = testData('wide integer range', FIXED_SEED);
  assert.throws(
    () => data.integer('too wide', 0, 2 ** 48),
    {
      name: 'RangeError',
      message: 'integer range must contain fewer than 2^48 values',
    },
  );
});

test('decimal data rejects invalid scales, ranges, and integral-only intervals', () => {
  const data = testData('invalid decimal ranges', FIXED_SEED);
  for (const scale of [0, 7, 1.5, Number.NaN]) {
    assert.throws(
      () => data.decimal('invalid scale', 0, 1, scale),
      {
        name: 'RangeError',
        message: 'decimal scale must be an integer from 1 through 6',
      },
    );
  }

  const ranges = [
    [Number.NaN, 1],
    [0, Number.POSITIVE_INFINITY],
    [1, 1],
    [2, 1],
  ] as const;
  for (const [minimum, maximum] of ranges) {
    assert.throws(
      () => data.decimal('invalid range', minimum, maximum),
      {
        name: 'RangeError',
        message: 'decimal range must contain more than one value',
      },
    );
  }

  assert.throws(
    () => data.decimal('integral only', 1, 1.04, 1),
    {
      name: 'RangeError',
      message: 'decimal range must contain a non-integer value at the requested scale',
    },
  );
});

test('date data rejects invalid and reversed timestamp ranges', () => {
  const data = testData('invalid date ranges', FIXED_SEED);
  const valid = new Date('2024-06-01T00:00:00.000Z');
  const invalid = new Date(Number.NaN);
  const ranges = [
    [invalid, valid],
    [valid, invalid],
    [new Date('2024-06-02T00:00:00.000Z'), valid],
  ] as const;

  for (const [start, end] of ranges) {
    assert.throws(
      () => data.date('invalid date', start, end),
      {
        name: 'RangeError',
        message: 'date range must contain valid ascending timestamps',
      },
    );
  }
});

test('the same label is stable while different labels vary', () => {
  const data = testData('label derivation', FIXED_SEED);
  const start = new Date('2024-01-01T00:00:00.000Z');
  const end = new Date('2024-12-31T23:59:59.999Z');

  assert.equal(data.text('stable'), data.text('stable'));
  assert.equal(data.person('stable'), data.person('stable'));
  assert.equal(data.integer('stable', 0, 2 ** 48 - 1), data.integer('stable', 0, 2 ** 48 - 1));
  assert.equal(data.decimal('stable', 0, 100, 6), data.decimal('stable', 0, 100, 6));
  assert.equal(data.date('stable', start, end).getTime(), data.date('stable', start, end).getTime());
  assert.equal(data.isoDate('stable', start, end), data.isoDate('stable', start, end));

  assert.notEqual(data.text('first'), data.text('second'));
  assert.notEqual(data.person('first'), data.person('second'));
  assert.notEqual(data.integer('first', 0, 2 ** 48 - 1), data.integer('second', 0, 2 ** 48 - 1));
  assert.notEqual(data.decimal('first', 0, 100, 6), data.decimal('second', 0, 100, 6));
  assert.notEqual(data.date('first', start, end).getTime(), data.date('second', start, end).getTime());
  assert.notEqual(data.isoDate('first', start, end), data.isoDate('second', start, end));
});

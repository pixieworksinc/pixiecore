import assert from 'node:assert/strict';
import test from 'node:test';
import { compareEvaluationOutput } from '../../src/core/kernel/evaluation/index.js';
import { TRACEABLE_SUMMARY_COMPARATOR_ID } from '../../src/core/kernel/evaluation/traceable-summary.js';
import type { EvaluationCustomComparator } from '../../src/core/kernel/evaluation/index.js';
import { testData } from '../helpers/test-data.js';

const data = testData('evaluation comparators');

test('exact and selected-field comparisons preserve JSON semantics', async () => {
  const stable = data.text('stable value');
  const actual = { stable, ignored: data.text('ignored actual'), nested: { 'a/b': { '~key': 7 } } };
  const expected = { stable, ignored: data.text('ignored expected'), nested: { 'a/b': { '~key': 7 } } };
  assert.equal((await compareEvaluationOutput(actual, actual, { mode: 'exact' })).passed, true);
  const exact = await compareEvaluationOutput(actual, expected, { mode: 'exact' });
  assert.equal(exact.passed, false);
  assert.equal(exact.differences[0]?.pointer, '');
  assert.deepEqual(await compareEvaluationOutput(actual, expected, {
    mode: 'fields', pointers: ['/stable', '/nested/a~1b/~0key'],
  }), { passed: true, differences: [] });
});

test('field comparison distinguishes missing actual and expected values', async () => {
  const result = await compareEvaluationOutput(
    { actual_only: true },
    { expected_only: true },
    { mode: 'fields', pointers: ['/expected_only', '/actual_only'] },
  );
  assert.deepEqual(result.differences.map(item => item.reason), ['missing_actual', 'missing_expected']);
});

test('set comparison ignores order and duplicates while retaining deep equality', async () => {
  const first = { id: data.text('first set ID') };
  const second = { id: data.text('second set ID') };
  assert.equal((await compareEvaluationOutput(
    { items: [first, second, first] }, { items: [second, first] },
    { mode: 'set', pointer: '/items' },
  )).passed, true);
  const wrongType = await compareEvaluationOutput(
    { items: data.text('not array') }, { items: [first] },
    { mode: 'set', pointer: '/items' },
  );
  assert.equal(wrongType.differences[0]?.reason, 'not_array');
});

test('numeric tolerance uses the larger absolute or relative permitted difference', async () => {
  assert.equal((await compareEvaluationOutput(
    { amount: 100.09, near_zero: 0.009 }, { amount: 100, near_zero: 0 },
    { mode: 'numeric_tolerance', pointers: ['/amount', '/near_zero'], absolute_tolerance: 0.01, relative_tolerance: 0.001 },
  )).passed, true);
  const failing = await compareEvaluationOutput(
    { amount: 100.11 }, { amount: 100 },
    { mode: 'numeric_tolerance', pointers: ['/amount'], absolute_tolerance: 0.01, relative_tolerance: 0.001 },
  );
  assert.equal(failing.differences[0]?.reason, 'outside_tolerance');
  const wrongType = await compareEvaluationOutput(
    { amount: '100' }, { amount: 100 },
    { mode: 'numeric_tolerance', pointers: ['/amount'], absolute_tolerance: 0 },
  );
  assert.equal(wrongType.differences[0]?.reason, 'not_number');
});

test('schema comparison validates actual and expected independently', async () => {
  const schema = { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false };
  assert.equal((await compareEvaluationOutput(
    { value: 17 }, { value: 83 }, { mode: 'schema' }, { outputSchema: schema },
  )).passed, true);
  const invalid = await compareEvaluationOutput(
    { value: '17' }, { missing: true }, { mode: 'schema' }, { outputSchema: schema },
  );
  assert.ok(invalid.differences.some(item => item.detail?.startsWith('actual:')));
  assert.ok(invalid.differences.some(item => item.detail?.startsWith('expected:')));
});

test('custom comparison is explicit, asynchronous, isolated, and consistent', async () => {
  const actual = { value: data.text('custom actual') };
  const expected = { value: data.text('custom expected') };
  const config = { accept: true };
  const comparator: EvaluationCustomComparator = async context => {
    (context.actual as { value: string }).value = 'mutated';
    (context.config as { accept: boolean }).accept = false;
    return { passed: true, differences: [] } as const;
  };
  const customComparators = new Map([['example.accept-v1', comparator]]);
  assert.equal((await compareEvaluationOutput(
    actual, expected, { mode: 'custom', comparator: 'example.accept-v1', config }, { customComparators },
  )).passed, true);
  assert.notEqual(actual.value, 'mutated');
  assert.equal(config.accept, true);
  await assert.rejects(compareEvaluationOutput(
    actual, expected, { mode: 'custom', comparator: 'example.missing-v1' },
  ), /Unknown evaluation comparator/);
});

test('built-in traceable-summary comparison accepts alternative prose with the same typed facts', async () => {
  const inputs = {
    request: {
      purpose: 'Customer contract renewal meetings',
      start_date: '2026-09-14',
      end_date: '2026-09-18',
      destinations: ['San Francisco, US', 'Los Angeles, US'],
      total_cost: { amount: 2840.5, currency: 'USD' },
      approval_notes: ['Hotel cap exception requires review'],
    },
    max_characters: 240,
  };
  const summary = 'Customer contract renewal meetings are in San Francisco, US and Los Angeles, US from 2026-09-14 through 2026-09-18. Projected cost: USD 2840.50. Hotel cap exception requires review.';
  const actual = {
    status: 'summarized',
    summary,
    character_count: [...summary].length,
    claims: [
      {
        text: 'Customer contract renewal meetings are in San Francisco, US and Los Angeles, US from 2026-09-14 through 2026-09-18.',
        source_fields: [
          'request.purpose',
          'request.start_date',
          'request.end_date',
          'request.destinations',
        ],
      },
      {
        text: 'Projected cost: USD 2840.50.',
        source_fields: ['request.total_cost.amount', 'request.total_cost.currency'],
      },
      {
        text: 'Hotel cap exception requires review.',
        source_fields: ['request.approval_notes'],
      },
    ],
    omitted_source_fields: [],
    missing_source_fields: [],
  };
  const comparison = await compareEvaluationOutput(
    actual,
    { ...actual, summary: data.text('different expected prose') },
    {
      mode: 'custom',
      comparator: TRACEABLE_SUMMARY_COMPARATOR_ID,
      config: traceableSummaryConfig(),
    },
    { inputs },
  );
  assert.deepEqual(comparison, { passed: true, differences: [] });
});

test('built-in traceable-summary comparison rejects incorrect counts, partitions, and priority', async () => {
  const inputs = {
    request: {
      purpose: 'Planning workshop',
      start_date: '2026-09-14',
      end_date: '2026-09-18',
      destinations: ['Tokyo'],
      total_cost: { amount: 200, currency: 'USD' },
      approval_notes: [],
    },
    max_characters: 240,
  };
  const summary = 'Planning workshop in Tokyo from 2026-09-14 to 2026-09-18. Cost: USD 200.';
  const result = await compareEvaluationOutput(
    {
      status: 'summarized',
      summary,
      character_count: 1,
      claims: [{
        text: 'Cost: USD 200.',
        source_fields: ['request.total_cost.amount', 'request.total_cost.currency'],
      }],
      omitted_source_fields: ['request.purpose'],
      missing_source_fields: [
        'request.start_date',
        'request.end_date',
        'request.destinations',
        'request.approval_notes',
      ],
    },
    {},
    {
      mode: 'custom',
      comparator: TRACEABLE_SUMMARY_COMPARATOR_ID,
      config: traceableSummaryConfig(),
    },
    { inputs },
  );
  assert.equal(result.passed, false);
  assert.ok(result.differences.some(item => item.pointer === '/character_count'));
  assert.ok(result.differences.some(item => item.pointer === '/missing_source_fields'));
  assert.ok(result.differences.some(item => item.pointer === '/omitted_source_fields'));
});

test('direct comparator calls reject malformed policies before comparison', async () => {
  const value = { result: data.text('malformed policy') };
  const operations = [
    () => compareEvaluationOutput(value, value, { mode: 'fields', pointers: [] }),
    () => compareEvaluationOutput(value, value, { mode: 'fields', pointers: ['invalid'] }),
    () => compareEvaluationOutput(value, value, { mode: 'numeric_tolerance', pointers: ['/result'] }),
    () => compareEvaluationOutput(value, value, { mode: 'numeric_tolerance', pointers: ['/result'], absolute_tolerance: Number.NaN }),
    () => compareEvaluationOutput(value, value, { mode: 'schema' }),
  ];
  for (const operation of operations) await assert.rejects(operation, TypeError);
});

function traceableSummaryConfig() {
  return {
    source_fields: [
      'request.purpose',
      'request.start_date',
      'request.end_date',
      'request.destinations',
      'request.total_cost.amount',
      'request.total_cost.currency',
      'request.approval_notes',
    ],
    priority: [
      'request.purpose',
      'request.start_date',
      'request.end_date',
      'request.destinations',
      'request.total_cost.amount',
      'request.total_cost.currency',
      'request.approval_notes',
    ],
  };
}

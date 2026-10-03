import assert from 'node:assert/strict';
import test from 'node:test';
import { JitProgramError } from '../../../../core/contracts/errors/index.js';
import {
  JIT_EXPRESSION_KINDS,
  runJitProgram,
  validateJitProgram,
} from '../../jit.js';

test('closed JIT vocabulary evaluates deterministic arithmetic, branching, lookup, and composition', () => {
  const program = validateJitProgram({
    outputs: {
      total: {
        kind: 'round',
        mode: 'ceil',
        digits: 2,
        of: {
          kind: 'arithmetic',
          op: 'multiply',
          left: { kind: 'input', name: 'amount' },
          right: { kind: 'const', value: 1.25 },
        },
      },
      band: {
        kind: 'choose',
        when: {
          kind: 'compare',
          op: 'gte',
          left: { kind: 'input', name: 'amount' },
          right: { kind: 'const', value: 10 },
        },
        then: { kind: 'const', value: 'high' },
        otherwise: { kind: 'const', value: 'low' },
      },
      city: {
        kind: 'lookup',
        table: { NYC: 'A', Tokyo: 'C' },
        key: { kind: 'input', name: 'city' },
        fallback: 'B',
      },
      label: {
        kind: 'concat',
        parts: [
          { kind: 'const', value: 'ID:' },
          { kind: 'toText', of: { kind: 'input', name: 'id' } },
        ],
      },
      flags: {
        kind: 'compact',
        parts: [
          { kind: 'const', value: 'present' },
          { kind: 'input', name: 'missing' },
        ],
      },
      nested: {
        kind: 'field',
        of: { kind: 'input', name: 'record' },
        name: 'value',
      },
    },
  });

  assert.deepEqual({ ...runJitProgram(program, {
    amount: 10.001,
    city: 'NYC',
    id: 42,
    record: { value: true },
  }) }, {
    total: 12.51,
    band: 'high',
    city: 'A',
    label: 'ID:42',
    flags: ['present'],
    nested: true,
  });
  assert.equal(Object.isFrozen(program), true);
  assert.equal(Object.isFrozen(program.outputs), true);
  assert.deepEqual(JIT_EXPRESSION_KINDS, [
    'input', 'const', 'field', 'arithmetic', 'round', 'compare',
    'choose', 'lookup', 'concat', 'compact', 'toNumber', 'toText',
  ]);
});

test('JIT arithmetic has total finite behavior and text-date comparisons', () => {
  const program = validateJitProgram({
    outputs: {
      divide: {
        kind: 'arithmetic',
        op: 'divide',
        left: { kind: 'input', name: 'left' },
        right: { kind: 'input', name: 'right' },
      },
      date_order: {
        kind: 'compare',
        op: 'lt',
        left: { kind: 'input', name: 'start' },
        right: { kind: 'input', name: 'end' },
      },
      number: { kind: 'toNumber', of: { kind: 'input', name: 'number' } },
    },
  });

  assert.deepEqual({ ...runJitProgram(program, {
    left: 10,
    right: 0,
    start: '2026-01-01',
    end: '2026-02-01',
    number: '12.5',
  }) }, { divide: null, date_order: true, number: 12.5 });
});

test('JIT interpreter covers every total fallback and comparison branch', () => {
  const program = validateJitProgram({
    outputs: {
      missing_field: { kind: 'field', of: { kind: 'input', name: 'record' }, name: 'missing' },
      null_field: { kind: 'field', of: { kind: 'input', name: 'record' }, name: 'empty' },
      scalar_field: { kind: 'field', of: { kind: 'input', name: 'scalar' }, name: 'value' },
      add: { kind: 'arithmetic', op: 'add', left: { kind: 'const', value: 3 }, right: { kind: 'const', value: 2 } },
      subtract: { kind: 'arithmetic', op: 'subtract', left: { kind: 'const', value: 3 }, right: { kind: 'const', value: 2 } },
      divide: { kind: 'arithmetic', op: 'divide', left: { kind: 'const', value: 6 }, right: { kind: 'const', value: 2 } },
      invalid_math: { kind: 'arithmetic', op: 'add', left: { kind: 'const', value: true }, right: { kind: 'const', value: 2 } },
      overflow: { kind: 'arithmetic', op: 'multiply', left: { kind: 'const', value: Number.MAX_VALUE }, right: { kind: 'const', value: 2 } },
      floor: { kind: 'round', mode: 'floor', of: { kind: 'const', value: 1.9 } },
      nearest: { kind: 'round', mode: 'nearest', digits: 1, of: { kind: 'const', value: 1.26 } },
      invalid_round: { kind: 'round', mode: 'ceil', of: { kind: 'const', value: true } },
      equal: { kind: 'compare', op: 'eq', left: { kind: 'const', value: [1] }, right: { kind: 'const', value: [1] } },
      unequal: { kind: 'compare', op: 'neq', left: { kind: 'const', value: 1 }, right: { kind: 'const', value: 2 } },
      less_equal: { kind: 'compare', op: 'lte', left: { kind: 'const', value: 2 }, right: { kind: 'const', value: 2 } },
      greater: { kind: 'compare', op: 'gt', left: { kind: 'const', value: 3 }, right: { kind: 'const', value: 2 } },
      incomparable: { kind: 'compare', op: 'gt', left: { kind: 'const', value: true }, right: { kind: 'const', value: false } },
      other_branch: { kind: 'choose', when: { kind: 'const', value: false }, then: { kind: 'const', value: 'then' }, otherwise: { kind: 'const', value: 'otherwise' } },
      lookup_number: { kind: 'lookup', table: { '2': 'two' }, key: { kind: 'const', value: 2 } },
      lookup_fallback: { kind: 'lookup', table: {}, key: { kind: 'const', value: [] }, fallback: 'fallback' },
      lookup_null: { kind: 'lookup', table: {}, key: { kind: 'const', value: 'absent' } },
      text_values: { kind: 'concat', parts: [{ kind: 'const', value: null }, { kind: 'const', value: true }, { kind: 'const', value: { ok: true } }] },
      blank_number: { kind: 'toNumber', of: { kind: 'const', value: ' ' } },
      invalid_number: { kind: 'toNumber', of: { kind: 'const', value: 'not-a-number' } },
      object_text: { kind: 'toText', of: { kind: 'const', value: { ok: true } } },
    },
  });

  assert.deepEqual({ ...runJitProgram(program, {
    record: { empty: null },
    scalar: 1,
  }) }, {
    missing_field: null,
    null_field: null,
    scalar_field: null,
    add: 5,
    subtract: 1,
    divide: 3,
    invalid_math: null,
    overflow: null,
    floor: 1,
    nearest: 1.3,
    invalid_round: null,
    equal: true,
    unequal: true,
    less_equal: true,
    greater: true,
    incomparable: false,
    other_branch: 'otherwise',
    lookup_number: 'two',
    lookup_fallback: 'fallback',
    lookup_null: null,
    text_values: 'true{"ok":true}',
    blank_number: null,
    invalid_number: null,
    object_text: '{"ok":true}',
  });
});

test('JIT validation rejects unknown, ignored, executable, dangerous, and excessive structures', () => {
  const invalid: unknown[] = [
    { outputs: {} },
    { outputs: { value: { kind: 'eval', source: 'process.exit()' } } },
    { outputs: { value: { kind: 'const', value: 1, ignored: true } } },
    { outputs: { value: { kind: 'const', value: Number.NaN } } },
    { outputs: { value: { kind: 'round', mode: 'nearest', digits: 13, of: { kind: 'const', value: 1 } } } },
    { outputs: { value: { kind: 'concat', parts: new Array(129).fill({ kind: 'const', value: '' }) } } },
  ];
  const dangerous = JSON.parse('{"outputs":{"__proto__":{"kind":"const","value":1}}}') as unknown;
  invalid.push(dangerous);

  for (const candidate of invalid) {
    assert.throws(() => validateJitProgram(candidate), JitProgramError);
  }

  const deep = { kind: 'toText', of: { kind: 'toText', of: { kind: 'const', value: 1 } } };
  assert.throws(
    () => validateJitProgram({ outputs: { value: deep } }, { maxDepth: 1 }),
    /depth limit/u,
  );
  assert.throws(
    () => validateJitProgram({ outputs: { value: deep } }, { maxNodes: 2 }),
    /operation limit/u,
  );
  assert.throws(() => validateJitProgram({ outputs: { value: { kind: 'const', value: 1 } } }, { maxNodes: 0 }), /maxNodes/u);
});

test('JIT execution clones JSON inputs and converts unsupported runtime values to null', () => {
  const program = validateJitProgram({
    outputs: {
      safe: { kind: 'input', name: 'safe' },
      unsupported: { kind: 'input', name: 'unsupported' },
    },
  });
  const safe = { nested: ['value'] };
  const output = runJitProgram(program, { safe, unsupported: new Date() });
  safe.nested[0] = 'changed';

  assert.deepEqual(output.safe, { nested: ['value'] });
  assert.equal(output.unsupported, null);
  assert.equal(Object.isFrozen(output), true);
});

test('JIT validation rejects every structural and configured-limit boundary', () => {
  const sparse = new Array(1);
  const symbolValue = { outputs: { value: { kind: 'const', value: 1 } } };
  Object.defineProperty(symbolValue, Symbol('hidden'), { value: true });
  const dangerousTable = JSON.parse('{"outputs":{"value":{"kind":"lookup","table":{"constructor":1},"key":{"kind":"const","value":"x"}}}}');

  const cases: Array<{ value: unknown; limits?: Parameters<typeof validateJitProgram>[1] }> = [
    { value: null },
    { value: [] },
    { value: new (class Program {})() },
    { value: symbolValue },
    { value: {} },
    { value: { outputs: { first: { kind: 'const', value: 1 }, second: { kind: 'const', value: 2 } } }, limits: { maxOutputs: 1 } },
    { value: { outputs: { value: { kind: 'input', name: ' ' } } } },
    { value: { outputs: { value: { kind: 'arithmetic', op: 'mod', left: { kind: 'const', value: 1 }, right: { kind: 'const', value: 1 } } } } },
    { value: { outputs: { value: { kind: 'round', mode: 'nearest', digits: 1.5, of: { kind: 'const', value: 1 } } } } },
    { value: { outputs: { value: { kind: 'lookup', table: { a: 1, b: 2 }, key: { kind: 'const', value: 'a' } } } }, limits: { maxCollectionItems: 1 } },
    { value: dangerousTable },
    { value: { outputs: { value: { kind: 'concat', parts: 'not-an-array' } } } },
    { value: { outputs: { value: { kind: 'compact', parts: sparse } } } },
    { value: { outputs: { value: { kind: 'const' } } } },
    { value: { outputs: { value: { kind: 'const', value: 1 } } }, limits: { maxDepth: 1.5 } },
    { value: { outputs: { value: { kind: 'const', value: 1 } } }, limits: { maxNodes: 10_001 } },
  ];

  for (const item of cases) {
    assert.throws(() => validateJitProgram(item.value, item.limits), JitProgramError);
  }
});

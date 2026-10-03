import test from 'node:test';
import assert from 'node:assert/strict';
import { BlueprintValidationError, InputTypeError, InputValidationError, InputValidator } from '../../../../index.js';
import { testData } from '../../../../../tests/helpers/test-data.js';

const data = testData('input contract');

test('input contract coerces numeric strings and applies optional defaults', () => {
  const name = data.person('coerced name');
  const age = data.integer('coerced age', 18, 99);
  const price = data.decimal('coerced price', 1, 99, 2);
  const validator = new InputValidator([
    { name: 'name', type: 'string', required: true },
    { name: 'age', type: 'integer', required: true },
    { name: 'price', type: 'float', required: true },
    { name: 'active', type: 'boolean', required: false, default: true },
    { name: 'note', type: 'string', required: false },
  ]);
  assert.deepEqual(validator.validate({ name, age: String(age), price: String(price) }), {
    name, age, price, active: true, note: null,
  });
});

test('input contract supports arrays, objects, and numbers', () => {
  const item = data.integer('array item', 1, 100);
  const score = data.decimal('number score', 1, 10, 2);
  const validator = new InputValidator([
    { name: 'items', type: 'array', required: true },
    { name: 'settings', type: 'object', required: true },
    { name: 'score', type: 'number', required: true },
  ]);
  assert.deepEqual(validator.validate({ items: [item], settings: { safe: true }, score }), { items: [item], settings: { safe: true }, score });
});

test('input contract aggregates missing inputs and separates wrong-type errors', () => {
  const name = data.person('wrong type name');
  const validator = new InputValidator([{ name: 'name', type: 'string', required: true }, { name: 'age', type: 'integer', required: true }]);
  assert.throws(() => validator.validate({}), error => error instanceof InputValidationError && error.message.includes('name') && error.message.includes('age'));
  assert.throws(() => validator.validate({ name, age: 'old' }), error => error instanceof InputTypeError && error.code === 'input_type_error');
});

test('input contract enforces strict mode, ignores extras in non-strict mode', () => {
  const name = data.person('strict name');
  const placeholders = [{ name: 'name', type: 'string' as const, required: true }];
  assert.throws(() => new InputValidator(placeholders, true).validate({ name, extra: true }), InputValidationError);
  assert.deepEqual(new InputValidator(placeholders, false).validate({ name, extra: true }), { name });
});

test('input contract bypasses validation when no placeholders are declared', () => {
  const input = { arbitrary: 'value', nested: { okay: true } };
  assert.deepEqual(new InputValidator([], true).validate(input), input);
});

test('InputValidator rejects malformed placeholder values with a Blueprint error', () => {
  assert.throws(() => new InputValidator([null] as never), BlueprintValidationError);
  assert.throws(() => new InputValidator([{ name: 'x', type: 'unknown' }] as never), /Unknown type/);
});

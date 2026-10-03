import test from 'node:test';
import assert from 'node:assert/strict';
import { BlueprintValidator, InputValidator, InputValidationError, BlueprintValidationError } from '../../../../index.js';

const minimal = { name: 'Hello', version: '1.0', role: 'assistant', prompt: 'Hello {name}', output_schema: '{"type":"object"}' };
test('validates a minimal blueprint', () => assert.equal(new BlueprintValidator().validateDict(minimal).name, 'Hello'));
test('rejects missing blueprint fields and malformed schemas', () => {
  assert.throws(() => new BlueprintValidator().validateDict({ ...minimal, prompt: undefined }), BlueprintValidationError);
  assert.throws(() => new BlueprintValidator().validateDict({ ...minimal, output_schema: '{' }), BlueprintValidationError);
});
test('validates, coerces, defaults, and rejects unknown inputs', () => {
  const validator = new InputValidator([{ name: 'age', type: 'integer', required: true }, { name: 'active', type: 'boolean', default: true }]);
  assert.deepEqual(validator.validate({ age: '25' }), { age: 25, active: true });
  assert.throws(() => validator.validate({ age: '25', extra: 1 }), InputValidationError);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BlueprintValidationError,
  PixieCoreError,
} from '../../src/index.js';

test('PixieCoreError is the canonical base error', () => {

  const cause = new Error('source failure');
  const base = new PixieCoreError('failure', 'test_error', { cause });
  assert.equal(base.name, 'PixieCoreError');
  assert.equal(base.code, 'test_error');
  assert.equal(base.cause, cause);

  const derived = new BlueprintValidationError('invalid Blueprint');
  assert.ok(derived instanceof PixieCoreError);
  assert.equal(derived.name, 'BlueprintValidationError');
  assert.equal(derived.code, 'blueprint_validation_error');
});

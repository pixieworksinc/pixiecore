import test from 'node:test';
import assert from 'node:assert/strict';
import { InputValidationError } from '../../../../index.js';
import { createValidationService } from '../../src/service.js';
import { testData } from '../../../../../tests/helpers/test-data.js';

const data = testData('input schema contract');

test('input schema contract accepts object and JSON-string schemas without mutation', () => {
  const name = data.person('valid name');
  const input = { name, score: data.integer('valid score', 1, 100) };
  const schemas = [
    {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        score: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['name', 'score'],
      additionalProperties: false,
    },
    JSON.stringify({
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        score: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['name', 'score'],
      additionalProperties: false,
    }),
  ];

  for (const schema of schemas) {
    const result = createValidationService().createInputSchemaValidator(schema).validate(input);
    assert.deepEqual(result, input);
    assert.notEqual(result, input);
  }
});

test('input schema contract reports every violation as an input validation error', () => {
  const validator = createValidationService().createInputSchemaValidator({
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 3 },
      score: { type: 'integer', minimum: 1 },
    },
    required: ['name', 'score'],
    additionalProperties: false,
  });

  assert.throws(
    () => validator.validate({ name: '', extra: true }),
    error => error instanceof InputValidationError
      && error.code === 'input_validation_error'
      && error.message.startsWith('Input does not match schema:')
      && error.message.includes('/name')
      && error.message.includes('score')
      && error.message.includes('additional properties'),
  );
});

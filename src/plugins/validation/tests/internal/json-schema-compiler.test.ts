import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JsonSchemaCompiler,
} from '../../src/schema/json-schema.js';
import {
  createValidationService,
  validationSchemaCompilerSnapshot,
} from '../../src/service.js';

test('schema compiler is bounded and evicts the least recently used validator', () => {
  const compiler = new JsonSchemaCompiler(2);
  const first = schemaFor('first');
  const second = schemaFor('second');
  const third = schemaFor('third');
  const firstValidator = compiler.compile(first);
  assert.equal(compiler.compile(first), firstValidator);
  compiler.compile(second);
  compiler.compile(third);
  compiler.compile(first);
  assert.deepEqual(compiler.snapshot(), {
    capacity: 2,
    entries: 2,
    hits: 1,
    misses: 4,
    evictions: 2,
  });
});

test('validation service reuses Blueprint, input, and output schema compilation', () => {
  const service = createValidationService();
  const outputSchema = schemaFor('result');
  const inputSchema = schemaFor('source');
  const blueprint = {
    name: 'Cache fixture',
    version: '1.0.0',
    role: 'assistant',
    prompt: 'Return the source.',
    input_schema: inputSchema,
    output_schema: outputSchema,
  };

  service.createBlueprintValidator({ warn: () => undefined }).validateDict(blueprint);
  service.createInputSchemaValidator(inputSchema);
  service.createOutputValidator(outputSchema);
  service.createBlueprintValidator({ warn: () => undefined }).validateDict(blueprint);

  assert.deepEqual(validationSchemaCompilerSnapshot(service), {
    capacity: 64,
    entries: 2,
    hits: 4,
    misses: 2,
    evictions: 0,
  });
});

test('failed schema compilation is not retained', () => {
  const compiler = new JsonSchemaCompiler();
  const invalid = { type: 'not-a-json-schema-type' };
  assert.throws(() => compiler.compile(invalid), /type/u);
  assert.throws(() => compiler.compile(invalid), /type/u);
  assert.deepEqual(compiler.snapshot(), {
    capacity: 64,
    entries: 0,
    hits: 0,
    misses: 2,
    evictions: 0,
  });
});

test('schema compiler capacity rejects unsafe values', () => {
  for (const capacity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new JsonSchemaCompiler(capacity), RangeError);
  }
});

function schemaFor(property: string): Record<string, unknown> {
  return {
    type: 'object',
    properties: { [property]: { type: 'string' } },
    required: [property],
    additionalProperties: false,
  };
}

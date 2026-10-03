import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { testData } from '../helpers/test-data.js';

const schemaPath = fileURLToPath(new URL(
  '../../schemas/pixiecore.blueprint-eval-dataset-v1.schema.json',
  import.meta.url,
));
const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function dataset(comparison: Record<string, unknown>) {
  const data = testData('evaluation dataset schema');
  return {
    schema: 'pixiecore.blueprint-eval-dataset/v1',
    name: data.text('dataset name', 'Dataset'),
    version: '1.0.0',
    description: data.text('dataset description', 'Description'),
    blueprint: {
      path: `../blueprints/${data.text('blueprint path', 'converter')}.yaml`,
      version: '1.0',
    },
    tags: ['converter', data.text('dataset tag', 'tag')],
    cases: [{
      id: data.text('case id', 'case'),
      description: data.text('case description', 'Case'),
      tags: ['ordinary', data.text('case tag', 'tag')],
      inputs: { source: data.text('input value', 'input') },
      expected_output: { result: data.text('expected value', 'output') },
      comparison,
    }],
  };
}

test('published evaluation dataset schema accepts every declared comparison policy', () => {
  const policies = [
    { mode: 'exact' },
    { mode: 'schema' },
    { mode: 'fields', pointers: ['/result', '/nested/value'] },
    { mode: 'set', pointer: '/items' },
    {
      mode: 'numeric_tolerance',
      pointers: ['/amount'],
      absolute_tolerance: 0.01,
    },
    {
      mode: 'numeric_tolerance',
      pointers: ['/amount'],
      relative_tolerance: 0.001,
    },
    {
      mode: 'numeric_tolerance',
      pointers: ['/amount'],
      absolute_tolerance: 0,
      relative_tolerance: 0,
    },
    {
      mode: 'custom',
      comparator: 'acme.travel-policy-v1',
      config: { require_evidence: true },
    },
  ];

  for (const policy of policies) {
    const candidate = dataset(policy);
    assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
  }
});

test('published evaluation dataset schema rejects malformed contracts and policies', () => {
  const base = dataset({ mode: 'exact' });
  const invalid = [
    { ...base, schema: 'pixiecore.blueprint-eval-dataset/v2' },
    { ...base, name: '   ' },
    { ...base, version: '1.0' },
    { ...base, tags: [] },
    { ...base, tags: ['duplicate', 'duplicate'] },
    { ...base, blueprint: { path: '   ' } },
    { ...base, cases: [] },
    { ...base, unexpected: true },
    dataset({ mode: 'fields', pointers: [] }),
    dataset({ mode: 'fields', pointers: ['not-a-json-pointer'] }),
    dataset({ mode: 'set' }),
    dataset({ mode: 'numeric_tolerance', pointers: ['/amount'] }),
    dataset({ mode: 'numeric_tolerance', pointers: ['/amount'], absolute_tolerance: -1 }),
    dataset({ mode: 'custom', comparator: 'Invalid Comparator' }),
    dataset({ mode: 'unknown' }),
  ];

  for (const candidate of invalid) {
    assert.equal(validate(candidate), false, JSON.stringify(candidate));
  }
});

test('evaluation case inputs and expected outputs remain JSON objects', () => {
  const base = dataset({ mode: 'exact' });
  const firstCase = base.cases[0]!;
  for (const invalidValue of [null, 'value', 17, true, []]) {
    assert.equal(validate({
      ...base,
      cases: [{ ...firstCase, inputs: invalidValue }],
    }), false);
    assert.equal(validate({
      ...base,
      cases: [{ ...firstCase, expected_output: invalidValue }],
    }), false);
  }
});

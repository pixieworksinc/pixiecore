import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createEvaluationPropertyCorpus } from '../../src/core/kernel/evaluation/index.js';
import { testData } from '../helpers/test-data.js';

const data = testData('evaluation property corpus schema');
const schema = JSON.parse(await readFile(fileURLToPath(new URL(
  '../../schemas/pixiecore.evaluation-property-corpus-v1.schema.json',
  import.meta.url,
)), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

test('published property-corpus schema accepts generated artifacts', () => {
  const corpus = createEvaluationPropertyCorpus({
    seed: data.text('schema corpus seed'),
    casesPerKind: data.integer('schema case count', 1, 12),
  });
  assert.equal(validate(corpus), true, JSON.stringify(validate.errors));
});

test('published property-corpus schema rejects drift and malformed cases', () => {
  const corpus = createEvaluationPropertyCorpus({
    seed: data.text('invalid schema corpus seed'),
    casesPerKind: 2,
  });
  const invalid = [
    { ...corpus, schema: 'pixiecore.evaluation-property-corpus/v2' },
    { ...corpus, seed: '' },
    { ...corpus, cases_per_kind: 0 },
    { ...corpus, unexpected: true },
    { ...corpus, cases: [{ ...corpus.cases[0], kind: 'unknown' }] },
    { ...corpus, cases: [{ ...corpus.cases[0], tags: [] }] },
  ];
  for (const candidate of invalid) assert.equal(validate(candidate), false);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ApplicationPartialResult } from '@pixieworks/pixiecore/application';
import { testData } from '../helpers/test-data.js';

const data = testData('application partial result schema');
const schema = JSON.parse(await readFile(fileURLToPath(new URL(
  '../../schemas/pixiecore.application-partial-result-v1.schema.json',
  import.meta.url,
)), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

test('published partial-result schema accepts succeeded and partial artifacts', () => {
  const succeeded: ApplicationPartialResult = {
    schema: 'pixiecore.application-partial-result/v1',
    result: 'succeeded',
    outputs: { value: data.text('successful output') },
    failures: [],
  };
  const partial: ApplicationPartialResult = {
    ...succeeded,
    result: 'partial',
    failures: [{
      node_id: data.text('failed node'),
      blueprint_version: '1.2.3',
      error_code: data.text('error code'),
      attempts: data.integer('attempts', 1, 5),
      retry_owner: 'application',
    }],
  };
  assert.equal(validate(succeeded), true, JSON.stringify(validate.errors));
  assert.equal(validate(partial), true, JSON.stringify(validate.errors));
});

test('published partial-result schema rejects contradictory and value-bearing failures', () => {
  const failure = {
    node_id: data.text('failed node'),
    blueprint_version: '1.2.3',
    error_code: data.text('error code'),
    attempts: 1,
    retry_owner: 'runtime',
  };
  const invalid = [
    { schema: 'pixiecore.application-partial-result/v2', result: 'partial', outputs: {}, failures: [failure] },
    { schema: 'pixiecore.application-partial-result/v1', result: 'succeeded', outputs: {}, failures: [failure] },
    { schema: 'pixiecore.application-partial-result/v1', result: 'partial', outputs: {}, failures: [] },
    { schema: 'pixiecore.application-partial-result/v1', result: 'partial', outputs: {}, failures: [{ ...failure, attempts: 0 }] },
    { schema: 'pixiecore.application-partial-result/v1', result: 'partial', outputs: {}, failures: [{ ...failure, message: data.text('forbidden message') }] },
  ];
  for (const candidate of invalid) assert.equal(validate(candidate), false);
});

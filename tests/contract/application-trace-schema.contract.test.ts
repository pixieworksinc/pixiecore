import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ApplicationTrace } from '@pixieworks/pixiecore/application';
import { testData } from '../helpers/test-data.js';

const data = testData('application trace schema');
const schema = JSON.parse(await readFile(fileURLToPath(new URL(
  '../../schemas/pixiecore.application-trace-v1.schema.json',
  import.meta.url,
)), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

test('published application trace schema accepts the public trace contract', () => {
  const artifact = fixtureTrace();
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors));
});

test('published application trace schema rejects unversioned, negative, and extended records', () => {
  const artifact = fixtureTrace();
  const invalid = [
    { ...artifact, schema: 'pixiecore.application-trace/v2' },
    { ...artifact, duration_ms: -1 },
    { ...artifact, unexpected: true },
    { ...artifact, nodes: [{ ...artifact.nodes[0], node_id: '' }] },
    { ...artifact, nodes: [{ ...artifact.nodes[0], provider_usage: [{
      ...artifact.nodes[0]!.provider_usage[0], calls: -1,
    }] }] },
  ];
  for (const candidate of invalid) assert.equal(validate(candidate), false);
});

function fixtureTrace(): ApplicationTrace {
  return {
    schema: 'pixiecore.application-trace/v1',
    trace_id: data.text('trace ID', 'trace'),
    started_at: data.date('trace start').toISOString(),
    duration_ms: data.decimal('trace duration', 0, 1000, 3),
    result: 'succeeded',
    nodes: [{
      node_id: data.text('node ID', 'node'),
      blueprint_version: '1.2.3',
      started_at: data.date('node start').toISOString(),
      duration_ms: data.decimal('node duration', 0, 1000, 3),
      result: 'succeeded',
      provider_usage: [{
        provider: data.text('provider', 'provider'),
        model: data.text('model', 'model'),
        calls: data.integer('calls', 1, 8),
        input_tokens: data.integer('input tokens', 1, 1000),
        output_tokens: data.integer('output tokens', 1, 1000),
        total_tokens: data.integer('total tokens', 1001, 2000),
      }],
    }],
  };
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createRagChunkMetadata } from '../../src/core/kernel/rag/index.js';
import { testData } from '../helpers/test-data.js';

const data = testData('RAG chunk metadata schema');
const schema = JSON.parse(await readFile(fileURLToPath(new URL(
  '../../schemas/pixiecore.rag-chunk-metadata-v1.schema.json', import.meta.url,
)), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function metadata() {
  return createRagChunkMetadata({
    namespace: data.text('schema namespace', 'knowledge'),
    chunkType: data.text('schema chunk type', 'paragraph'),
    field: data.text('schema field', 'body'),
    version: data.text('schema version', 'document'),
    accessLevel: data.text('schema access', 'authenticated'),
    sensitivity: data.text('schema sensitivity', 'internal'),
    updatedAt: data.date('schema updated at').toISOString(),
    author: data.person('schema author'),
    attributes: { locale: data.text('schema locale', 'locale') },
  });
}

test('published RAG metadata schema accepts helper-created metadata', () => {
  const candidate = metadata();
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
});

test('published RAG metadata schema rejects incomplete and extended records', () => {
  const base = metadata();
  const invalid = [
    { ...base, schema: 'pixiecore.rag-chunk-metadata/v2' },
    { ...base, namespace: ' ' },
    { ...base, access_level: '' },
    { ...base, updated_at: '2026-19-52T99:99:99.999Z' },
    { ...base, attributes: [] },
    { ...base, unexpected: true },
  ];
  const { author: _author, ...withoutAuthor } = base;
  invalid.push(withoutAuthor as typeof base);
  for (const candidate of invalid) assert.equal(validate(candidate), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRagChunkMetadata,
  RagAuthorizationError,
  RagBoundaryContractError,
  RagMetadataContractError,
  RagRetrievalBoundary,
  RAG_CHUNK_METADATA_SCHEMA,
  type RagAuthorizationRequest,
  type RagChunk,
  type RagRetrievalMatch,
  type RagStorePort,
  type RagStoreRetrievalRequest,
} from '../../src/core/kernel/rag/index.js';
import { testData } from '../helpers/test-data.js';

const data = testData('RAG chunk metadata contract');

function input() {
  return {
    namespace: data.text('namespace', 'travel_policy'),
    chunkType: data.text('chunk type', 'policy_clause'),
    field: data.text('field', 'destination_level'),
    version: data.text('version', 'revision'),
    accessLevel: data.text('access level', 'employees'),
    sensitivity: data.text('sensitivity', 'internal'),
    updatedAt: data.date('updated at').toISOString(),
    author: data.person('author'),
  };
}

test('RAG metadata maps camelCase input to the portable wire contract', () => {
  const metadata = createRagChunkMetadata(input());
  assert.equal(metadata.schema, RAG_CHUNK_METADATA_SCHEMA);
  assert.deepEqual(Object.keys(metadata), [
    'schema',
    'namespace',
    'chunk_type',
    'field',
    'version',
    'access_level',
    'sensitivity',
    'updated_at',
    'author',
  ]);
  assert.equal(Object.isFrozen(metadata), true);
});

test('RAG metadata clones and freezes storage-neutral extension attributes', () => {
  const attributes = {
    locale: data.text('locale', 'locale'),
    source: { page: data.integer('source page', 1, 100) },
  };
  const metadata = createRagChunkMetadata({ ...input(), attributes });
  attributes.source.page += 1;
  assert.notEqual((metadata.attributes?.source as { page: number }).page, attributes.source.page);
  assert.equal(Object.isFrozen(metadata.attributes), true);
  assert.equal(Object.isFrozen(metadata.attributes?.source), true);
});

test('RAG metadata rejects missing policy labels, invalid timestamps, and non-JSON attributes', () => {
  const base = input();
  const invalid = [
    () => createRagChunkMetadata({ ...base, namespace: ' ' }),
    () => createRagChunkMetadata({ ...base, chunkType: '' }),
    () => createRagChunkMetadata({ ...base, field: ' ' }),
    () => createRagChunkMetadata({ ...base, version: '' }),
    () => createRagChunkMetadata({ ...base, accessLevel: ' ' }),
    () => createRagChunkMetadata({ ...base, sensitivity: '' }),
    () => createRagChunkMetadata({ ...base, updatedAt: '2026-02-31T00:00:00.000Z' }),
    () => createRagChunkMetadata({ ...base, author: '' }),
    () => createRagChunkMetadata({ ...base, attributes: { score: Number.POSITIVE_INFINITY } }),
  ];
  for (const operation of invalid) assert.throws(operation, RagMetadataContractError);
});

test('RAG boundary indexes and retrieves only within a fixed server-owned scope', async () => {
  const store = new RecordingRagStore();
  const authorization = new RecordingAuthorization();
  const boundary = createBoundary(store, authorization);
  const indexed = chunk('indexed');
  await boundary.index([indexed]);

  const returned = chunk('returned');
  store.matches = [{ chunk: returned, score: data.decimal('retrieval score', 0.1, 0.99, 4) }];
  const query = data.text('retrieval query');
  const matches = await boundary.retrieve(query, 1);

  assert.equal(store.indexed.length, 1);
  assert.equal(Object.isFrozen(store.indexed), true);
  assert.equal(Object.isFrozen(store.indexed[0]), true);
  assert.equal(store.requests[0]?.query, query);
  assert.deepEqual(store.requests[0]?.scope, retrievalScope());
  assert.equal(Object.isFrozen(store.requests[0]), true);
  assert.equal(Object.isFrozen(store.requests[0]?.scope.accessLevels), true);
  assert.deepEqual(authorization.requests.map(item => item.operation), ['index', 'retrieve']);
  assert.deepEqual(Object.keys(authorization.requests[0] ?? {}).sort(), [
    'access_levels', 'item_count', 'namespace', 'operation', 'sensitivities',
  ]);
  assert.equal(Object.isFrozen(matches), true);
  assert.equal(Object.isFrozen(matches[0]), true);
  assert.equal(Object.isFrozen(matches[0]?.chunk.metadata), true);
  assert.deepEqual(matches[0], store.matches[0]);
  assert.notEqual(matches[0], store.matches[0]);
});

test('RAG retrieval tool exposes only query and limit while retaining configured scope', async () => {
  const store = new RecordingRagStore();
  const authorization = new RecordingAuthorization();
  const boundary = createBoundary(store, authorization, 3);
  store.matches = [{ chunk: chunk('tool result'), score: data.decimal('tool score', 0.1, 0.99, 4) }];
  const tool = boundary.createTool({ name: data.text('retrieval tool', 'rag_search') });
  const parameters = tool.parameters as {
    readonly properties: Readonly<Record<string, unknown>>;
    readonly additionalProperties: boolean;
  };

  assert.deepEqual(Object.keys(parameters.properties).sort(), ['limit', 'query']);
  assert.equal(parameters.additionalProperties, false);
  assert.equal(Object.isFrozen(tool), true);
  assert.equal(Object.isFrozen(tool.parameters), true);
  const result = await tool.execute({
    query: data.text('tool query'),
    limit: 1,
    namespace: data.text('untrusted namespace'),
    accessLevels: [data.text('untrusted access level')],
  }) as readonly RagRetrievalMatch[];
  assert.equal(result.length, 1);
  assert.deepEqual(store.requests[0]?.scope, retrievalScope());
});

test('RAG authorization denial happens before every store operation', async () => {
  const store = new RecordingRagStore();
  const authorization = new RecordingAuthorization(false);
  const boundary = createBoundary(store, authorization);

  await assert.rejects(boundary.index([chunk('denied index')]), RagAuthorizationError);
  await assert.rejects(boundary.retrieve(data.text('denied query')), RagAuthorizationError);
  assert.equal(store.indexed.length, 0);
  assert.equal(store.requests.length, 0);
});

test('RAG boundary fails closed on cross-scope, excessive, or malformed store results', async () => {
  const store = new RecordingRagStore();
  const boundary = createBoundary(store, new RecordingAuthorization(), 2);
  const valid = chunk('valid result');
  const invalidMatches: readonly (readonly RagRetrievalMatch[] | unknown)[] = [
    [{ chunk: { ...valid, metadata: { ...valid.metadata, namespace: data.text('foreign namespace') } }, score: 0.5 }],
    [{ chunk: { ...valid, metadata: { ...valid.metadata, access_level: data.text('foreign access') } }, score: 0.5 }],
    [{ chunk: valid, score: Number.NaN }],
    [{ chunk: valid, score: 0.1 }, { chunk: valid, score: 0.2 }, { chunk: valid, score: 0.3 }],
    null,
  ];
  for (const matches of invalidMatches) {
    store.matches = matches as readonly RagRetrievalMatch[];
    await assert.rejects(boundary.retrieve(data.text(`invalid store query ${String(matches)}`), 2), RagBoundaryContractError);
  }
});

test('RAG boundary rejects ambiguous configuration, chunks, queries, and limits', async () => {
  const store = new RecordingRagStore();
  const authorization = new RecordingAuthorization();
  assert.throws(() => new RagRetrievalBoundary(null as never), RagBoundaryContractError);
  assert.throws(() => new RagRetrievalBoundary({ store: {} as RagStorePort, authorization, scope: retrievalScope() }), /store/u);
  assert.throws(() => new RagRetrievalBoundary({ store, authorization: {} as never, scope: retrievalScope() }), /authorization/u);
  assert.throws(() => new RagRetrievalBoundary({ store, authorization, scope: null as never }), /scope/u);
  assert.throws(() => new RagRetrievalBoundary({ store, authorization, scope: { ...retrievalScope(), accessLevels: [] } }), /accessLevels/u);
  assert.throws(() => new RagRetrievalBoundary({ store, authorization, scope: { ...retrievalScope(), sensitivities: ['internal', 'internal'] } }), /duplicates/u);
  assert.throws(() => createBoundary(store, authorization, 0), /maxResults/u);

  const boundary = createBoundary(store, authorization, 2);
  await assert.rejects(boundary.index([]), /chunks/u);
  await assert.rejects(boundary.index([chunk('duplicate'), chunk('duplicate')]), /duplicate/u);
  await assert.rejects(boundary.index([{ ...chunk('blank content'), content: '' }]), /content/u);
  await assert.rejects(boundary.retrieve(' '), /query/u);
  await assert.rejects(boundary.retrieve(data.text('zero limit query'), 0), /limit/u);
  await assert.rejects(boundary.retrieve(data.text('excess limit query'), 3), /limit/u);
  assert.throws(() => boundary.createTool(null as never), /tool options/u);
  assert.throws(() => boundary.createTool({ name: '' }), /tool name/u);
  assert.throws(() => boundary.createTool({ name: data.text('tool with blank description'), description: '' }), /tool description/u);
});

function retrievalScope() {
  return {
    namespace: data.text('boundary namespace', 'travel_policy'),
    accessLevels: [data.text('boundary access level', 'employees')],
    sensitivities: [data.text('boundary sensitivity', 'internal')],
  };
}

function chunk(label: string): RagChunk {
  const configured = retrievalScope();
  return {
    id: data.text(`${label} chunk id`, 'chunk'),
    content: data.text(`${label} chunk content`),
    metadata: createRagChunkMetadata({
      ...input(),
      namespace: configured.namespace,
      accessLevel: configured.accessLevels[0]!,
      sensitivity: configured.sensitivities[0]!,
      attributes: { source: data.text(`${label} source`) },
    }),
  };
}

function createBoundary(
  store: RagStorePort,
  authorization: RecordingAuthorization,
  maxResults = 5,
): RagRetrievalBoundary {
  return new RagRetrievalBoundary({ store, authorization, scope: retrievalScope(), maxResults });
}

class RecordingAuthorization {
  readonly requests: RagAuthorizationRequest[] = [];

  constructor(private readonly allowed = true) {}

  authorize(request: RagAuthorizationRequest): boolean {
    this.requests.push(request);
    return this.allowed;
  }
}

class RecordingRagStore implements RagStorePort {
  indexed: readonly RagChunk[] = [];
  readonly requests: RagStoreRetrievalRequest[] = [];
  matches: readonly RagRetrievalMatch[] = [];

  index(chunks: readonly RagChunk[]): void {
    this.indexed = chunks;
  }

  retrieve(request: RagStoreRetrievalRequest): readonly RagRetrievalMatch[] {
    this.requests.push(request);
    return this.matches;
  }
}

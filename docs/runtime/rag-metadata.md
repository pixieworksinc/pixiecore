# Portable RAG chunk metadata

PixieCore defines storage-neutral metadata for chunks that a host application or
plugin may index and retrieve. The contract does not select a vector database,
embedding model, chunking algorithm, or retrieval policy.

```ts
import { createRagChunkMetadata } from '@pixieworks/pixiecore/rag';

const metadata = createRagChunkMetadata({
  namespace: 'travel-policy.global',
  chunkType: 'policy-clause',
  field: 'destination-level',
  version: '2026-04',
  accessLevel: 'employees',
  sensitivity: 'internal',
  updatedAt: new Date().toISOString(),
  author: 'travel-policy-team',
  attributes: {
    locale: 'en-US',
    source_document: 'travel-policy-2026',
  },
});
```

The wire representation uses snake_case and the exact schema identifier
`pixiecore.rag-chunk-metadata/v1`. Its JSON Schema is published at
`@pixieworks/pixiecore/rag/chunk-metadata-schema.json`.

## Fields

| Field | Meaning |
|---|---|
| `namespace` | Application-defined knowledge boundary used to avoid collisions. |
| `chunk_type` | Kind of source fragment, such as a policy clause or form field. |
| `field` | Logical source field represented by the chunk. |
| `version` | Application-defined source or content version. |
| `access_level` | Policy label evaluated by the retrieving application. |
| `sensitivity` | Data-classification label evaluated by application policy. |
| `updated_at` | Canonical UTC ISO 8601 update timestamp. |
| `author` | Stable author or owning-system identifier. |
| `attributes` | Optional JSON-only, storage-neutral extension metadata. |

The contract deliberately leaves `version`, `access_level`, and `sensitivity`
as non-blank strings. Their taxonomies differ across organizations and must be
defined by the application or an interoperability profile rather than silently
invented by the runtime.

## Security boundary

Metadata labels do not grant access. A retrieval plugin must authenticate the
caller and enforce its own policy before returning chunk content. It must also
prevent a caller from widening `namespace`, `access_level`, or `sensitivity`
filters beyond that policy.

`createRagChunkMetadata()` validates required labels and timestamps, then
clones and freezes optional attributes. PixieCore does not index content, create
embeddings, connect to a store, fetch chunks during Blueprint loading, or make
network retrieval implicit.

## Explicit indexing and retrieval boundary

`RagRetrievalBoundary` connects an application-owned store only after the host
fixes a namespace, allowed access levels, allowed sensitivity labels, maximum
result count, and a server-owned authorization callback. Neither a Blueprint
nor model-generated tool arguments can replace that scope.

```ts
import { RagRetrievalBoundary, type RagStorePort } from '@pixieworks/pixiecore/rag';
import type { PixieCorePlugin } from '@pixieworks/pixiecore';

const boundary = new RagRetrievalBoundary({
  store: applicationRagStore satisfies RagStorePort,
  scope: {
    namespace: 'travel-policy.global',
    accessLevels: ['employees'],
    sensitivities: ['internal'],
  },
  maxResults: 5,
  authorization: {
    authorize: request => authenticatedCaller.canUseKnowledge(request),
  },
});

const plugin: PixieCorePlugin = {
  tools: [boundary.createTool({ name: 'retrieve_travel_policy' })],
};
```

The generated tool accepts only `query` and `limit`. Namespace, access, and
sensitivity remain in the host closure. A Blueprint must explicitly select the
tool through its ordinary `tools` field; importing or loading a Blueprint never
contacts the store.

Applications call `boundary.index(chunks)` explicitly. Before a store call,
PixieCore validates every chunk against the fixed scope and calls the
authorization port with value-free operation metadata. Retrieved records are
cloned, frozen, limited to the requested count, and checked again against the
same scope. A cross-namespace or policy-label mismatch fails closed.

The store owns chunking, embedding creation and versioning, vector or keyword
search, persistence, encryption, and physical tenant isolation. The
authorization callback owns caller authentication and policy evaluation.
PixieCore supplies the boundary and tool contract, not either implementation.

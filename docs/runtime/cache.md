# Safe content cache

PixieCore caches nothing by default. The public `@pixieworks/pixiecore/cache` boundary lets a
host reuse non-sensitive JSON results without mixing tenants or silently
surviving a content or version change. It defines a storage port and record;
the host chooses the cache service and its physical isolation controls.

## Eligibility boundary

Every lookup requires `sensitivity`:

- `non-sensitive` permits key construction and storage; and
- `sensitive` computes the result but returns `bypass`, without hashing the
  content or calling any cache-port method.

The declaration covers both the key input and the computed value. If either may
contain credentials, personal data, regulated data, private documents, or other
secrets, the host must declare `sensitive`. Unknown data must be treated as
sensitive. This API has no permissive default.

Hashing is not anonymization. Even a one-way content hash can reveal equality
or permit dictionary attacks against predictable values. This is why sensitive
content never receives a PixieCore cache key.

## Key and invalidation model

For eligible content, PixieCore canonicalizes JSON object keys and creates a
SHA-256 content hash. The opaque cache key is a second SHA-256 over:

- a server-owned tenant fingerprint;
- namespace and resource identity;
- resource version;
- explicit invalidation version; and
- the content hash.

Changing content, resource version, or invalidation version therefore produces
a miss. `invalidate(namespace, resourceId)` also asks the host port to remove
all matching records for the bound tenant. Implementations must support both:
version changes are deterministic invalidation, while the explicit operation
handles revocation or correction before a planned version change.

The tenant ID itself is never sent to the cache port; a SHA-256 fingerprint is
used as the partition identifier. The fingerprint is pseudonymous metadata,
not an authorization control. Hosts remain responsible for authenticating the
caller and isolating the backing store.

## Read and write behavior

`getOrCompute()` returns `hit`, `miss`, or `bypass` with a cloned, frozen JSON
value. On an eligible lookup it:

1. validates and canonicalizes the non-sensitive content;
2. reads the exact key from the port;
3. validates the returned record, tenant fingerprint, and derived identity;
4. deletes an expired record at the expiry boundary; and
5. writes a new record only after `compute()` succeeds.

A malformed or cross-tenant port response fails closed. A computation failure
is propagated and is never cached. Cache stampede control, encryption,
replication, eviction, quotas, distributed locking, authorization, and audit
export remain host responsibilities.

## Example

```ts
import { SafeContentCache } from '@pixieworks/pixiecore/cache';

const cache = new SafeContentCache({
  tenantId: authenticatedTenant.id,
  port: applicationCachePort,
});

const result = await cache.getOrCompute({
  namespace: 'travel-policy',
  resourceId: 'city-levels',
  resourceVersion: '3.1.0',
  invalidationVersion: '2026-08-25',
  sensitivity: 'non-sensitive',
  ttlSeconds: 3_600,
  content: { city: 'Paris' },
}, () => classifyCity('Paris'));
```

## Blueprint execution cache

`BlueprintExecutionCache` builds on the same tenant-bound port and record while
making every AI execution dependency explicit. Its deterministic key includes:

- Blueprint ID and version;
- provider ID and adapter version;
- model ID and version;
- every selected tool ID and version;
- policy ID and version;
- explicit invalidation version; and
- canonicalized JSON input.

Tool identities are sorted before key construction, so registry order cannot
change the key. Duplicate tool IDs are rejected because they make ownership
ambiguous. Hosts must change the relevant version whenever prompt behavior,
provider adaptation, model behavior, tool implementation or schema, or policy
semantics change.

Unlike the generic boundary, `sensitivity` is optional here and defaults to
`sensitive`. An omitted declaration therefore returns `bypass` without hashing
the input or calling the cache port. Caching requires an explicit
`sensitivity: 'non-sensitive'` declaration.

```ts
import { BlueprintExecutionCache } from '@pixieworks/pixiecore/cache';

const executions = new BlueprintExecutionCache({
  tenantId: authenticatedTenant.id,
  port: applicationCachePort,
});

const result = await executions.getOrCompute({
  blueprint: { id: 'travel.city-classifier', version: '2.1.0' },
  provider: { id: 'openai', version: '1.4.0' },
  model: { id: 'gpt-5-mini', version: '2026-08-01' },
  tools: [{ id: 'travel-policy', version: '3.0.0' }],
  policy: { id: 'travel-classification', version: '4.2.0' },
  invalidationVersion: '1',
  sensitivity: 'non-sensitive',
  ttlSeconds: 3_600,
  input: { city: 'Paris' },
}, () => classifyCity('Paris'));
```

The class does not infer versions from mutable runtime objects. The host owns
version provenance and must supply values pinned by its deployment, Blueprint
package, provider plugin, model release, tool package, and policy release.

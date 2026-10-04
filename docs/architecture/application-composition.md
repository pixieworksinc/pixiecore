# Application composition

The `0.2.x` direction permits multiple reasoning Roles and deterministic
business policy inside one Blueprint. See
[POP principles](../specification/pop-principles.md) and the
[Customer discount example](../../examples/customer-discount/README.md).
The host-composition facilities below remain compatible integration tools;
their inherited 0.1 decisions do not constrain the restored POP model.

The inherited 0.1 reference applications execute one small Blueprint at a time and compose those
calls in ordinary TypeScript and keep orchestration, state, I/O, authorization,
and side effects outside prompt text.

The packaged
[`publication-brief.ts`](../../examples/application-composition/publication-brief.ts)
reference application demonstrates the PixieCore 0.1 composition boundary. It
imports only `PromptRuntime` and `RuntimeOptions` from the public `@pixieworks/pixiecore`
entry point; it does not depend on bootstrap, plugin-manager, or other internal
modules.

## Five-node reference application

| Node | Blueprint operation | Explicit input source |
|---|---|---|
| `extract-brief` | Extract title, audience, and source facts | Application input `sourceText` |
| `classify-brief` | Classify the extracted brief | Extraction output |
| `summarize-brief` | Summarize facts without adding claims | Extraction and classification outputs |
| `validate-brief` | Check the summary against source facts | Extraction and summary outputs |
| `localize-brief` | Localize locale-dependent wording | Summary output and application input `locale` |

Every mapping is a named TypeScript function. There is no automatic field-name
matching, JSONPath evaluator, implicit coercion, or workflow YAML. Each
Blueprint remains directly executable and has a standalone evaluation dataset
under `examples/application-composition/evaluations/`.

Inspect the graph and every node's resolved input/output schema without loading
application code, starting a runtime, or contacting a provider:

```bash
pixiecore application inspect \
  ./examples/application-composition/publication-brief.graph.yaml
pixiecore application inspect \
  ./examples/application-composition/publication-brief.graph.yaml \
  --format=mermaid
```

The default JSON form retains the complete schemas for tools and diagnostics.
The Mermaid form shows node IDs, roles, versions, schema field names, and
edges. The `.graph.yaml` file is inspection-only metadata: it documents
Blueprint paths, version pins, and `depends_on` edges, but cannot execute
mappings, branching, retries, side effects, or application code.

```ts
import { composePublicationBrief } from
  './examples/application-composition/publication-brief.js';

const result = await composePublicationBrief({
  sourceText: 'Release Orion adds a typed publication export.',
  locale: 'en-US',
});
```

## Eight-Role travel approval application

The packaged
[`travel-approval.ts`](../../examples/application-composition/travel-approval.ts)
application composes every reference Role family:

| Order | Node | Reference operation | Mapping owned by host code |
|---:|---|---|---|
| 1 | `extract-document` | Extract eight travel fields and page evidence | Attachment and requested field list |
| 2 | `normalize-start-date` | Convert one start date | Submitted start-date text |
| 3 | `normalize-end-date` | Convert one end date | Submitted end-date text |
| 4 | `classify-destination` | Classify one city under supplied policy | Submitted city/country and policy |
| 5 | `validate-form` | Validate normalized web-form fields | Converted dates plus submitted facts and rules |
| 6 | `verify-evidence` | Compare six submitted and extracted values | Extractor evidence renamed to verifier fields |
| 7 | `summarize-request` | Produce a factual approval summary | Normalized facts plus validation/verification notes |
| 8 | `localize-summary` | Translate while preserving selected terms | Summary, target locale, policy, and present protected terms |
| 9 | `route-approval` | Recommend the next user from CSV | Classified level, request cost, and versioned table |

Nine calls represent eight Role families because the Converter contract accepts
one date. The application reuses it rather than enlarging the Blueprint into a
multi-field workflow operation.

The composer stops on an invalid or ambiguous date, a non-routable destination,
an unreadable extraction that lacks verifier page evidence, an unparseable
amount, or an insufficient summary. Schema failures and provider failures keep
the exact node ID and original cause. Business statuses from validation,
verification, localization, and routing remain typed results for the caller;
the example does not approve, notify, or persist anything.

## Additional production-shaped examples

Two additional five-node applications test whether the same composition shape
holds outside publication and travel:

- [`customer-inquiry.ts`](../../examples/application-composition/customer-inquiry.ts)
  extracts, classifies, summarizes, validates, and recommends a policy route;
- [`invoice-review.ts`](../../examples/application-composition/invoice-review.ts)
  extracts, classifies, validates, verifies against a ledger record, and
  summarizes evidence for human review.

Both keep their five Blueprint definitions and five standalone datasets in a
dedicated sibling directory.

## Ownership and failure behavior

- All packaged applications preload their node definitions with
  `createApplicationSchemaBoundary()` from `@pixieworks/pixiecore/application`. Preflight
  rejects duplicate node IDs, missing Blueprints, and version drift. Each edge
  then validates upstream output schemas and normalized mapped inputs before
  the target provider call.
- `ApplicationMappingError` identifies the target node, source node IDs,
  mapping stage, and input field names without retaining mapped values.
- `traceApplication()` and `ApplicationTraceRecorder` correlate every node ID,
  Blueprint version, duration, result, provider/model call count, and normalized
  token usage under one trace ID. The versioned trace artifact intentionally
  excludes raw application inputs and Blueprint outputs; its JSON Schema is
  published as `@pixieworks/pixiecore/application/trace-schema.json`.
- [`@pixieworks/pixiecore/telemetry`](../runtime/telemetry.md) adds a shared Blueprint/node summary for
  explicit attempts, owner-specific retries, value-free failures, provider
  usage, caller-sourced pricing, and per-currency cost without changing the
  existing application trace v1 contract.
- The application creates one shared `PromptRuntime` and closes it exactly once.
- The application owns node order, explicit mappings, fail-fast behavior, and
  the application `AbortSignal`.
- `ApplicationExecutionController` provides one in-process admission boundary
  for an application budget, absolute deadline, parent or explicit
  cancellation, rolling start-rate limit, and maximum concurrency. Every
  admitted task receives the same derived `AbortSignal`; rejected work never
  starts and never consumes budget.
- Budget units are application-defined and are consumed when work is admitted,
  including work that later fails or is cancelled. Rate and concurrency limits
  reject immediately with typed, value-free errors; PixieCore does not create a
  hidden queue. Distributed quotas, fair scheduling, and cross-process locking
  remain host responsibilities.
- `executeApplicationNode()` makes each node's failure mode and retry owner
  explicit. `fail-fast` rethrows the original failure. `recoverable` returns a
  typed failure outcome so independent downstream work can continue.
- Retry ownership is exactly one of `runtime`, `application`, or `host`.
  Runtime-owned retries remain the bounded output-correction retries inside
  `PromptRuntime`. Application-owned retries require an explicit maximum and a
  `shouldRetry` predicate. Host-owned retries are performed outside PixieCore;
  the helper invokes the node only once.
- Cancellation is never converted into a recoverable failure and is never
  retried. The original abort reason propagates immediately.
- `createApplicationPartialResult()` creates a frozen, JSON-only artifact from
  completed outputs and value-free failure records. In-memory error causes are
  intentionally excluded. Its schema is published as
  `@pixieworks/pixiecore/application/partial-result-schema.json`.
- The same signal is passed to every active `PromptRuntime.execute()` call, and
  an aborted application starts no later node.
- `PromptRuntime` owns Blueprint/input/output validation, provider interaction,
  tool rounds, and bounded output-correction retries. The application does not
  repeat those retries.
- `ApplicationNodeError` provides the shared value-free node failure contract.
  Each application-specific subclass identifies the failed node, Blueprint
  path/version, input field names, and a correction suggestion while preserving
  the original error as its `cause`. A host with a real replay entry point may
  also supply that command; code-first examples do not invent one. The error
  deliberately does not capture input values or partial outputs.
- No notification, approval, persistence, or other external side effect is
  hidden in a Blueprint.

## APP-006 decision: keep composition code-first in 0.1

Four applications now provide enough evidence to close the initial format
decision. They share a small execution protocol but not a stable workflow
grammar:

| Evidence | Publication | Travel | Inquiry | Invoice |
|---|---|---|---|---|
| Shared runtime and schema preflight | yes | yes | yes | yes |
| Linear-only graph | no | no | yes | yes |
| Reused Blueprint at multiple nodes | no | yes | no | no |
| Domain stop before a later node | no | yes | yes | yes |
| Host-supplied policy/table | no | yes | yes | yes |
| Parallel-safe independent branches | yes | no | no | no |

The repeated protocol is already public as `createApplicationSchemaBoundary()`,
`traceApplication()`, and `executeApplicationNode()`. The remaining repetition
is explicit business mapping, branching, and typed domain checks. Encoding
those differences now would require general `if`, join, mapping-expression,
retry, and side-effect semantics without evidence that one declarative grammar
would stay small or language-neutral.

Therefore PixieCore 0.1 does **not** add an `Application` DSL or workflow schema.
Applications remain ordinary host-language code using public PixieCore
primitives. Reconsideration requires at least three external production
applications to demonstrate the same missing construct, with a concrete
portability or authoring benefit that cannot be met by a narrow helper.

For the same publication task expressed as one intentionally large Blueprint,
see the [monolithic/composed executable comparison](monolithic-comparison.md).

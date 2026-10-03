# PixieCore public-contract checklist

Audit date: 2026-08-24

This checklist records the repository-owned PixieCore contract. Its evidence is
the public package surface, documentation, schemas, examples, and deterministic
automated tests in this repository.

## Contract coverage

| Area | Evidence | Status |
|---|---|---|
| Blueprint loading and validation | Blueprint contract and runtime tests | Covered |
| Blueprint version transitions and compatibility classification | Git-base CI policy and architecture tests | Covered |
| Typed inputs, input JSON Schema, and decoded prompt delivery outside placeholder spans | Input, prompt-rendering, and built-in-role runtime contract tests | Covered |
| Structured output and self-evaluation | Validation and decorator tests | Covered |
| Human-review handoff, receipt, and integrity linkage | Review contract and published-schema tests | Covered |
| Portable RAG metadata and explicit scoped indexing/retrieval boundary | RAG contract, authorization, poisoned-store, tool-scope, and published-schema tests | Covered |
| Blueprint evaluation runner, comparison, seeded property corpus, artifact, and replay | Evaluation contract, schema, and CLI integration tests | Covered |
| Evidence-admitted deterministic execution | Closed data vocabulary, repeated dataset/model admission, value-free report, digest-bound promotion, opt-in fallback runtime, and three published schemas | Covered |
| Reference Blueprint quality catalog with provider/model, dataset, score, and license evidence | Catalog schema and cross-artifact contract tests | Offline baseline covered; remote evidence blocked |
| Code-first application composition and lifecycle boundary | Five-node publication and nine-execution/eight-Role travel applications, with `@pixieworks/pixiecore/application` preflight, edge validation, explicit failure/retry ownership, partial results, and value-free versioned traces | Covered |
| Atomic reference Blueprint units, fixtures, semantic datasets, and offline contracts | Travel-document Extractor, destination Classifier, travel-request Summarizer, form Validator, evidence Verifier, date-normalizer Converter, protected-term Translator / Localizer, CSV Router / Orchestrator, and public evaluation runner tests | Covered |
| Provider protocols and multimodal input | Provider contract and HTTP-mocked integration tests | Covered |
| Standard and pseudo tool calls | Tool contract and multi-round integration tests | Covered |
| Plugin discovery, activation, and cleanup | Plugin architecture, contract, and integration tests | Covered |
| MCP discovery, transport, recovery, and cleanup | MCP contract and integration tests | Covered |
| REST API, uploads, authentication, and CORS | API contract and integration tests | Covered |
| Logging, sanitization, audit, and rotation | Logging contract tests | Covered |
| Security support, private disclosure, release signing, and provenance policy | Security policy, threat model, and release gates | Covered |
| Tenant-safe content and version-pinned Blueprint execution caching | Cache contract, default-sensitive bypass, installed-package smoke, and record-schema tests | Covered |
| CLI execution, service lifecycle, and MCP stdio | CLI architecture and integration tests | Covered |
| Package exports, declarations, schemas, conformance fixtures, and two smoke Blueprints | Packed-artifact verification with an unpacked-size and file-count budget | Covered |

No default PixieCore test uses paid provider credentials. Live provider calls
require both `PIXIECORE_RUN_LIVE_TESTS=true` and an explicit
`PIXIECORE_LIVE_PROVIDERS` list.

## Public documentation inventory

| PixieCore material | Contract responsibility |
|---|---|
| `README.md` | Installation, first execution, public entry points, and documentation index |
| `docs/guides/getting-started.md` | Five-minute offline quickstart and canonical learning path |
| `docs/guides/tutorial.md` | Thirty-minute Blueprint authoring, testing, and composition workflow |
| `docs/architecture/architecture.md` | Runtime flow, source layers, extension, lifecycle, and ownership boundaries |
| `docs/guides/migration-guide.md` | Incremental migration and rollback from common existing designs |
| `docs/specification/pop-concepts.md` | POP terminology, responsibility boundaries, and current composition scope |
| `docs/specification/pop-overview.md` | Thirty-second explanation, one-page model, and demonstration narrative |
| `docs/architecture/application-composition.md` | Code-first composition, mapping, cancellation, failure, retry, and lifecycle ownership |
| `docs/architecture/blueprint-granularity.md` | Blueprint boundaries, examples, anti-patterns, and review checklist |
| `docs/blueprints/blueprint-library.md` | Reference-library directory, stable IDs, SemVer, ownership, and deprecation |
| `docs/blueprints/blueprints.md` | Blueprint fields, input schemas, localization, permissions, and execution order |
| `docs/blueprints/evaluation.md` | Versioned dataset/result formats, semantic comparisons, runner, and replay |
| `docs/runtime/jit.md` | Closed deterministic-program boundary, admission, promotion, replay, fallback, and artifact schemas |
| `docs/runtime/human-review.md` | Human-review handoff, receipt, integrity, and host boundaries |
| `docs/integrations/integrations.md` | MCP, LangChain/LangGraph, and Drupal integration boundaries and examples |
| `docs/runtime/rag-metadata.md` | Portable RAG metadata fields, policy labels, and retrieval boundary |
| `docs/guides/configuration.md` | Configuration sources, validation, and precedence |
| `docs/runtime/logging.md` | Logging variables, sanitization, audit records, and rotation |
| `docs/runtime/mcp.md` | MCP discovery, configuration, merge order, recovery, and cleanup |
| `docs/plugins/plugins.md` | Plugin discovery, component kinds, activation, and lifecycle |
| `docs/plugins/providers.md` | Provider authentication, schemas, tools, files, models, and errors |
| `docs/runtime/rest-api.md` | Endpoints, authentication, uploads, limits, errors, and CORS |
| `docs/project/review-policy.md` | Blueprint, plugin, and POP specification review and ownership evidence |
| `docs/plugins/tools.md` | Tool registration, selection, execution rounds, and name mapping |
| `examples/` | Repository-owned, type-checked usage examples; only `hello.yaml` and `analyze.yaml` are runtime-package smoke fixtures |

## Intentional TypeScript design decisions

- Runtime APIs are asynchronous and use camelCase, including `executeYaml`,
  `strictValidation`, and `mcpConfigPath`.
- Exported failures share the `PixieCoreError` base and stable code strings.
- `await using` and `Symbol.asyncDispose` provide deterministic async cleanup.
- Plugins are trusted ES modules with explicit manifests and package exports.
- REST upload fields, filenames, base64 content, and aggregate request limits are
  validated before runtime execution.
- Performance distributions and live provider latency are not stable functional
  contracts because they depend on runtime, network, and service state.

## Release gate

The release worktree must pass:

```bash
npm test
npm run test:contract
npm run test:integration
npm run test:coverage
npm run typecheck
npm run build
npm run check:conformance
npm run check:conformance:independent
npm run check:architecture
npm run check:blueprint-versions
npm run check:docs
npm run check:licenses
npm run verify:package
npm audit --omit=dev --audit-level=high
```

Coverage is limited to `src/**/*.ts` and enforces the configured line,
function, and branch floors. Package verification creates and installs the
actual tarball in an isolated consumer, then checks exports, declarations,
schemas, conformance fixtures, the two smoke Blueprints, runtime behavior, HTTP
behavior, CLI execution, notices, managed-plugin policy, and the package
footprint budget. Full examples, benchmark evidence, and public documentation
remain versioned repository assets instead of being duplicated into every
runtime installation.

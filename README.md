# PixieCore

PixieCore is an independent TypeScript runtime for Prompt-Oriented Programming
(POP). Business logic is defined in a Blueprint and executed by an LLM,
including deterministic comparisons, branching, calculations, and conversions.
A Blueprint can contain several ordered reasoning Roles serving one declared
business result.

This is the `0.2.x` development branch, restoring the original POP direction.
See [POP principles](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/specification/pop-principles.md)
and the [0.2 development plan](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/project/0.2-development.md).
No 0.2 package release or portable conformance approval is implied by this branch.

PixieCore validates and executes one Blueprint per `execute()` or
`executeYaml()` call. A Blueprint may include a complete business policy with
Classifier, Converter, Verifier, and Orchestrator Roles inside its prompt.
Both existing text prompts and structured ordered `Scenario` arrays are
supported. The runtime serializes structured instructions and binds inputs;
the LLM executes their logic.

The [Customer discount example](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/customer-discount/README.md)
uses one Blueprint to evaluate `Gold` and `purchase_amount > 1000`, calculate
`final_price`, and verify the result. Its 18-case dataset measures the semantic
result separately from output-schema validity. There is no host-code discount
calculation or business-policy Tool in its execution path.

Host code provides runtime mechanics and integration, including transport,
authorization enforcement, state, and explicit external side effects. Existing
application-composition helpers remain available, but ordinary code is not a
mandatory destination for deterministic business logic. Read
[POP concepts](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/specification/pop-concepts.md)
and the [Blueprint granularity guide](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/architecture/blueprint-granularity.md)
for the restored boundaries.

The versioned [POP Core Specification 0.1](https://github.com/pixieworksinc/pixiecore/blob/0.1.x/docs/specification/pop-core-specification-0.1.md)
and its schemas are retained as historical compatibility artifacts. The
proposed conceptual replacement is recorded in
[POP-RFC-0004](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/rfcs/0004-prompt-first-business-logic.md).
Existing code-first reference applications and adjacent-pattern benchmarks
remain available for comparison; they do not define POP's required granularity
or demonstrate LLM execution of logic that they move into host code.

The CLI can also scaffold a small single-operation Blueprint as a starting point:


```bash
npx --package @pixieworks/pixiecore pixiecore blueprint create ./blueprints/date-normalizer \
  --operation=converter \
  --name='Date normalizer'
```

New users should follow the [five-minute quickstart](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/guides/getting-started.md),
then the [30-minute Blueprint tutorial](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/guides/tutorial.md). The tutorial leads
directly into the [architecture](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/architecture/architecture.md) and
[migration](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/guides/migration-guide.md) guides.

PixieCore supports declarative YAML Blueprints, typed inputs, JSON Schema
outputs, seven provider adapters, multimodal inputs, tool loops, MCP client/server
support, ES-module plugins, and an HTTP API.

> [!NOTE]
> PixieCore 0.1 has completed its repository-owned contract and release audit.
> See the [public-contract checklist](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/project/public-contract-checklist.md) for
> the verified PixieCore behavior and release gates.

## Install and run

PixieCore requires Node.js 22.13 or newer.

From a cloned PixieCore checkout:

```bash
npm ci
npm run build
export OPENAI_API_KEY=...
node dist/core/kernel/cli/index.js execute examples/hello.yaml --inputs='{"name":"World"}'
```

When PixieCore is installed as an application dependency, use your application's
own Blueprint path. The package includes only `examples/hello.yaml` and
`examples/analyze.yaml` as installation smoke Blueprints. The complete reference
library, integration examples, benchmark evidence, and documentation remain in
the [versioned repository](https://github.com/pixieworksinc/pixiecore/tree/0.2.x); they are
not duplicated in every runtime installation.

```ts
import { PromptRuntime } from '@pixieworks/pixiecore';

await using runtime = new PromptRuntime({ provider: 'openai' });
const result = await runtime.execute('examples/hello.yaml', { name: 'World' });
```

Adapter names currently exist for `openai`, `anthropic`, `azure_openai`,
`azure_native`, `gemini_native`, and `gemini_openai`. Configure them with the
corresponding `*_API_KEY`, `*_MODEL`, endpoint, and deployment environment
variables. Azure adapters also accept `AZURE_OPENAI_USE_AZURE_AD=true` or
`AZURE_NATIVE_USE_AZURE_AD=true`; PixieCore then uses `DefaultAzureCredential`.

Every built-in provider exposes `supportsVision()`, `supportsFileInput()`, and
`getModelList()`. Anthropic Files API use is controlled by
`ANTHROPIC_ENABLE_FILES_API` and defaults to enabled. Files uploaded by a
provider instance are removed when that instance is closed.

Runtime failures use exported error subclasses with stable `code` values. Every
subclass derives from the canonical `PixieCoreError` base, so consumers can catch
one base class while retaining specific errors such as
`BlueprintValidationError`, `InputTypeError`, and `LLMAPIError`.

## Blueprint

A Blueprint should describe one independently testable input-to-output
operation, not an entire business application. Roles such as Extractor,
Classifier, Validator, and Converter are reusable behavioral families; every
concrete Blueprint still declares its own narrow inputs, instructions, and
output contract.

Required fields are `name`, `version`, `role`, `prompt`, and `output_schema`.
`input_placeholders` accepts either names or typed declarations (`string`,
`integer`, `float`, `number`, `boolean`, `array`, `object`, `file`, `image`).
Optional fields include `input_schema`, `examples`, `localization`,
`permissions`, `model`, `temperature`, and `tools`. `input_schema` accepts a
JSON Schema object or JSON string and rejects invalid business inputs before a
provider call.

Prompt input binding uses the language-neutral Mustache-style form
`{{ name }}`. For typed Blueprints, PixieCore validates every referenced name
against `input_placeholders`, preserves all instruction text outside the
matching spans, and keeps `{name}` only as a 0.x migration syntax. The behavior
is fixed by a packaged data-only conformance fixture; see
[Blueprints](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/blueprints/blueprints.md).

Applications that require final human approval can create immutable,
schema-versioned handoff and receipt artifacts through `@pixieworks/pixiecore/review`.
PixieCore links a receipt to the exact handoff with a deterministic digest;
authentication, persistence, UI, and external side effects remain application
responsibilities. See [Human-review handoff contracts](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/human-review.md).

Versioned data-only Blueprint collections can be distributed without plugin
execution privileges. PixieCore verifies their schema, compatibility, complete
SHA-256 inventory, Blueprint IDs, and contents before offline local install;
active versions can be enabled, disabled, upgraded, and rolled back. See
[Blueprint packages](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/blueprints/blueprint-packages.md).

Retrieval plugins can exchange storage-neutral chunk metadata and create an
explicitly scoped retrieval tool through `@pixieworks/pixiecore/rag`. Namespace, access,
sensitivity, and authorization are fixed by the host; Blueprint loading never
contacts the store. See [Portable RAG metadata and retrieval](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/rag-metadata.md).

## Multimodal input

Pass `image_path` or `file_path` as one string or an array of strings. Values may
be local paths or base64 data URLs; supported providers also accept HTTPS URLs.
PixieCore attaches the normalized inputs to every user message before the first
provider call and rejects unsupported capabilities or malformed arrays before
making an HTTP request.

The paths below are placeholders; replace them with attachments available to
your application.

```ts
const result = await runtime.execute('examples/analyze.yaml', {
  question: 'Compare the chart and report',
  image_path: ['./chart.png', 'data:image/jpeg;base64,...'],
  file_path: './report.pdf',
});
```

OpenAI-compatible Chat Completions adapters accept images and PDF file parts.
Anthropic supports image, PDF, and plain-text document paths, including its
optional Files API and legacy PDF text fallback. Gemini Native sends small
attachments inline and routes larger attachments through the Gemini Files API.
The inline limit defaults to 20 MiB and can be changed with
`GEMINI_INLINE_FILE_SIZE_LIMIT`.

## Tools and MCP

```ts
runtime.registerTool({
  name: 'lookup',
  description: 'Look up a record',
  parameters: { type: 'object', properties: { id: { type: 'string' } } },
  execute: async ({ id }) => ({ id, found: true }),
});
```

Tool calls retain provider-native call/result linkage across rounds. Runtime
defaults accept `toolChoice`, `maxToolRounds`, and `usePseudoToolCalling`; each
can be overridden for one `execute` or `executeYaml` call. Compatible environment
defaults are `PROMPT_RUNTIME_TOOL_CHOICE`, `PROMPT_RUNTIME_MAX_TOOL_ROUNDS`, and
`PROMPT_RUNTIME_USE_PSEUDO_TOOL_CALLING`.

Pass `mcpConfigPath: 'mcp.json'` for an MCP configuration containing an
`mcpServers` object. Omit it (or pass `null`) for current-directory/package-root
auto-discovery, or use `'disabled'` to disable MCP. PixieCore uses the official
MCP TypeScript client, lazily lists every tool page, isolates broken servers,
and closes all stdio children with the runtime. MCP tools are named
`mcp.<server>.<tool>`. See [MCP](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/mcp.md) for config validation, merging,
environment expansion, discovery precedence, and failure behavior.

PixieCore can also expose Blueprint execution as a stdio MCP server:

```bash
npm run build
node dist/core/kernel/cli/index.js mcp serve
```

The server publishes `execute` for Blueprint files and `execute_yaml` for
inline YAML, returning the validated result as MCP structured content. The
same server can be embedded with `createPixieCoreMcpServer()` or started with
`servePixieCoreMcpStdio()` from `@pixieworks/pixiecore/mcp-server`. See the MCP guide for host
configuration and the exact input contract.

## Blueprint evaluation

Run a versioned evaluation dataset and emit its result artifact to stdout:

```bash
pixiecore blueprint eval evaluations/date-converter.yaml --seed=release-candidate-1
```

Add `--output=artifacts/date-converter.json` to persist it explicitly. Failed
cases return exit status `1` and print a same-seed replay command. Dataset and
result schemas, the seeded property corpus, and the SDK runner are exported
from `@pixieworks/pixiecore/eval`; see the
[evaluation guide](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/blueprints/evaluation.md).

## Inherited opt-in JIT extension

This compatibility extension is under review for 0.2. Compiled execution is
distinct from the LLM-execution path and must be identified separately in
accuracy evidence. It is not used by the Customer discount example.

Narrow, repeatedly stable Blueprint operations can use the opt-in `@pixieworks/pixiecore/jit`
path. PixieCore validates a closed JSON data program, measures it against both a
versioned evaluation dataset and the ordinary model path, and creates a
digest-bound promotion only after complete agreement. It never executes
generated JavaScript, Wasm, shell commands, or module paths. See the
[JIT admission guide](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/jit.md)
for the safety boundary, public API, artifact schemas, and replay procedure.

## Reference Blueprint units

Reference Blueprints are versioned as repository-owned self-contained units with policy
documentation, fixtures, an evaluation dataset, expected results, and an
offline contract test. Their stable IDs, versions, ownership, naming, and
deprecation rules follow the [reference Blueprint library contract](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/blueprints/blueprint-library.md).
The repository also includes a dependency-free
[searchable Blueprint catalog](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/blueprints/catalog-site/README.md).
Current units are:

- The [travel document field Extractor](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/blueprints/extractor/travel-document-fields/README.md)
  reads one PDF or screenshot and returns requested values with page-level
  evidence without inferring absent or unreadable fields.
- The [travel destination Classifier](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/blueprints/classifier/travel-destination-level/README.md)
  applies a caller-supplied policy to listed cities, aliases, domestic and
  foreign defaults, same-name ambiguity, and unknown locations.
- The [travel request Summarizer](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/blueprints/summarizer/travel-request-summary/README.md)
  produces a length-bounded approval summary whose claims identify their
  source fields and whose missing or omitted facts remain explicit.
- The [travel request form Validator](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/blueprints/validator/travel-request-form/README.md)
  reports required, type, format, range, and correlation failures for each
  field without replacing them with one aggregate result.
- The [travel document evidence Verifier](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/blueprints/verifier/travel-document-evidence/README.md)
  distinguishes matches, mismatches, missing submissions, absent source
  fields, and unreadable evidence while preserving both values and page
  evidence.
- The [explicit Gregorian date Converter](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/blueprints/converter/date-normalizer/README.md)
  converts `2026年2月4日` to `2026-02-04` without guessing era years,
  ambiguous month/day order, relative dates, or timezone projections.
- The [travel purpose Translator / Localizer](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/blueprints/translator/travel-purpose-localizer/README.md)
  translates English and Japanese business text while retaining exact people,
  organizations, places, identifiers, amounts, and line breaks.
- The [travel approval Router / Orchestrator](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/blueprints/router/travel-approval-routing/README.md)
  selects one next user from caller-supplied CSV priority rules while keeping
  no-match, same-priority ambiguity, and disabled-user results explicit.

## Plugins, roles, and permissions

Managed custom plugins are trusted ES modules selected through a versioned
`pixiecore.plugins.yml` file. Pass its path as `pluginConfigPath`, use
`PIXIECORE_PLUGIN_CONFIG`, or omit the option (or pass `null`) to look for the
file in the current working directory. The project-local `plugins/` directory
is always the default managed root, including when no state file exists, but
its plugins remain disabled until selected. `'disabled'` bypasses discovery.
The file may add managed roots and declares explicit `enabled`/`disabled` IDs.
Policy, SemVer dependencies, conflicts, and cycles are resolved before selected
code is imported, and disabled modules are never imported.

Bundled PixieCore plugins live beside `src/core` under `src/plugins`. Third-party
plugins are normally installed as directory symlinks below the project-local
root `plugins/`. New TypeScript plugins use a Drupal-style source directory:
`abc.ts`, `abc.yaml`, `src/`, and `tests/`. Managed discovery prefers the named
YAML manifest and imports the compiled entry declared by it. Existing managed
`plugin.yml` projects remain supported.

A unit may contain child units only below its `plugins/` directory. Child IDs
must begin with the parent ID plus `.`, enabling a parent selects every
non-disabled descendant, and disabling a parent blocks its entire subtree
before any module import. The same recursive unit shape is validated for
bundled plugins by catalog generation and architecture checks.

The mandatory `pixiecore.recipe` bootstrap plugin lives with every other bundled
plugin at `src/plugins/recipe`. `PluginManager` activates it first, obtains the
locked standard Recipe through its service, and applies that composition using
the same catalog, dependency graph, registries, and lifecycle.

The existing `pluginsDir` and platform-delimited
`PROMPT_RUNTIME_PLUGINS_DIR` contract remains an automatically enabled legacy
path. It recursively accepts `plugin.yml` or `plugin.yaml`, default module
exports or named components, and preserves ordered override behavior. If a
canonical-realpath root appears in both systems, the legacy path takes
precedence.

PixieCore always registers the `assistant`/`default` role, `SchemaGuard`,
`PermissionGuard`, `SelfEvalDecorator`, and all seven built-in provider factories
from its validated, checked-in core plugin catalog.
All twenty-four locked plugin units (the mandatory Recipe plugin, fourteen
ordinary top-level units, and nine provider-family descendants) are enabled and
locked, while runtime, API, CLI, MCP,
and tool services activate only when their requested dependency closure needs
them; activation itself starts no provider call, child process, listener, or
command.
The APISIX provider owns four nested capability plugins and exposes a pure
[APISIX configuration compiler](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/plugins/apisix.md)
without making Admin API writes.
Blueprint permissions support role and user allow/deny lists plus required or
denied scopes. Permission rejection occurs before a provider request.

`PluginManager` also accepts an optional third `{ pluginConfigPath }` argument.
`getPluginStatus()` returns a frozen passive snapshot of observed core,
managed-custom, and legacy state without triggering discovery or imports.

Plugin authors should import the supported type-only authoring surface from
`@pixieworks/pixiecore/plugin`. Bootstrap activators, scoped service tokens, manager state,
and core-only service/command components are intentionally excluded. The
managed custom manifest schema is published as
`@pixieworks/pixiecore/plugin/schema.json`; the repository also includes a complete
[plugin project](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/plugin-project/pixiecore.plugins.yml) with
[converter](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/plugin-project/custom/plugins/roles/converter/converter.yaml)
and
[classifier](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/plugin-project/custom/plugins/roles/classifier/classifier.yaml)
roles that can be activated directly.

See [Plugins, roles, decorators, and permissions](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/plugins/plugins.md) for the
manifest format, schema limits, and TypeScript interfaces. Plugin authors can
follow the complete [third-party authoring guide](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/plugins/plugin-authoring.md) and
the role, decorator, tool, and provider examples under
[`examples/plugin-authoring`](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/plugin-authoring/README.md).

## HTTP API

```bash
npm run build
PIXIECORE_API_PORT=8000 npm start
curl http://localhost:8000/health
```

`POST /execute` accepts `{ blueprint, inputs?, messages?, files? }`. Uploaded
files are base64 decoded into an isolated temporary directory and removed after
execution. Those temporary paths are delivered to the selected provider through
the same multimodal pipeline as local `image_path` and `file_path` inputs.

The CLI listens on `127.0.0.1` by default. Binding to a non-loopback address
requires `PIXIECORE_API_TOKEN`; remote callers must send it as a Bearer token.
PixieCore API configuration uses the `PIXIECORE_*` namespace exclusively.

OpenAPI is available at `/openapi.json`, with Swagger UI at `/docs` and ReDoc at
`/redoc`. Request validation distinguishes malformed requests, Blueprint errors,
input validation/type errors, provider failures, schema failures, and retry
exhaustion. Every request receives an `x-request-id`, and closing the server
closes its shared runtime. See the [REST API guide](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/rest-api.md).

## Logging and audit

PixieCore provides async-local trace IDs, credential and header sanitization,
bounded payload logging, rotating text logs, and rotating JSONL audit events for
execution, provider calls, validation, and tools. File logging is opt-in and raw
payload logging is disabled by default. See the
[logging and audit guide](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/logging.md).

## Development and release verification

For repository development, use Node.js `^22.22.2 || >=24.15.0` (the current
Node 24 release is recommended). The installed runtime minimum remains
`22.13.0`. Install with `npm ci --engine-strict`, then run the same quality
checks used by CI. See [Node compatibility](docs/guides/node-compatibility.md)
for the separate tooling and consumer boundaries:

```bash
npm run typecheck
npm run check:node-engines
npm run check:architecture
npm run check:core-plugin-catalog
npm run check:docs
npm run test:fast
npm test
npm run test:repeat
npm run test:profile
npm run build
npm run check:conformance
npm run check:conformance:independent
npm run test:coverage
npm run check:licenses
npm run verify:package
npm audit --omit=dev --audit-level=high
```

Source coverage is required to remain at or above 90% for lines, branches, and
functions. `check:architecture` rejects dependency cycles and
boundary regressions, including external root-barrel re-exports, and enforces
the completed `src/index.ts` plus `src/core/` source layout.
`check:core-plugin-catalog` verifies that the generated catalog is byte-for-byte
current with canonical core manifests, while checking declared activator exports
and fresh synchronous factories.
Each test command generates and prints one `TEST_SEED`; fixture values
vary by run but a failure is reproducible with
`TEST_SEED=<printed-seed> npm test`. Direct `node --test` invocations must set
`TEST_SEED` explicitly.
`npm run test:fast` provides the short kernel, Recipe, public-export, and
cross-runtime contract loop. It deliberately excludes subprocess, loopback
HTTP, PDF, and full integration coverage; `npm test` remains the authoritative
offline suite and CI gate. The full suite compiles one current runtime for its
process-level CLI checks, then runs eight non-overlapping responsibility shards.
It starts the expected-longest work first while printing results in catalog
order. Each shard has its own Node.js process, while compatible test files share
module startup inside that shard. At most four shards run concurrently by
default to avoid starving their CLI children; local experiments may set
`PIXIECORE_TEST_SHARD_CONCURRENCY` to an integer from one through eight. A
contract test prevents file omissions and duplicate ownership; the coverage
command retains per-file isolation for one aggregate 90/90/90 report.
`npm run test:repeat` is a local convenience command that may reuse verified
TypeScript build metadata under ignored `.pixiecore/`. It checks generated output
before reuse and falls back to a clean build when uncertain. Use `npm test` for
CI, release evidence, or any clean-build verification. Set
`PIXIECORE_TEST_RUNTIME_CACHE=clean` to make one repeat command rebuild cleanly.
Every full-suite command measures value-free shard durations. When an estimate
differs from the observed duration by at least 35%, `npm test` prints a warning
that names the shard for review; timing alone never fails CI. `npm run
test:profile` additionally records the same value-free per-shard metadata in
ignored `.pixiecore/test-shard-profile.json`. Use profiles to recalibrate after a
test-topology change, not as a cross-host benchmark or CI gate.
`verify:package`
builds the real npm tarball, installs it
into an isolated temporary consumer, and checks the root, REST API, package
metadata, strict TypeScript declarations, runtime, examples, live `/health` and
`/execute` requests with shared-runtime shutdown, and the installed `pixiecore`
CLI shim.
The GitHub Actions workflow installs and runs documentation tooling on Node 24
with strict engine checking, then runs the full suite and verifies the immutable
installed candidate on Node 22.13.0 and the current Node 24 line. The default test suite and package
runtime smoke do not contact a model provider; only dependency installation and
`npm audit` require registry access.

POP conformance is checked twice: once through PixieCore's installed runtime
boundaries and once through a dependency-free Python validator. The second gate
detects accidental coupling between the portable specification and the
TypeScript implementation.

`check:licenses` verifies every locked production package has one of the
explicitly reviewed license expressions and that
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) matches the lockfile. A
dependency or license change therefore requires an intentional notice update.

## Documentation

- [Five-minute quickstart and learning path](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/guides/getting-started.md)
- [Thirty-minute Blueprint tutorial](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/guides/tutorial.md)
- [Architecture guide](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/architecture/architecture.md)
- [Class diagrams](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/architecture/class-diagrams.md)
- [Source documentation and TypeDoc](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/architecture/source-documentation.md)
- [Migration guide](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/guides/migration-guide.md)
- [POP concepts and canonical glossary](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/specification/pop-concepts.md)
- [POP and adjacent application-pattern landscape](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/specification/category-landscape.md)
- [POP Core Specification 0.1](https://github.com/pixieworksinc/pixiecore/blob/0.1.x/docs/specification/pop-core-specification-0.1.md)
- [POP 0.1 serialization schemas](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/specification/pop-schemas-0.1.md)
- [POP Core 0.1 conformance fixtures](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/specification/pop-conformance-0.1.md)
- [POP one-page overview and five-minute demonstration](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/specification/pop-overview.md)
- [Blueprint granularity guide](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/architecture/blueprint-granularity.md)
- [Blueprints](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/blueprints/blueprints.md)
- [Publishing third-party Blueprint packages](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/blueprints/blueprint-publishing.md)
- [Blueprint evaluation datasets](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/blueprints/evaluation.md)
- [Monolithic/composed executable comparison](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/architecture/monolithic-comparison.md)
- [Human-review handoff contracts](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/human-review.md)
- [Portable RAG metadata and explicit retrieval](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/rag-metadata.md)
- [MCP, LangChain/LangGraph, and Drupal integrations](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/integrations/integrations.md)
- [Clean-install Drupal Blueprint demo](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/examples/integrations/drupal/executable-specification/README.md)
- [Canonical OCR document-review demo](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/blueprints/ocr-demo.md)
- [Configuration](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/guides/configuration.md)
- [Providers](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/plugins/providers.md)
- [Tools](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/plugins/tools.md)
- [MCP](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/mcp.md)
- [Plugins, roles, decorators, and permissions](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/plugins/plugins.md)
- [REST API](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/rest-api.md)
- [Logging and audit](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/logging.md)
- [Execution telemetry](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/telemetry.md)
- [Evidence-admitted deterministic execution](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/jit.md)
- [Monthly adoption dashboard](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/project/adoption-dashboard.md)
- [Safe content and Blueprint execution cache](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/cache.md)
- [Data retention policy boundary](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/data-policy.md)
- [Explicit provider fallback](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/runtime/provider-fallback.md)
- [Threat model and signed audit exports](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/project/threat-model.md)
- [Public-contract checklist](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/project/public-contract-checklist.md)
- [Change review and ownership policy](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/project/review-policy.md)
- [Release and compatibility versioning](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/project/release-policy.md)
- [POP specification governance and RFC process](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/specification/pop-governance.md)
- [Project governance](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/GOVERNANCE.md)
- [Contributing, review targets, and release cadence](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/CONTRIBUTING.md)
- [Maintainers](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/MAINTAINERS.md)
- [Code of Conduct](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/CODE_OF_CONDUCT.md)
- [Decision log](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/decisions/README.md)
- [PixieCore 0.1 release notes](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/project/release-notes-0.1.0.md)

## Contract notes

The PixieCore contract is defined by this repository's documentation, package
exports, schemas, examples, and automated tests. TypeScript APIs are
asynchronous and use camelCase (`executeYaml`, `strictValidation`,
`mcpConfigPath`), while Blueprint and environment field names remain
snake_case. Verified contracts and intentional hardening decisions are listed in the
[public-contract checklist](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/project/public-contract-checklist.md); version and
publication boundaries are defined by the
[release policy](https://github.com/pixieworksinc/pixiecore/blob/0.2.x/docs/project/release-policy.md).

Provider smoke tests are opt-in and never run during the default suite. Set
`PIXIECORE_RUN_LIVE_TESTS=true` and a comma-separated
`PIXIECORE_LIVE_PROVIDERS` value to run them with credentials already present in
the environment, then run `npm run test:smoke`.

# PixieCore architecture guide

PixieCore is a modular TypeScript library and runtime, not a microservice mesh.
One process may expose CLI, REST, or MCP entry points. Applications compose
small Blueprint calls and decide where those processes are deployed.

PixieCore 0.1 is self-hosted and does not require an official control plane.
The host owns deployment, identity, secrets, persistence, data residency,
scaling, and monitoring. Any future hosted service must remain additive and
preserve offline execution under
[TC-ADR-0005](../decisions/0005-hosted-control-plane.md).

For class-level ownership, composition, and collaboration views, see the
[PixieCore class diagrams](class-diagrams.md). The generated TypeDoc site also
includes that document.

## Runtime model

```text
Application or inbound adapter
  -> PromptRuntime facade
     -> load and validate one Blueprint
     -> normalize and validate business inputs
     -> render one prompt through the selected Role
     -> enforce permissions and registered decorators
     -> call one Provider, with bounded Tool rounds when declared
     -> validate structured output and optional self-evaluation
  -> typed JSON result
```

Blueprint loading is offline. Retrieval, tools, persistence, approval, and
other side effects occur only through boundaries explicitly configured by the
host.

Repeated preparation is runtime-scoped and bounded. A `PromptRuntime` retains
at most 64 validated Blueprint sources and invalidates file entries when source
metadata changes. The validation service independently retains at most 64
compiled JSON Schema validators. Neither cache is process-global, validation
failures are not retained, and Blueprint values are cloned between executions.

## Source layout

```text
src/
├── index.ts                 public root barrel
├── core/
│   ├── contracts/           stable types, ports, and errors
│   │   ├── application/     application contracts and control policy
│   │   ├── mcp/             MCP client and server contracts
│   │   └── plugin/          plugin SDK, activation, state, and services
│   ├── component/           small implementation-independent utilities
│   ├── bootstrap/           discovery, policy, registries, lifecycle
│   │   ├── blueprint/       Blueprint package state, verification, and IO
│   │   └── plugin-manager/  plugin discovery, policy, Recipe, and lifecycle
│   │       ├── dependency/  shared dependency ordering and resolution
│   │       ├── managed/     managed plugin catalog, discovery, and loading
│   │       ├── recipe/      Recipe planning and application
│   │       └── registries/  contribution and service registries
│   └── kernel/              public execution and composition layer
│       ├── application/     mapping, graph, execution, control, and tracing
│       ├── blueprint/       Blueprint package facade, CLI, and preparation cache
│       ├── evaluation/      evaluation, comparison, benchmark, and scorecard
│       ├── generated/       build-generated bundled plugin catalog
│       ├── plugin/          public manager, catalog, and CLI
│       └── telemetry/       execution telemetry and aggregation
└── plugins/                 bundled runtime capabilities
    ├── recipe/              mandatory locked composition plugin
    ├── runtime/
    ├── validation/
    ├── roles/
    ├── providers/
    ├── tools/
    ├── permissions/
    ├── logging/
    ├── mcp/
    ├── api/
    └── cli/
```

`core` contains the shared host mechanism. Bundled plugins are peers below
`src/plugins`, while project-local third-party plugins are discovered from the
consumer's `plugins/` roots. The bootstrap plugin host validates dependencies,
activation, contribution registration, and reverse-order cleanup without
knowing any concrete plugin. The public `PluginManager` injects
the generated bundled catalog, activates only `pixiecore.recipe`, and applies
the locked standard Recipe provided by that plugin. Its canonical YAML is
`src/plugins/recipe/recipes/pixiecore.recipe.yaml`. Managed custom plugins
are explicitly enabled.
See [Recipes](../plugins/recipes.md),
[TC-ADR-0006](../decisions/0006-standard-plugin-recipe.md), and
[TC-ADR-0008](../decisions/0008-colocate-recipe-plugin.md).

## Dependency direction

- Contracts do not depend on kernel or plugins.
- Components depend only on contracts or smaller components.
- Bootstrap owns discovery and lifecycle, not application behavior.
- The mandatory Recipe plugin is a peer under `src/plugins`; its lock and
  bootstrap order are enforced by policy rather than physical placement.
- Kernel entry points compose contracts, components, bootstrap services, and
  direct plugin entry points. They never import plugin leaf implementation
  files.
- Plugins may use contracts and other declared plugin services, but do not
  import kernel composition roots.
- `src/index.ts` re-exports public contracts, kernel entry points, and direct
  bundled plugin entries only.

The architecture checker enforces these directions, source inventory, cycles,
plugin ownership, repeated-prefix submodule ownership, and public barrel limits.
Production implementation classes compose collaborators rather than inherit
from concrete implementations. Error specialization and interface extension
remain valid type relationships.
Production source files that share a direct parent and repeat a semantic prefix
must live below a directory named for that prefix. Tests retain subject prefixes
because their category directories express test ownership rather than runtime
module ownership.

PixieCore also applies [fractal directory ownership](../decisions/0010-fractal-directory-ownership.md).
A non-leaf directory primarily contains responsibility-named child directories;
implementation files collect at the lowest cohesive leaf. Structural boundary
files such as one facade, `index.ts`, or a plugin's identity entry and manifest
may remain beside child directories. A non-leaf with three or more other
implementation files must be decomposed before more peers are added. This rule
must create meaningful ownership boundaries, not empty wrappers or arbitrary
one-file directories.

The current core applies that grammar directly:

```text
src/core/
├── bootstrap/
│   └── plugin-manager/
│       ├── activation/
│       ├── authoring/
│       ├── catalog/
│       ├── dependency/
│       ├── managed/
│       ├── model/
│       ├── recipe/
│       └── registries/
├── contracts/
│   └── <contract>/
└── kernel/
    └── <public-capability>/
```

`contracts/index.ts` and `plugin-manager/manager.ts` are structural boundaries,
not peer implementations. Plugin `src/` roots may likewise keep activator,
service, factory, or index entries while implementation details live in named
children. The architecture checker rejects a non-leaf that accumulates three
or more other production implementation files.

## Application boundary

PixieCore deliberately does not encode a general workflow language in 0.1.
Ordinary host code owns:

- node order, branching, parallelism, and explicit field mapping;
- state, authorization context, budgets, cancellation, and retry ownership;
- databases, queues, user interfaces, notifications, and external updates;
- human approval and final side effects.

PixieCore owns validation and execution of one Blueprint call. Public
application helpers add schema preflight, edge checks, value-free traces,
admission control, failure policy, and partial-result artifacts without hiding
business mappings.

Durable deferred and batch execution remains a host responsibility. PixieCore
does not persist, lease, schedule, resume, or monitor jobs, and admission limits
never create a hidden queue. A queue or workflow integration plugin requires a
concrete operational system and must preserve this boundary. See
[TC-ADR-0003](../decisions/0003-deferred-execution-boundary.md).

## Extension boundaries

Choose the smallest extension that fits the need:

| Need | Boundary |
|---|---|
| One cognitive input-to-output operation | Blueprint |
| Deterministic callable capability | Tool |
| Message construction for a role name | Role plugin |
| Model transport | Provider plugin |
| Output checking or transformation stage | Decorator plugin |
| Application sequencing or side effects | Host application |
| Portable retrieval metadata and scoped search | `@pixieworks/pixiecore/rag` boundary plus explicit Tool |

Plugins are trusted code with the Node.js process's privileges. Blueprint
packages are data-only and do not receive executable plugin privileges.

## Lifecycle and failure ownership

Create long-lived resources at a composition root and close them once. A
`PromptRuntime` owns resources it creates, including provider instances and MCP
children. Plugin cleanup runs in reverse activation order and attempts every
cleanup even after one fails.

Retry ownership is explicit: runtime retries only bounded output correction;
application retries only a declared node policy; host retries only outside the
application invocation. Cancellation is never converted into a retryable
failure.

For detailed contracts, continue with [plugins](../plugins/plugins.md),
[application composition](application-composition.md), [tools](../plugins/tools.md),
[providers](../plugins/providers.md), and the [threat model](../project/threat-model.md).

# PixieCore Plugins, Roles, Decorators, and Permissions

PixieCore plugins are trusted ES modules. They can add or replace agent roles,
output decorators, tools, and providers without changing the runtime package.

## Built-in components

Every `PluginManager` starts with these components before it loads user
directories:

- `DefaultAgentRole`, supporting Blueprint roles `assistant` and `default`.
- `SchemaGuard` at priority 10, validating parsed output against JSON Schema.
- `PermissionGuard` at priority 20, enforcing permissions before generation.
- `SelfEvalDecorator` at priority 30, rejecting non-empty output `errors`.
- Provider factories named `openai`, `anthropic`, `azure_openai`,
  `azure_native`, `gemini_native`, `gemini_openai`, and `apisix`.

Lower decorator priorities run first. Registration order is retained when two
decorators have the same priority.

## Core plugin activation

PixieCore ships twenty-four locked plugin units: the mandatory `pixiecore.recipe`
bootstrap plugin, fourteen ordinary top-level units (JIT, logging, validation,
multimodal, tools, roles, permissions, self-evaluation, providers, the MCP
client, runtime, API, CLI, and the MCP server), plus nine descendants below
providers. The provider subtree includes OpenAI, Anthropic, Azure, Gemini,
APISIX, and four independently managed APISIX capability plugins. Every public manager records them as
enabled and locked; project policy cannot disable them or claim their reserved
`pixiecore.*` IDs.

Enabled does not mean activated. A public `PluginManager` first activates only
`pixiecore.recipe`, resolves its Recipe service, then activates the standard
Recipe roots needed to preserve constructor-visible roles, decorators, and
provider factories. `PromptRuntime` additionally selects the runtime root,
API construction selects the API root, and the CLI selects only its command
root plus the API root for `serve` or the MCP server root for `mcp serve`.
Dependencies activate first, each core activator runs at most once per manager,
and shutdown remains reverse ordered.

Core activators only register fresh contributions or scoped service values.
They do not make provider requests, start MCP children or HTTP listeners,
create log files, or execute CLI commands. The `service` and `command`
component metadata is trusted-core-only; managed custom manifests accept
`agent_role`, `decorator`, `tool`, `provider`, and `extension`. Managed custom
dependencies on a core plugin activate the required core closure only after
import-free policy validation and before the custom module is imported.

The fixed Recipe plugin is owned by `src/plugins/recipe` alongside the other
eighteen bundled manifests. Its non-disableable status comes from locked core
policy, not from a special filesystem hierarchy. See [Recipes](recipes.md).

## Managed custom plugins

Managed custom plugins are opt-in. PixieCore inventories the project-local
`plugins/` directory by default and imports only IDs selected by managed state:

```ts
const runtime = new PromptRuntime({
  provider: 'company_provider',
  pluginConfigPath: './pixiecore.plugins.yml',
});
```

```yaml
# pixiecore.plugins.yml
schema: pixiecore.plugins/v1
enabled:
  - acme.converter
disabled:
  - acme.classifier
```

PixieCore resolves the state path in this order: an explicit
`RuntimeOptions.pluginConfigPath`, `PIXIECORE_PLUGIN_CONFIG`, then
`pixiecore.plugins.yml` in the current working directory. Relative state paths
use the captured working directory; relative `roots` use the state file's
parent directory. The state file's sibling `plugins/` directory is always the
first root and additional `roots` extend it. Omission or `null` enables that
automatic lookup. If no file is found, the default root is still inventoried
with every candidate disabled. Passing `'disabled'` bypasses managed state
lookup and discovery even when the environment variable or default file exists.
PixieCore never creates or updates the state file.

Third-party installations are normally directory symbolic links. PixieCore
follows directory links, deduplicates canonical targets, and prevents link
cycles from rediscovering a unit. Once a manifest is found, discovery treats
that directory as one unit and descends only through its optional `plugins/`
child; manifests below the unit's `src/` and `tests/` interiors are ignored.
The child ID must begin with its parent ID followed by `.`; a mismatch is fatal
even when the child is disabled and is reported before any module import.

Applications that construct the manager directly can pass the same setting as
its optional third argument:

```ts
const manager = new PluginManager(undefined, process.env, {
  pluginConfigPath: './pixiecore.plugins.yml',
});
```

New managed plugin source projects use the Drupal-style ownership layout:

```text
converter/
├── converter.ts
├── converter.yaml
├── src/
└── tests/
```

`converter.ts` is compiled to `converter.js` before activation. Its canonical
`converter.yaml` manifest is:

```yaml
schema: pixiecore.plugin/v1
id: acme.converter
name: Acme Converter
version: '0.1.0'
description: Adds the converter role
entry: ./converter.js

requires:
  pixiecore.roles: '^0.1.0'
optional_requires: {}
conflicts: {}

components:
  - type: agent_role
    export: ConverterRole
    roles_supported: [converter]
```

The accepted top-level fields are exactly `schema`, `id`, `name`, `version`,
`description`, `entry`, `requires`, `optional_requires`, `conflicts`, and
`components`; fields that do not apply may be omitted where the schema allows.
Managed IDs are lowercase ASCII namespaced identifiers such as
`acme.converter`; `pixiecore.*` is reserved for the trusted core catalog.
Versions follow SemVer 2.0 and dependency values are npm-compatible ranges.
The canonical spellings are `entry` and `export`; paths must stay within the
plugin's real root. Trust and policy fields such as `core`, `origin`, `locked`,
`enabled`, and `disabled` do not belong in a plugin manifest.

Required dependencies are selected transitively unless explicitly disabled.
Optional dependencies are not auto-enabled, but participate in ordering when
selected independently. Missing, disabled, or version-incompatible required
dependencies, selected conflicts, and dependency cycles fail before any
managed module is imported. Dependencies activate before dependents; unrelated
plugins retain deterministic discovery order with ID as the final tie-breaker.

Enabling a parent unit selects every descendant that is not explicitly
disabled, with parents ordered before their selected children. An enabled
parent may therefore retain a disabled child. Disabling a parent blocks its
entire subtree: explicitly enabling a descendant is a configuration error, and
a selected plugin requiring a descendant in that subtree fails as an
explicitly-disabled dependency. These checks use the import-free inventory;
status reporting does not import disabled child modules.

All managed candidates receive import-free YAML, envelope, and identity
validation. A malformed disabled candidate is reported as
`invalid-disabled` without stopping startup. Duplicate IDs and attempts to
claim the reserved namespace are fatal even for disabled candidates. An ID in
both state lists and an unknown enabled ID are configuration errors; an unknown
disabled ID is retained as a non-fatal stale-state diagnostic. Root directories
are deduplicated by canonical real path. If a root is also supplied through
legacy `pluginsDir`, including through a symlink alias, legacy loading takes
precedence and the managed scan excludes that root.

## Plugin authoring SDK and manifest schema

For the end-to-end create, validate, test, install, integrity, signing, catalog,
upgrade, and rollback workflow, use the
[third-party plugin authoring guide](plugin-authoring.md). Complete projects for
all five public component kinds are in
[`examples/plugin-authoring`](../../examples/plugin-authoring/README.md).

Trusted plugin modules should import authoring types from the type-only
`@pixieworks/pixiecore/plugin` subpath. It exposes the supported role, decorator, tool,
provider, message, Blueprint, runtime-option, logging, and legacy
`PixieCorePlugin` contracts needed by the loaders. The existing root type
exports remain available for compatibility, but new plugins should use the
narrower subpath:

```ts
import type {
  AgentRolePlugin,
  OutputDecorator,
  ProviderFactory,
  PluginExtension,
  RegisteredTool,
  PixieCorePlugin,
} from '@pixieworks/pixiecore/plugin';
```

`@pixieworks/pixiecore/plugin` has no runtime values. Bootstrap `PluginActivator` contracts,
scoped service registries and tokens, manager status/policy types, and core-only
service and command components are deliberately excluded because managed and
legacy custom loaders do not consume them.

The managed custom manifest JSON Schema is packaged at
`@pixieworks/pixiecore/plugin/schema.json` and maintained in
<!-- pixiecore-packed path="schemas/pixiecore.plugin-v1.schema.json" -->
[`schemas/pixiecore.plugin-v1.schema.json`](../../schemas/pixiecore.plugin-v1.schema.json).
It is a Draft 2020-12 editor/validation schema for third-party manifests, not
for trusted core manifests: custom manifests accept only these component
shapes.

| Component `type` | Required component fields | Optional field |
|---|---|---|
| `agent_role` | `export`, non-empty `roles_supported` | `module` |
| `decorator` | `export`, finite `priority` | `module`, `stage` (`before`, `after`, or `both`) |
| `tool` | `export`, `tool_name` | `module` |
| `provider` | `export`, `provider_name` | `module` |
| `extension` | `export`, `extension_point` | `module` |

The schema fixes the exact top-level and component field names, custom ID and
SemVer syntax, and excludes the reserved `pixiecore.*` namespace plus core-only
`service`/`command` components. Runtime validation additionally performs the
checks JSON Schema cannot fully express: npm-compatible dependency ranges,
canonical real-path containment and file existence, YAML alias/duplicate-key
handling, dependency policy, and trust-origin assignment. Do not add a
`$schema` field to the plugin YAML; associate the packaged schema in the editor
instead because unknown manifest fields are rejected.

`components` is optional. When omitted, the entry module's default export is a
`PixieCorePlugin` object or a synchronous/asynchronous zero-argument factory
returning one. When `components` is present, agent-role, decorator, and tool
exports may be objects, zero-argument classes, or synchronous factories.
Provider exports may additionally be provider factories or classes receiving
`RuntimeOptions`. Extension exports are synchronously created values registered
in activation order under their namespaced `extension_point`; consumers obtain
a frozen list through `PluginManager.getExtensions()`. Managed manifests use
`export` only; the legacy `class` alias
described below is not accepted by `pixiecore.plugin/v1`.

The packaged
[`examples/plugin-project/pixiecore.plugins.yml`](../../examples/plugin-project/pixiecore.plugins.yml)
is a complete consumer-style project. Its
[`converter`](../../examples/plugin-project/custom/plugins/roles/converter/converter.yaml)
and
[`classifier`](../../examples/plugin-project/custom/plugins/roles/classifier/classifier.yaml)
roles use the named source layout, retain directly executable `// @ts-check`
build artifacts, and import authoring types from `@pixieworks/pixiecore/plugin`. Their owned
tests run in the default suite, while separate temporary fixtures prove
existing managed `plugin.yml` compatibility.

## Legacy discovery and precedence

Pass one directory or an ordered list:

```ts
const runtime = new PromptRuntime({
  provider: 'company_provider',
  pluginsDir: ['./plugins', './company-plugins'],
});
```

`PROMPT_RUNTIME_PLUGINS_DIR` provides the same legacy default and uses the operating
system path delimiter (`:` on macOS/Linux and `;` on Windows). An explicit
`pluginsDir` takes precedence. This legacy path recursively discovers
`plugin.yml` and `plugin.yaml`, sorts entries deterministically, and loads
directories in the given order. It remains enabled automatically and does not
use managed activation state. Managed roots instead prefer `<directory>.yaml`
and fall back to `plugin.yml` for compatibility.

Built-ins load first. Later user registrations replace earlier agent-role,
tool, and provider names. Decorators accumulate and remain priority sorted.
Missing optional directories are ignored; malformed manifests and modules raise
`PluginLoadError`.

## Legacy direct module format

The shortest manifest loads a default `PixieCorePlugin` export:

```yaml
name: Company plugin suite
version: 0.1.0
module: ./plugin.js
```

```ts
import type { PixieCorePlugin } from '@pixieworks/pixiecore/plugin';

const plugin: PixieCorePlugin = {
  agentRoles: [analystRole],
  decorators: [contentGuard],
  tools: [lookupTool],
  providers: [companyProviderFactory],
  async close() {
    // Release resources owned by the module.
  },
};

export default plugin;
```

The default export may also be a synchronous or asynchronous zero-argument
factory returning that object.

## Legacy component manifest format

A component manifest maps named module exports. The four original component
names remain supported and `extension` adds an owner-defined contribution:

```yaml
name: Company plugin suite
version: 0.1.0
module: ./plugin.js
components:
  - type: agent_role
    export: AnalystRole
    roles_supported: [analyst, reviewer]
  - type: decorator
    export: ContentGuard
    priority: 15
    stage: after
  - type: tool
    export: LookupTool
    tool_name: lookup
  - type: provider
    export: CompanyProvider
    provider_name: company_provider
  - type: extension
    export: CompanyGatewayPolicy
    extension_point: acme.gateway.policy
```

`class` is accepted as an alias for `export` in component entries. PixieCore
always imports JavaScript ES modules; Python-qualified class paths are not
loaded. A component may specify its own `module` instead of the root module.

Agent-role, decorator, tool, and extension exports may be an object, a zero-argument class,
or a synchronous factory. Provider exports may additionally be a provider
factory or a class receiving `RuntimeOptions`. A created provider's `name` must
match its registered `provider_name`.

## Read-only status

`manager.getPluginStatus()` returns a deeply frozen, passive snapshot of the
inventory already observed by that manager. Reading it never starts discovery,
loads a state file, or imports plugin code. The snapshot contains the resolved
managed configuration path and managed roots, manager-wide diagnostics, and deterministic
entries for core, managed-custom, and legacy origins. Each entry reports its
identity, manifest location, dependencies, diagnostics, enabled/locked flags,
activation flag, and lifecycle state, including `invalid-disabled` and failure
states. Obtain a new snapshot after `load()` or `close()` to observe later
lifecycle transitions; earlier snapshots do not mutate.

## Agent roles

An agent role receives the rendered prompt, Blueprint, and validated inputs. It
returns canonical messages and may supply model or temperature defaults:

```ts
import type { AgentRolePlugin } from '@pixieworks/pixiecore/plugin';

export const analystRole: AgentRolePlugin = {
  supportedRoles: ['analyst'],
  apply(prompt) {
    return {
      model: 'analysis-model',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are a careful analyst.' },
        { role: 'user', content: prompt },
      ],
    };
  },
};
```

Blueprint `model` and `temperature` values override role defaults. Message
history and examples are inserted before the role's final user message.

## Decorators

Decorators receive a `DecoratorContext`. The default stage is `after`; use
`before` for request guards or `both` for both points. Returning `void` leaves
the current context unchanged. Returning a context can transform the output for
the next decorator:

```ts
import type { OutputDecorator } from '@pixieworks/pixiecore/plugin';

export const contentGuard: OutputDecorator = {
  priority: 15,
  stage: 'after',
  validate(context) {
    return { ...context, output: normalize(context.output) };
  },
};
```

Post-generation failures enter the normal correction/retry loop. Pre-generation
failures stop before any provider request.

## Permissions

Blueprint permissions use these fields:

```yaml
permissions:
  allow_roles: [admin, editor]
  deny_roles: [blocked]
  allow_users: [alice@example.com]
  deny_users: [suspended@example.com]
  allow_scopes: [document:read, document:write]
  deny_scopes: [system:admin]
```

Supply authorization context as `user_role`, `user_id`, and `user_scopes` in
runtime inputs. Scope input may be an array, a `Set`, or a comma/space-delimited
string. Deny lists take precedence, and every `allow_scopes` entry is required.
When a Blueprint declares permissions, undeclared authorization context keys do
not become strict input-validation errors.

Permission failures use distinct `RolePermissionError`, `UserPermissionError`,
and `ScopePermissionError` classes. Schema and self-evaluation failures use
`SchemaValidationError` and `SelfEvaluationError`.

## Cleanup and trust boundary

`PromptRuntime.close()` closes MCP resources, plugin-owned providers, plugin
components, and plugin modules once, including resources loaded before a later
manifest fails. Cleanup continues across individual close failures and reports
an aggregate error afterward.

Plugin modules execute with the permissions of the Node.js process. Only load
code from trusted locations.

# PixieCore plugin layout

PixieCore follows Drupal's module-ownership model: a plugin owns its entry point,
manifest, implementation, and tests in one directory.

PixieCore keeps its fixed host under `src/core`, every bundled trusted plugin
under the parallel `src/plugins`, and its project-local third-party installation
slot at repository-root `plugins/`.

## Required plugin source shape

For every plugin unit reached from `src/plugins/`, from a unit's optional
`plugins/` child slot, or from a repository-owned
`custom/plugins/**/<name>/` directory, all four ownership entries are
mandatory:

```text
<name>/
├── <name>.ts       # thin plugin entry point
├── <name>.yaml     # canonical core manifest
├── src/            # production implementation
├── tests/          # tests owned by this plugin
└── plugins/        # optional child-plugin traversal slot
```

`<name>.ts` exports the plugin activator and the plugin's supported internal
barrel. The canonical manifest uses `entry: ./<name>.js`. Production code may
not be placed in `tests/`, and plugin-owned tests are excluded from the emitted
npm package while remaining part of type-checking, the default suite, and
coverage execution.

The architecture checks reject a missing required entry, a wrongly named
manifest, an empty plugin test directory, or production test output. The core
catalog additionally validates first-party manifests and their entry exports.

For a managed custom plugin, compile `<name>.ts` to an executable
`<name>.js` before activation and set `entry: ./<name>.js`. A deployment
artifact may omit TypeScript sources and `tests/`; the mandatory shape is the
source-project ownership contract.

The `src/` interior never recurses. Before discovery enters a unit it may walk
namespace/grouping directories. After finding `<name>.yaml` or compatible
`plugin.yml`, it descends only into that unit's optional `plugins/` directory;
manifest-looking fixtures below `src/` and `tests/` are ignored.

A child unit discovered through parent ID `P` must declare an ID beginning
with `P.`. A mismatch is fatal before import. Enabling `P` selects its
non-disabled descendants in parent-first order; a disabled unit blocks its
whole subtree. An explicitly disabled child remains allowed under an enabled
parent.

Bundled child production code may import only its direct ancestor's named
`<name>.ts` entry when that entry exposes an explicitly shared family boundary.
It may not import the ancestor's private `src/`, a sibling plugin, or any other
plugin implementation. The providers family uses this narrow exception for its
shared transport and environment utilities; the architecture checker enforces
the same boundary.

## Bundled and installed roots

- `src/plugins/` contains PixieCore's compiled, locked, trusted plugins.
- `src/plugins/recipe/` contains the non-disableable plugin that provides the
  locked standard Recipe. Its lock is enforced by policy like the other bundled
  core plugins, not by a separate source root.
- repository-root `plugins/` contains project-local third-party installations,
  normally directory symlinks, and is excluded from the npm package.
- extra managed roots may be declared in `pixiecore.plugins.yml`.

Build tooling reads `package.json` field `pixiecore.plugins: "./plugins"` as the
root unit's source-relative child slot, resolving it from `src/`. Runtime
managed discovery continues to resolve the repository-root installation slot
from the activation-state location; the two roots have distinct trust policy.

The project-local root is discovered even without a state file, but every
third-party candidate remains disabled until its ID is enabled. Passing
`pluginConfigPath: 'disabled'` bypasses managed discovery entirely.

## Test ownership

Put a test in `<unit>/tests/` when its primary subject belongs to that plugin.
Contract, integration, architecture, and internal test kinds may be represented
below that directory. Recursive test collection ensures nested bundled units
participate in the same category and coverage commands.

The repository-level `tests/` directory is the shared test platform. It owns:

- reusable helpers and audited fixtures;
- bootstrap, catalog, package, and repository architecture tests;
- public root-export and compatibility tests;
- scenarios that intentionally span several plugins;
- opt-in whole-product smoke tests.

A plugin test may consume shared helpers from `tests/helpers/`, but shared tests
must use public or bootstrap boundaries instead of reaching into an unrelated
plugin's private `src/` directory.

## Managed and legacy compatibility

Managed discovery prefers `<name>.yaml` when it exists. Existing managed
projects using `plugin.yml` remain loadable, and legacy `pluginsDir` discovery
continues to accept `plugin.yml` and `plugin.yaml`. Those filenames are
compatibility inputs, not the source layout recommended for new plugins.

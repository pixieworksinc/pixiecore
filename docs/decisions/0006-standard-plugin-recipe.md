# TC-ADR-0006: Compose the locked foundation with a Recipe

- Status: accepted
- Date: 2026-08-27
- Participants: `@naoi`
- Conflicts and recusals: none disclosed
- Related: `MOD-05`, `KRN-001`, `REC-001` through `REC-004`, `MODPLUG-001`
- Supersedes: none
- Superseded by: none

## Context

The `core/preset` layer had two unrelated meanings. It contained public
compatibility facades, and it selected the bundled plugins that form the
standard PixieCore runtime. The word `preset` did not explain installation,
mandatory membership, activation, or lifecycle ownership.

The project also considered adopting a Drupal-style two-level Module and
Plugin model. The current flat plugin unit already owns distribution,
dependencies, trust, activation, and cleanup, while its contribution
registries hold providers, roles, tools, and decorators. Renaming and splitting
those concepts now would add migration cost before a concrete consumer needs
independently discovered inner plugins.

## Options considered

1. Keep the standard composition as implicit constructor logic called a preset.
2. Replace every public preset facade and every plugin unit immediately with a
   Drupal-style Module and Plugin hierarchy.
3. Introduce a declarative Recipe for standard composition, preserve public
   compatibility facades, and defer the Module and Plugin split.

## Decision

Adopt option 3.

`src/core/plugins/recipe/recipes/pixiecore.recipe.yaml` is the canonical list of
plugins in the locked PixieCore foundation and the constructor-visible
activation roots. The Recipe is validated against the generated plugin catalog
at build time and compiled into an immutable TypeScript definition.

`pixiecore.recipe` is the sole mandatory plugin under `src/core/plugins`. The
generated catalog places it before the ordinary bundled plugins under
`src/plugins`. The public compatibility `PluginManager` activates only this
bootstrap plugin directly, resolves its Recipe service, and applies the
standard Recipe returned by that service. The standard Recipe includes
`pixiecore.recipe` itself, so the resulting locked status describes the complete
foundation. Repeated activation remains idempotent.

Recipe mechanics live under
`core/bootstrap/plugin-manager/recipe`. They create and apply a plan but do not
own a second catalog, registry, dependency graph, status tracker, or lifecycle.
The existing `PluginManager` remains the only lifecycle owner.

Recipe planning and application remain bootstrap infrastructure. The data and
service that select the standard composition belong to the mandatory Recipe
plugin. This avoids a bootstrap cycle because core knows only how to activate
the fixed `pixiecore.recipe` entry; the plugin does not load itself or own a
second manager. The standard Recipe is locked and cannot be disabled through
managed custom-plugin state.

The public files under `core/preset` remain compatibility facades during 0.1.x.
Their physical relocation and the removal of the `preset` directory require a
separate compatibility plan.

The Module and Plugin split is placed on hold. It may be reopened when at least
one real extension needs all of the following:

- one distribution and lifecycle unit providing several independently
  discoverable implementations;
- selection or replacement below the current plugin-unit boundary;
- metadata and management at both the package and implementation levels.

## Compatibility and migration

The root `PluginManager`, `PromptRuntime`, CLI, API, and package subpaths retain
their current public behavior. Existing core contributions remain visible
immediately after public manager construction. Custom managed plugins retain
their existing enable, disable, trust, load, and cleanup behavior.

The generic bootstrap manager changes only at an internal seam: an injected
synchronous catalog no longer activates implicitly. Its caller must apply a
validated Recipe or activate explicit roots.

## Consequences

Standard composition becomes declarative, reviewable, and drift-checked. Core
knows one non-disableable plugin ID instead of the full bundled composition.
Recipe application reuses the existing dependency resolver and lifecycle
instead of adding an orchestration layer.

The word `preset` remains temporarily visible in source and distribution paths.
Application-level Recipes, configuration mutation, downloads, and a general
Module API are not introduced by this decision.

## Evidence

- Recipe generation rejects catalog omissions, unknown plugin IDs, duplicate
  IDs, stale generated output, and version drift.
- Runtime planning rejects missing parents, missing required dependencies, and
  activation roots outside the Recipe.
- Applying the same plan repeatedly is idempotent and preserves the existing
  constructor-visible core contributions.
- The architecture checker permits only `src/core/plugins/recipe` and rejects
  any other plugin below `src/core/plugins`.

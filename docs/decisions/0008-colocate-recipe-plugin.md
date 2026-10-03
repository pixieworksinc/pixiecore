# TC-ADR-0008: Co-locate Recipe with bundled plugins

- Status: accepted
- Date: 2026-08-27
- Participants: `@naoi`
- Conflicts and recusals: none disclosed
- Related: [TC-ADR-0006](0006-standard-plugin-recipe.md), [TC-ADR-0007](0007-remove-preset-layer.md), `CLN-005`, `CLN-006`
- Supersedes: the Recipe plugin placement under `src/core/plugins` in TC-ADR-0006
- Superseded by: none

## Context

The mandatory Recipe used the same entry, manifest, source, tests, activator,
catalog definition, registries, and lifecycle as every bundled plugin. Its
physical location under `src/core/plugins/recipe` nevertheless required a
second source classification, a catalog insertion special case, duplicate test
globs, separate package-copy logic, and a dedicated dependency rule.

Mandatory activation and non-disableable status are behavioral policy. A
directory name does not enforce either property.

## Options considered

1. Keep Recipe under `src/core/plugins` as a visual marker of mandatory status.
2. Move Recipe to `src/plugins/recipe` but retain its special catalog entry.
3. Move Recipe to `src/plugins/recipe`, discover it through the same catalog
   path as all bundled plugins, and keep only the required activation policy.

## Decision

Adopt option 3.

All bundled plugin units live under `src/plugins`. `pixiecore.recipe` is found,
validated, generated, packaged, and checked by the same mechanisms as the
other eighteen units. There is no `src/core/plugins` source layer and no
Recipe-specific static catalog entry.

`PluginManager` still activates `pixiecore.recipe` by its fixed ID before it
applies the standard Recipe. The Recipe includes itself in its locked plugin
set. Managed state cannot disable or replace bundled `pixiecore.*` plugins.

## Compatibility and migration

The relocation did not change the public package specifier at the time. A later
PXC-008 npm identity decision on 2026-09-29 changed that specifier from
`pixiecore/recipe/standard.yaml` to `@pixieworks/pixiecore/recipe/standard.yaml`.
Its private distribution target moves from `dist/core/plugins/recipe` to
`dist/plugins/recipe`. Runtime exports, status, activation order, Recipe data,
and lifecycle behavior remain unchanged.

## Consequences

The source tree now communicates one plugin model. Catalog generation handles
nineteen manifests through one loop. Architecture checking no longer needs a
`core-plugins` layer or a Recipe-only dependency rule. Test and coverage globs
scan one bundled plugin root.

The fixed Recipe ID remains a deliberate policy constant in the public
composition manager. This is the only special treatment required to bootstrap
the Recipe service.

## Evidence

- Catalog drift checks report nineteen canonical manifests and nineteen locked
  Recipe entries.
- Architecture tests reject any plugin unit below `src/core` and apply the
  ordinary plugin boundary to Recipe.
- Package verification requires Recipe entry, manifest, generated data, and
  standard YAML below `dist/plugins/recipe` while preserving the public export.
- Runtime tests verify Recipe-first activation and locked status.

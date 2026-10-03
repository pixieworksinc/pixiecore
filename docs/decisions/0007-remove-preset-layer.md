# TC-ADR-0007: Remove the redundant preset layer

- Status: accepted
- Date: 2026-08-27
- Participants: `@naoi`
- Conflicts and recusals: none disclosed
- Related: [TC-ADR-0006](0006-standard-plugin-recipe.md), `CLN-001` through `CLN-004`
- Supersedes: the temporary preset-directory compatibility choice in TC-ADR-0006
- Superseded by: none

## Context

TC-ADR-0006 moved selection of the locked standard composition into the
mandatory Recipe plugin but temporarily retained `src/core/preset`. That
directory then held two kinds of files: substantive public execution facades
and thin wrappers that only re-exported bundled plugin entries. The word
`preset` no longer described any owned behavior.

Keeping both `kernel` and `preset` forced readers and the architecture checker
to distinguish layers whose responsibilities had already converged. It also
emitted avoidable JavaScript and declaration files in the package.

## Options considered

1. Keep `preset` as a permanent compatibility directory.
2. Rename it while retaining all wrappers.
3. Move substantive public execution and composition entry points to `kernel`,
   remove thin wrappers, and preserve public package specifiers and root export
   names.

## Decision

Adopt option 3.

`src/core/kernel` is the public execution and composition layer. It may depend
on components, contracts, bootstrap services, kernel internals, and direct
plugin entry points. It may not import plugin leaf implementation files.

The package root may re-export contracts, kernel entry points, and direct
bundled plugin entries. Bundled plugins remain unable to import the kernel.
The mandatory Recipe plugin remains the sole owner of the locked standard
composition.

## Compatibility and migration

Public package specifiers, exported names, CLI behavior, API behavior, and
runtime behavior remain unchanged. Internal distribution targets move from
`dist/core/preset` to `dist/core/kernel`. Consumers that deep-imported an
undeclared internal `dist/core/preset` path are unsupported and must use the
documented package exports.

## Consequences

There is one fewer architectural layer and no compatibility-only re-export
directory. Eight source wrappers and their emitted JavaScript and declaration
files disappear. The kernel dependency rule becomes slightly broader but more
precise: direct plugin entries are allowed and plugin leaf imports are rejected.

Historical planning and decision documents may still mention `preset` when
describing the migration. Current architecture and user documentation do not.

## Evidence

- The architecture checker accepts direct kernel-to-plugin entry imports and
  rejects kernel-to-plugin leaf imports.
- Package verification requires the generated catalog under `core/kernel` and
  rejects the removed `core/preset` directory.
- Public export contract tests preserve the root and package-subpath surface.

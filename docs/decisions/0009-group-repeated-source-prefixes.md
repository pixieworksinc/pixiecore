# TC-ADR-0009: Group repeated production source prefixes

- Status: accepted
- Date: 2026-08-27
- Participants: `@naoi`
- Conflicts and recusals: none disclosed
- Related: [TC-ADR-0007](0007-remove-preset-layer.md), `CLN-007`, `CLN-008`
- Supersedes: none
- Superseded by: none

## Context

After removing the preset layer, several production directories still used
filename prefixes as an implicit substitute for module ownership. Examples
included `evaluation-*`, `application-*`, `managed-*`, and `dependency-*`.
This made large directories harder to scan and repeated context already suited
to a directory name.

Tests use repeated subject prefixes for a different reason: their category
directory records test ownership while the filename identifies the subject.
Generated sources also follow generator-owned naming contracts.

## Decision

When production TypeScript files share a direct parent and either two files use
the same `prefix-*` form or a `prefix.ts` file has a `prefix-*` companion, move
the family below `prefix/` and remove the repeated prefix from child names.

Use `index.ts` only when the former `prefix.ts` file is the natural public or
internal facade. When the enclosing directory already supplies the context,
such as `plugin-manager`, shorten redundant `plugin-*` filenames directly.

Exclude owned test trees and generated trees from this rule. Preserve public
package specifiers and exported names when physical distribution targets move.

## Consequences

Bootstrap, contracts, and kernel directories become navigable by responsibility
rather than filename sorting. Relative imports become one level deeper inside
submodules, but architecture ownership becomes explicit. The architecture
checker rejects future ungrouped prefix families before they accumulate.

## Compatibility

No documented package specifier or export name changes. Internal `dist/` paths
move and remain unsupported for direct consumer imports. Package verification
continues to assert every documented target and runtime export surface.

## Evidence

- TypeScript source and test projects resolve only the new paths.
- The architecture checker has positive and negative prefix-layout fixtures.
- Full tests, coverage, build, and installed-package verification cover the
  public surfaces after relocation.

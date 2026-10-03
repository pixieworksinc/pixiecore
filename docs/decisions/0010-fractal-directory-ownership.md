# TC-ADR-0010: Use fractal directory ownership

- Status: accepted
- Date: 2026-08-28
- Participants: `@naoi`
- Conflicts and recusals: none disclosed
- Related: [TC-ADR-0009](0009-group-repeated-source-prefixes.md), `CLN-007`, `CLN-008`
- Supersedes: none
- Superseded by: none

## Context

Repeated filename prefixes were moved into responsibility-owned directories,
but several non-leaf directories still mix many implementation files with many
child directories. In those locations the filesystem no longer communicates a
clear ownership tree. A reader must inspect filenames and imports to discover
the structure that the directory hierarchy should already express.

PixieCore is intended to remain fractal. The same ownership grammar should be
visible at repository, core layer, plugin, subsystem, and implementation-leaf
levels.

## Decision

Organize source and maintained documentation as a recursively self-similar
tree of ownership boundaries.

1. A non-leaf directory primarily owns child responsibility directories.
2. A leaf directory owns the implementation files for one cohesive
   responsibility and normally owns no child responsibility directory.
3. A non-leaf may retain only structural boundary files whose location is part
   of the architecture, such as an `index.ts` entry, one public facade, or a
   plugin identity manifest and entry file.
4. When a non-leaf contains three or more non-structural implementation files
   beside child directories, split those files into responsibility-named child
   directories before adding more peers.
5. Do not create one-file wrapper directories merely to satisfy a file-count
   rule. Every directory must name a stable responsibility, policy boundary,
   lifecycle, or public entry point.
6. Avoid generic `common`, `misc`, or `utils` directories. Shared code belongs
   to the smallest named responsibility that owns its contract.
7. Tests mirror the responsibility tree of the code they own. Documentation
   mirrors the conceptual ownership tree rather than accumulating in one flat
   directory.

The bundled and third-party plugin root is a canonical fractal unit:

```text
plugins/<name>/
├── <name>.ts
├── <name>.yaml
├── src/
└── tests/
```

The two files identify the boundary; `src/` recursively applies this decision
to implementation ownership, and `tests/` owns that plugin's tests. This
required shape is not treated as accidental file-and-directory mixing.

## Consequences

- Directory traversal communicates the architecture before individual files
  are opened.
- Large namespace directories become smaller responsibility trees.
- New work must not add peers to an already mixed non-leaf directory.
- Existing mixed directories are migrated in bounded steps with public export,
  error, lifecycle, and package checks at each step.
- Physical moves may increase relative import depth, but must not add empty
  compatibility wrappers or unsupported public paths.

## Compatibility

The directory policy does not itself change a documented package specifier,
runtime export, plugin identity, Recipe lock, Blueprint contract, or error
contract. Each physical migration must preserve those surfaces or record a
separate compatibility decision.

## Evidence

- TC-ADR-0009 and the existing source-prefix architecture check establish that
  responsibility directories can replace filename-based ownership without
  changing public package specifiers.
- The plugin layout already demonstrates the same boundary grammar recursively
  for bundled and third-party units.
- Kernel public capabilities and contracts now live in responsibility-named
  leaf directories. Plugin-manager implementation is grouped by activation,
  authoring, catalog, dependency, managed policy, model, Recipe, and registry
  ownership.
- CLI, Validation, Anthropic, and Gemini plugin implementation roots retain
  only structural entries beside responsibility directories. Legacy plugin
  smoke tests moved into their owning test categories.
- The architecture checker rejects future non-leaf implementation crowds while
  preserving canonical plugin and facade boundaries.

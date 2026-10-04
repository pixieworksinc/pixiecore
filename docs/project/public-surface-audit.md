# Public surface audit

This report records the repository-owned consumer view of the PixieCore package
surface at `0.1.0`. It is an inventory and retention record, not permission to
remove an exported path. A repository scan cannot discover downstream users.

## Method

The audit reads `package.json` `exports` and scans TypeScript and JavaScript
under `src/`, `tests/`, and `examples/` for package specifiers. It separates
executable entry points from data assets because schema and conformance assets
are normally loaded by a package user rather than imported by PixieCore itself.
The scan therefore answers only whether this repository exercises an exported
path, not whether an external user relies on it.

## Inventory

| Surface | Count | Repository-owned evidence | Retention decision |
|---|---:|---|---|
| Executable entry points | 17 | Root and every listed subpath are fixed by `tests/contract/public-exports.contract.test.ts`; examples additionally import the root, `application`, `eval`, `plugin`, and `telemetry` paths. | Retain. Each is a declared runtime contract. |
| JSON Schema assets | 34 | Contract tests compile or validate the corresponding artifacts, and package verification confirms they ship in the tarball. | Retain. A schema is a machine-readable external contract, not an internal module dependency. |
| Conformance suite assets | 2 | Portable-conformance tests read and validate the suites, and independent adapters consume them. | Retain. They are language-neutral interoperability fixtures. |
| Standard Recipe YAML | 1 | Core Recipe generator, Recipe schema tests, and package verification validate it. | Retain. It fixes the mandatory core composition. |
| Package metadata | 1 | Node package resolution and package verification consume it. | Retain. It is the package boundary itself. |

The inventory is 55 declared export paths: 17 executable entries and 38 data
assets. The data-asset count is 34 schemas, two conformance suites, one Recipe,
and `package.json`.

## Executable entry points

| Group | Export paths | Retention evidence |
|---|---|---|
| Runtime foundation | `@pixieworks/pixiecore`, `@pixieworks/pixiecore/api`, `@pixieworks/pixiecore/plugin`, `@pixieworks/pixiecore/mcp-server` | Public runtime, HTTP, custom-plugin, and MCP contracts. |
| Application and data policy | `@pixieworks/pixiecore/application`, `@pixieworks/pixiecore/cache`, `@pixieworks/pixiecore/data-policy`, `@pixieworks/pixiecore/rag`, `@pixieworks/pixiecore/telemetry` | Composition, cache, retention, retrieval, and execution-record contracts. |
| Evaluation and portability | `@pixieworks/pixiecore/eval`, `@pixieworks/pixiecore/conformance`, `@pixieworks/pixiecore/fallback`, `@pixieworks/pixiecore/jit` | Evaluation, cross-runtime, fallback, and deterministic-promotion contracts. |
| Governance and operations | `@pixieworks/pixiecore/adoption/snapshot-schema.json` schema asset, `@pixieworks/pixiecore/audit`, `@pixieworks/pixiecore/apisix`, `@pixieworks/pixiecore/blueprint-packages`, `@pixieworks/pixiecore/review` | Adoption evidence, signed audit records, gateway configuration, package lifecycle, and human review. |

`@pixieworks/pixiecore/adoption/snapshot-schema.json` is data-only, so it belongs to the schema-asset count rather
than the 17 executable entries.

## Findings

1. No executable export is untested in the repository. The public-export
   contract deliberately imports all 17 executable entry points and fixes their
   symbol snapshots.
2. Most schema paths have no direct source-code import using their package
   specifier. This is expected. They are delivered for external validation,
   editors, independent runtimes, and generated artifacts, while PixieCore tests
   load the canonical source artifact directly.
3. A zero repository-specifier count is not a deletion signal. Deletion requires
   a release decision, an external-consumer search where available, a documented
   replacement or deprecation path, and a package-level compatibility review.

## Follow-up policy

Before a future public-surface reduction, create one new backlog item per
candidate and record all of the following:

1. the export path and its semantic versioning impact;
2. repository evidence, downstream usage evidence, or the reason that evidence
   is unavailable;
3. an explicit retain, deprecate, or remove decision;
4. the required migration and conformance changes; and
5. installed-package verification after the change.

Until that record exists, every path in this audit remains retained.

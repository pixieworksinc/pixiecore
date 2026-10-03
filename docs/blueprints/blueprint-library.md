# PixieCore reference Blueprint library contract

This document defines the repository and package contract for PixieCore's
first-party reference Blueprint library. It covers directory layout, stable
identity, naming, versioning, ownership, and deprecation. It does not make every
third-party Blueprint part of the PixieCore standard library.

The machine-readable source of the current inventory is
[`examples/blueprints/catalog.yaml`](../../examples/blueprints/catalog.yaml).
The repository-owned [searchable catalog](../../examples/blueprints/catalog-site/README.md)
combines that inventory with Blueprint schemas and explicit quality evidence.

## Directory and artifact contract

Every library unit has this path:

```text
examples/blueprints/<role-family>/<unit-slug>/
├── <unit-slug>.yaml
├── README.md
├── evaluations/
│   └── <unit-slug>.yaml
├── tests/
│   └── <unit-slug>.contract.test.ts
├── fixtures/                  # required when external policy/data/files exist
└── scripts/                   # optional reproducible fixture generation only
```

The Blueprint, policy explanation, semantic dataset, expected outputs, and
offline contract test are owned as one change unit. A fixture directory is
required when the evaluation depends on data not fully contained in the
dataset, such as PDFs, images, policies, or CSV tables. Generated fixtures must
have a checked-in generator when practical.

These files are package content. Consumers can inspect and run them after
installation; package verification compares every packed byte with the source
tree.

## Stable identity and naming

The stable library ID is `<role-family>/<unit-slug>`, for example
`converter/date-normalizer`. Both segments use lowercase ASCII kebab-case and
must match the physical path. Renaming either segment creates a new ID; Git
history or a redirect does not preserve the old contract.

The role-family segment describes the primary cognitive operation. The unit
slug describes its bounded object or policy. Combined public labels use one
canonical directory family: Translator / Localizer uses `translator`, and
Router / Orchestrator uses `router`.

Human-readable Blueprint `name` values may change without changing the stable
ID when their meaning remains equivalent. File names, catalog paths, dataset
paths, and contract-test names must match the unit slug exactly.

## Version layers

Four versions are intentionally independent:

| Layer | Location | Meaning |
|---|---|---|
| Package | `package.json` | PixieCore runtime and packed-library release |
| Library catalog | `examples/blueprints/catalog.yaml` | Catalog contract and inventory shape |
| Quality catalog | `examples/blueprints/quality-catalog.yaml` | License and explicitly scoped evaluation evidence |
| Blueprint unit | Blueprint `version` and catalog entry | One unit's input, output, and semantic behavior |
| Evaluation/policy | Dataset and caller-supplied fixture versions | Regression corpus and independently changing business policy |

Catalog and first-party library unit versions use complete SemVer 2.0.0. A
dataset pins the exact Blueprint version it evaluates. Applications should pin
an exact unit version until they have evaluated a newer one.

## Quality catalog

The machine-readable quality catalog is validated by
`@pixieworks/pixiecore/blueprint/quality-catalog-schema.json`. Every measurement names its
evidence kind, provider, tested model, dataset path and version, score, passed
and total cases, run count, and evidence path. Each unit also states its
license.

Every entry includes an `offline_contract` measurement from deterministic
fixture Providers. They prove repository contract behavior and are not remote
model quality claims. A `remote_provider` entry additionally requires a
published benchmark artifact. The initial public catalog contains deterministic
offline-contract measurements only. A later remote-provider entry must preserve
its provider, pinned model, corpus versions, pass counts, and known limitations
without storing prompt or data values.

An `evidence_status: historical` marker means the referenced result remains
auditable, but its dataset or comparison policy is no longer the active one.
Historical remote evidence is displayed with that label and excluded from the
default provider and score filters. A fresh authorized run must replace it
before the catalog can make a current remote-quality claim for that unit.

## Searchable catalog

`examples/blueprints/catalog-site` is a dependency-free static site that can be
served locally or copied unchanged to static hosting. It searches by declared
use case, schema term, quality-evidence kind, provider, license, and minimum
score. Its `catalog.json` is generated deterministically from the library and
quality catalogs plus the referenced Blueprint schemas.

The generator fails when a searchable unit lacks quality evidence or declared
use cases. CI also rejects generated-catalog drift. The site does not turn
offline fixture scores into remote-provider claims, and it does not introduce a
hosted registry, account system, telemetry collector, or network dependency.

For a library unit:

- Major: removes or renames inputs/results, changes schema meaning, changes a
  status interpretation, or otherwise makes an existing valid call incompatible.
- Minor: adds a compatible capability without changing existing input meanings
  or expected results. A strict output object cannot gain fields merely because
  they look optional to the producer; consumers may perform exact validation.
- Patch: corrects documentation, prompts, fixtures, or implementation while
  preserving the declared contract and passing the existing regression corpus.

Any intended semantic behavior change requires a new expected-result review,
even when its SemVer classification is patch-compatible.

## Ownership

The catalog `owner` is an accountable repository ownership token, not a package
scope or runtime permission. Current first-party units are owned by
`pixiecore-maintainers`. Owners must review contract meaning, schema changes,
evaluation evidence, fixture rights, and deprecation metadata together.

A unit cannot be added by copying YAML alone. Its owner must accept the complete
artifact contract and keep offline tests credential-free. Ownership transfer is
a catalog change reviewed by both the previous and new owner when the previous
owner is available. Third-party units remain third-party even when PixieCore can
load or execute them.

## Deprecation and removal

Deprecation never silently reuses a stable ID:

1. Change catalog `status` from `active` to `deprecated` and set `replacement`
   to another stable ID when one exists.
2. Document the migration and first deprecated package version in the unit
   README and CHANGELOG.
3. Keep the Blueprint, evaluation corpus, fixtures, and offline contract test
   passing throughout the announced support window.
4. Retain a deprecated unit for at least one subsequent package minor release.
5. Remove it only in a package major release, except when continued distribution
   creates a security, legal, or data-rights risk. Exceptional removal must be
   called out in release notes.

`retired` catalog records may preserve identity history after physical removal,
but an active or deprecated record must resolve to its complete unit directory.
A replacement receives its own ID and version history.

## Automated enforcement

The architecture contract test verifies catalog uniqueness, naming, SemVer,
ownership/status metadata, exact paths, required artifacts, Blueprint/dataset
version agreement, and one-to-one correspondence between active directories
and catalog entries. Documentation drift and packed-artifact checks verify links
and distribution.

The repository-level `check:blueprint-versions` gate compares changed Blueprint
YAML with its Git base. It rejects content changes without a forward version
bump and conservatively requires a major bump for role, input, output, tool,
permission, or stable-path changes. It ignores comments and formatting. Removal
requires the PixieCore package major version to advance and remains subject to
the deprecation process above.

Adding or changing a library unit is complete only when type-checking,
architecture checks, offline contract tests, documentation checks, and package
installation verification all pass.

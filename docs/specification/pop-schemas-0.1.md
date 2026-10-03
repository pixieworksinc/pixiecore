# POP 0.1 serialization schemas

The POP 0.1 schemas define portable JSON artifacts for exchanging one
Blueprint, its semantic evaluation data, evaluation results, and data-only
distribution metadata. They accompany the
[POP Core Specification 0.1](pop-core-specification-0.1.md) and use JSON Schema
Draft 2020-12.

These schemas describe interoperability boundaries. They do not select a
runtime, host language, model provider, transport, local directory layout, or
workflow format.

## Published schemas

| Artifact | Schema identifier | Package export |
|---|---|---|
| Blueprint | `pop.blueprint/0.1` | `@pixieworks/pixiecore/pop/blueprint-schema.json` |
| Evaluation dataset | `pop.evaluation-dataset/0.1` | `@pixieworks/pixiecore/pop/evaluation-dataset-schema.json` |
| Evaluation result | `pop.evaluation-result/0.1` | `@pixieworks/pixiecore/pop/evaluation-result-schema.json` |
| Data-only package | `pop.blueprint-package/0.1` | `@pixieworks/pixiecore/pop/blueprint-package-schema.json` |

The language-neutral conformance suite has its own envelope schema,
`pop.conformance-suite/0.1`, published as
`@pixieworks/pixiecore/pop/conformance-suite-schema.json`. Its fixture data is published as
`@pixieworks/pixiecore/pop/conformance-suite.json`; see [POP Core 0.1 conformance
fixtures](pop-conformance-0.1.md).

The canonical repository files are:

- [`pop.blueprint-0.1.schema.json`](../../schemas/pop.blueprint-0.1.schema.json)
- [`pop.evaluation-dataset-0.1.schema.json`](../../schemas/pop.evaluation-dataset-0.1.schema.json)
- [`pop.evaluation-result-0.1.schema.json`](../../schemas/pop.evaluation-result-0.1.schema.json)
- [`pop.blueprint-package-0.1.schema.json`](../../schemas/pop.blueprint-package-0.1.schema.json)

## Stable identity

A portable Blueprint has a namespaced stable `id` and a full semantic
`version`. Datasets and results refer to that pair, not to a local filename.
Paths appear only inside package inventories, where they are relative to the
package root and cannot escape it.

The `pop.` identifier namespace is reserved for the specification. Publishers
must choose another namespaced identifier such as `example.date_converter`.

## Blueprint artifact

A Blueprint artifact declares exactly one cognitive operation. Its required
fields are `schema`, `id`, `name`, `version`, `role`, `instructions`, and
`output_schema`. `output_schema` must describe a JSON object. Optional
capabilities are explicit in `tools` and `requires`; vendor data belongs under
namespaced `extensions`.

The portable representation uses JSON Schema objects directly. A runtime may
support other authoring conveniences, but it must normalize those conveniences
before claiming that an artifact conforms to this schema.

## Evaluation artifacts

An evaluation dataset binds cases to one Blueprint `id` and `version`. Each
case contains JSON-object inputs, an expected JSON-object output, and an
explicit comparison policy. The standard policies are exact, schema-only,
selected-field, set-equivalent, numeric-tolerance, and namespaced custom
comparison.

An evaluation result records content hashes for its Blueprint and dataset. Its
summary and case records keep structural schema validity separate from
semantic validity. Case diagnostics contain codes, stages, and optional JSON
pointers, but not input or output values. Reproduction metadata is portable and
does not require a shell command.

## Data-only package artifact

A POP Blueprint package inventories declarative files by SHA-256 integrity,
declares POP compatibility, and may include package dependencies, provenance,
and an Ed25519 signature. It has no executable entry field. Executable runtime
extensions require a separate trust and distribution contract.

## Versioning

The artifact discriminator and schema `$id` both include `0.1`. A consumer must
reject an unsupported schema identifier rather than guessing a compatible
shape. Additive schema revisions may be published alongside 0.1; a breaking
revision must use a new versioned discriminator and schema identifier.

PixieCore's existing `pixiecore.*` schemas remain implementation contracts. They
are not aliases for the POP schemas. A conformance adapter must normalize local
paths, authoring conveniences, and implementation metadata into the portable
forms before validating them as POP artifacts.

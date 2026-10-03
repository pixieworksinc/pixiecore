# POP Core 0.1 conformance fixtures

The POP Core 0.1 conformance suite is a language-neutral JSON artifact for
checking validators and runtimes against the same observable cases. The
canonical suite is [`conformance/pop-0.1/suite.json`](../../conformance/pop-0.1/suite.json),
validated by [`pop.conformance-suite-0.1.schema.json`](../../schemas/pop.conformance-suite-0.1.schema.json).

Changes to fixtures, profiles, and conformance claim language follow the
[POP specification governance process](pop-governance.md).

The suite contains data, expected outcomes, and no executable test code. A
conformance harness may be written in any language.

## Package access

Installed consumers can import:

- `@pixieworks/pixiecore/pop/conformance-suite.json`
- `@pixieworks/pixiecore/pop/conformance-suite-schema.json`

The suite discriminator is `pop.conformance-suite/0.1`, and its specification
target is `pop-core/0.1`. A harness must reject an unsupported discriminator or
specification target instead of silently running a different suite.

## Fixture groups

### Validation

For each item in `validation`, select the published schema named by `artifact`,
validate `document`, and compare the Boolean outcome with `expected_valid`.
Diagnostic wording and validator-specific error paths are not conformance
requirements.

The artifact mapping is:

| `artifact` | Schema discriminator |
|---|---|
| `blueprint` | `pop.blueprint/0.1` |
| `evaluation_dataset` | `pop.evaluation-dataset/0.1` |
| `evaluation_result` | `pop.evaluation-result/0.1` |
| `blueprint_package` | `pop.blueprint-package/0.1` |

### Comparison

For each item in `comparison`, apply the declared comparison policy to
`expected_output` and `actual_output`. Compare the Boolean result with
`expected_semantic_valid`. Schema-mode cases use the supplied `output_schema`.

The 0.1 suite covers exact JSON equality, selected JSON Pointer fields,
set-equivalence, absolute and relative numeric tolerance, and schema-only
comparison. Namespaced custom comparators are intentionally excluded because
their behavior belongs to the extension publisher.

### Runtime boundary

For each item in `runtime`:

1. validate the Blueprint declaration;
2. validate `inputs` against `input_schema`, when present;
3. only after valid input, treat `generated_output` as the generation result;
4. validate that result against `output_schema`; and
5. compare the observed outcome and stage with `expected`.

`generated_output` is already a JSON value. The suite does not prescribe a
provider protocol, model, prompt envelope, or JSON-text parser. An input error
must occur before generation; an invalid generated result must not be reported
as success.

### Required capabilities

For each item in `capability`, compare the Blueprint's `requires` entries with
`supported_capabilities`. A missing required capability must be reported before
execution and must match `missing_capability`. Unsupported optional features
that do not appear in `requires` are not Core violations.

## Conformance claims

A POP Core 0.1 Validator claim must pass the suite schema and all validation
fixtures. A POP Core 0.1 Runtime claim must also pass comparison, runtime, and
capability fixtures. A result should identify the exact suite discriminator,
implementation name and version, profile, optional capabilities, and failed
fixture IDs.

Passing this suite demonstrates the covered portable boundaries. It does not
certify model quality, security of executable extensions, a provider
integration, or domain-specific semantic accuracy beyond these fixtures.

## PixieCore reference implementation

PixieCore publishes `runPopConformanceSuite()` from `@pixieworks/pixiecore/conformance`. The
runner loads the bundled JSON suite, validates all four portable artifact
types, calls PixieCore's public semantic comparators, and executes runtime cases
through `PromptRuntime` with an offline fixture provider. Input rejection is
verified to happen before generation, and invalid generated output is verified
not to become a successful result.

Run the repository and CI gate with:

```bash
npm run check:conformance
```

The command builds the current source, prints a value-free
`pop.conformance-report/0.1` JSON document, and exits nonzero if any fixture
fails. Its report schema is published as
`@pixieworks/pixiecore/pop/conformance-report-schema.json`. The report lists case IDs and
Boolean outcomes but never fixture inputs, generated output, or diagnostic
payload values.

## Independent Python validator

[`conformance/validators/python/pop_validator.py`](../../conformance/validators/python/pop_validator.py)
is a minimal second implementation written with the Python standard library.
It imports no PixieCore module, JavaScript package, JSON Schema library, or model
provider. It independently checks the portable artifact constraints needed by
the suite, implements the standard comparison modes, evaluates input/output
boundaries, and emits the same value-free report format.

Run it with:

```bash
npm run check:conformance:independent
```

This validator is deliberately a conformance probe, not a general-purpose JSON
Schema implementation or production model runtime. Its purpose is to fail CI
when the specification or fixtures accidentally depend on one host language or
on PixieCore internals. Both the PixieCore runner and the independent validator
must pass in CI.

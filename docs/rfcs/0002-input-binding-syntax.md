# POP-RFC-0002: Portable input binding syntax

- Status: draft
- Authors: naoi
- Change class: compatible normative
- Created: 2026-08-26
- Proposed review start: not started
- Decision date: not decided
- Discussion: not opened
- Affected artifacts: proposed POP Core 0.2 optional input-binding capability and conformance suite; POP Core 0.1 remains unchanged
- Conflicts and recusals: none disclosed
- Supersedes: none
- Superseded by: none

This draft has no normative effect. The capitalized requirements below describe
the contract that would apply only if this RFC is accepted and published in a
new POP minor line.

## Summary

Define `{{ name }}` as the portable serialized input-binding form for runtimes
that claim a proposed `pop.runtime.mustache-input-binding` capability. Define a
small identifier grammar, value serialization, declaration validation, and a
language-neutral data fixture. This is variable interpolation inspired by
Mustache, not a requirement to implement the complete Mustache language.

## Motivation and scope

Two runtimes can accept the same Blueprint shape while recognizing different
input references. Both can preserve instruction text correctly and still send
an unresolved token to the cognitive executor. Structural JSON Schema and
byte-preservation tests cannot detect that semantic mismatch.

The syntax must be implementable without TypeScript in Go, Rust, Java, Python,
and other host languages. A data-only fixture therefore defines observable
input and output strings rather than importing a reference implementation.

This proposal covers:

- serialized input-reference delimiters;
- portable input-name grammar;
- declaration validation;
- scalar, object, array, and null rendering; and
- preservation outside recognized reference spans.

It does not require Gherkin, full Mustache templates, HTML escaping, nested
property lookup, provider messages, a specific programming language, or a
specific serialization format.

## Specification

The proposed capability identifier is `pop.runtime.mustache-input-binding`.

A runtime claiming this capability MUST recognize a reference written as two
opening braces, optional ASCII space or tab characters, one portable input name,
optional ASCII space or tab characters, and two closing braces. The canonical
authoring form is `{{ name }}`. A reference cannot span a line boundary.

A portable input name MUST match `[A-Za-z_][A-Za-z0-9_]*`. Implementations MAY
accept additional names or delimiter forms as explicitly documented local
extensions, but MUST NOT emit them as portable artifacts or require them from
another conforming runtime.

Every recognized reference MUST name an input declared by the Blueprint.
Undeclared references MUST fail validation before any cognitive execution.
Duplicate input declarations MUST fail validation.

For a resolved value:

- a string MUST be inserted without surrounding quotes;
- a number or boolean MUST use its JSON lexical representation;
- an array or object MUST use compact JSON serialization;
- `null`, or a declared optional input with no value, MUST become the empty
  string; and
- no executable template expression or property traversal is permitted.

All text outside recognized reference spans MUST remain unchanged as defined by
POP-RFC-0001 if that RFC is also accepted. Text that resembles a JSON object but
does not match the reference grammar MUST remain literal text.

Triple braces, sections, comments, delimiter-changing tags, partials, lambdas,
and HTML escaping are outside this capability. An implementation MAY provide
them under a separately named extension, but portable fixtures do not use them.

## Compatibility and migration

This proposal is compatible for POP Core because it introduces an optional
capability only in a future minor line. POP Core 0.1 artifacts and conformance
claims remain unchanged.

PixieCore 0.x accepts `{name}` as a documented migration extension and accepts
flat dotted or hyphenated names for existing Blueprints. Its scaffold and
packaged examples emit only `{{ name }}` with portable names. A future removal
of either extension requires PixieCore's normal deprecation and version policy.
The provisional extension-aware identifiers are
`pixiecore.input-binding.single-brace/v1` and
`pixiecore.input-binding.flat-dotted-name/v1`. POP-RFC-0003 defines how such
identifiers remain visible without becoming portable Core requirements.

Other runtimes can migrate by accepting `{{ name }}` while retaining their old
syntax for local artifacts. A source-rewrite step is not required for existing
artifacts unless the runtime chooses to emit the portable capability claim.

## Security, privacy, cost, and interoperability

Declaration validation prevents unnoticed unresolved tokens and catches input
name mistakes before a provider call. Variable interpolation is not an
authorization or injection boundary. Applications still own input trust,
content policy, permissions, and provider data handling.

The fixture contains synthetic values, makes no network request, and has no
provider cost. Reports MUST NOT include production instructions, credentials,
or business inputs.

The restricted portable grammar avoids dependencies on one host language's
identifier, regular-expression, template-engine, or property-access rules.
Local extensions must remain distinguishable from portable claims.

## Conformance and independent evidence

PixieCore publishes a provisional data-only suite and JSON Schema at:

- `@pixieworks/pixiecore/instruction-template/conformance-suite.json`
- `@pixieworks/pixiecore/instruction-template/conformance-schema.json`
- `@pixieworks/pixiecore/instruction-template/conformance-report-schema.json`
- `@pixieworks/pixiecore/instruction-template/cross-runtime-comparison-schema.json`

The suite contains canonical spaced and compact references, scalar and JSON
values, null handling, surrounding-text preservation, declaration checks, JSON
literal rejection, and explicitly non-portable compatibility cases.

This draft does not yet constrain object-member order. Portable exact-string
cases therefore use single-member objects. A later revision must either adopt a
canonical JSON order or define a value-level comparison before using
multi-member objects as exact cross-runtime evidence.

### Provisional black-box adapter protocol

The provisional adapter protocol identifier is
`pixiecore.instruction-template-adapter/1`. It is PixieCore project evidence and
does not become a POP requirement while this RFC remains a draft.

An adapter command is invoked as:

```text
<adapter command> --suite <suite.json>
```

It MUST read the named JSON suite without rewriting it, MUST execute without
network access, and MUST write exactly one JSON report to standard output.
Diagnostics MAY be written to standard error. Exit status `0` means every
portable case passed, `1` means a valid report contains at least one failed
portable case, and `2` means the adapter could not read, validate, or execute
the suite. Extension failures are reported separately and do not invalidate a
portable capability claim.

Each render-case result records the rendered instruction, declared Blueprint
role, effective provider-message role, and provider request count. Each
validation-case result records whether the Blueprint was accepted, the
undeclared input names, any stable error code, and provider request count.
Rejected declaration cases MUST make zero provider requests. A report separates
portable cases from explicitly documented implementation extensions.

PixieCore's adapter is shipped at
`conformance/adapters/pixiecore-instruction-template.mjs`. It executes cases
through `PromptRuntime` with a capture provider rather than calling the renderer
as a test helper. Its result conforms to
`pixiecore.instruction-template-conformance-report/v1`.

The packaged runner at
`conformance/runners/compare-instruction-template-reports.mjs` validates two
independently produced reports and compares each case's expected and observed
rendering, Blueprint role, effective message role, provider request count, and
pre-provider validation result. Portable cases determine compatibility;
implementation extensions remain visible in a separate summary.

PixieCore contract tests generate a fresh local independent-runtime fixture
and compare it on every run. The initial public snapshot does not distribute an
external runtime report. A future independently maintained implementation may
publish a value-free report through the POP governance process without
weakening the portable claim.

Before this RFC can move beyond `draft`, the fixture identifiers must be moved
to a proposed POP version and an independent implementation report must be
reviewed through the POP governance process. PixieCore-only tests remain
implementation evidence.

## Alternatives

1. Keep placeholder spelling implementation-defined. Rejected for this proposal
   because schema-compatible artifacts can then fail only at execution time.
2. Standardize `{name}`. Rejected because single braces collide more easily
   with JSON, prose, and host-language formatting.
3. Require a complete Mustache engine. Rejected because sections, escaping,
   partials, and lambdas add behavior that POP input binding does not need.
4. Use a TypeScript reference package as the conformance oracle. Rejected
   because POP runtimes are not required to use TypeScript or JavaScript.

## Review record

- 2026-08-26: initial draft and provisional PixieCore data fixture; public
  discussion and review have not started.
- 2026-08-26: defined the provisional black-box command/report protocol and
  added a real-runtime PixieCore adapter; independent evidence remains open.
- 2026-08-31: compared a second runtime through the same data-only suite; all
  seven portable cases passed and one PixieCore-only dotted-name extension
  differed as expected.
- 2026-09-01: assigned stable PixieCore extension identifiers to the
  single-brace and flat-dotted-name compatibility cases.

## Final call

- Eligible maintainers: not determined
- Recused maintainers: none disclosed
- Votes: none
- Quorum result: not evaluated
- Approval result: not decided
- Unresolved objections: governance review and final POP fixture identifiers remain open

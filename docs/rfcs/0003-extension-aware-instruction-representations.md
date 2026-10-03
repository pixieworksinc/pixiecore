# POP-RFC-0003: Extension-aware instruction representations

- Status: draft
- Authors: naoi
- Change class: compatible normative
- Created: 2026-09-01
- Proposed review start: not started
- Decision date: not decided
- Discussion: not opened
- Affected artifacts: proposed POP Core 0.2 extension registration and extension-aware conformance reports; POP Core 0.1 remains unchanged
- Conflicts and recusals: none disclosed
- Supersedes: none
- Superseded by: none

This draft has no normative effect. The capitalized requirements below describe
the contract that would apply only if this RFC is accepted and published in a
new POP minor line.

## Summary

Keep the portable Blueprint instruction boundary as one decoded string for one
cognitive operation. Define how an implementation can identify and test a
namespaced instruction extension without presenting it as POP Core behavior.
Structured object-form scenarios remain extension-owned unless a later RFC
standardizes one exact data model and its deterministic string projection.

## Motivation and scope

Independent runtimes currently agree on portable Mustache-style input binding
but expose additional instruction forms. Examples include flat dotted input
names and object-form scenarios containing clauses, actor labels, or several
ordered stages. Reporting all of them only as `portable: false` reveals a
difference but does not identify the extension being compared.

Object-form scenarios also raise a separate semantic question. An object that
stages extraction, classification, and validation in one cognitive request is
not one small Blueprint operation under the POP Core boundary. Saving provider
round trips does not change that ownership boundary. Such a declaration is an
Application representation or an implementation-specific compound operation.

This proposal covers extension identity, Core projection, capability claims,
and extension-aware conformance reporting. It does not standardize Gherkin,
assign semantics to `Given`, `When`, `Then`, or `And`, prescribe an object-form
schema, or make a multi-operation prompt a Core Blueprint.

## Specification

An extension identifier MUST be globally distinguishable, lowercase, owned by
its publisher namespace, and versioned. The proposed serialized form is:

```text
<publisher>.<area>.<name>/<version>
```

For example, PixieCore's existing compatibility cases use:

- `pixiecore.input-binding.single-brace/v1`
- `pixiecore.input-binding.flat-dotted-name/v1`

A conformance fixture marked non-portable MUST state exactly one
`extension_id`. A portable fixture MUST NOT state an extension identifier.
Two reports may compare an extension case only when its case identifier, kind,
portable flag, and extension identifier agree. An extension failure MUST remain
visible but MUST NOT invalidate the portable POP capability summary.

An instruction-representation extension MUST publish:

1. its extension identifier and owner;
2. a versioned data schema;
3. whether support is optional or required by an artifact;
4. a deterministic projection to one decoded instruction string, or an
   explicit statement that no Core projection exists;
5. the effective Blueprint Role and cognitive request count;
6. validation failures that occur before cognitive execution; and
7. a language-neutral fixture when interoperability is claimed.

A runtime MUST NOT silently accept an unknown required extension. It MAY ignore
unknown optional extension metadata only when the portable instruction string
remains sufficient for execution.

### Object-form scenarios

An object-form scenario MAY be registered by its publisher as an instruction
representation extension. The registration MUST define clause order, array
order, whitespace, actor resolution, input binding, empty-clause behavior, and
the exact string projection observed by the cognitive executor.

The projected instruction remains one Core Blueprint only when the structured
form describes one independently meaningful cognitive operation with one Role,
one input boundary, and one output boundary. A structure that assigns separate
operations or Roles to ordered stages is an Application or compound extension.
It MUST NOT claim that the structure itself is a portable Core Blueprint.

Gherkin-inspired names are authoring vocabulary only unless their semantics are
defined by the extension. An extension MUST NOT describe an incompatible
meaning of a Gherkin keyword as plain Gherkin conformance.

## Compatibility and migration

POP Core 0.1 schemas, fixtures, reports, and claims remain unchanged. Existing
string-instruction Blueprints require no migration. Existing implementation
extensions gain stable identifiers in PixieCore's provisional extension-aware
suite without becoming portable requirements.

An object-form publisher can preserve its current representation by assigning
an owned identifier and publishing a projection fixture. If the object contains
several operations, migration to portable POP means moving orchestration into
an Application and publishing each independently evaluable operation as its own
Blueprint.

Rollback consists of removing the extension claim and using the portable
decoded instruction string. A runtime must reject an artifact that marks the
removed extension as required.

## Security, privacy, cost, and interoperability

Extension identity prevents a runtime from treating unrecognized executable or
structured content as harmless metadata. A structured form does not gain Tool,
network, filesystem, or authorization rights merely by being accepted.

Conformance fixtures use synthetic values and require no provider request.
Reports identify extensions and observable outcomes but MUST NOT contain
credentials or production business inputs.

Deterministic projection makes request count and delivered text reviewable.
Combining several operations into one request can reduce cost but weakens
independent evaluation, retry ownership, and failure attribution. This RFC does
not treat lower request count as evidence of a valid Blueprint boundary.

## Conformance and independent evidence

PixieCore's current provisional instruction-template suite emits an
`extension_id` on every non-portable case. Its existing v1 schemas accept an
unidentified legacy extension report for backward compatibility, while
rejecting extension IDs on portable cases. A future schema published with this
RFC would make the identifier required. The cross-runtime comparison rejects
reports that reuse one case identifier for different extensions. Portable and
extension summaries remain separate.

Current evidence covers PixieCore's single-brace and flat-dotted-name input
binding extensions. No object-form representation has been added to the
portable suite, and PixieCore does not claim to implement one.

Before this RFC can move beyond `draft`, it needs a proposed POP extension
registration schema, negative fixtures for missing and mismatched identifiers,
and an independently produced extension-aware report. Standardizing any
specific object form requires a separate RFC with its own schema and projection
evidence.

## Alternatives

1. Add the observed object form directly to POP Core. Rejected because no
   stable schema or shared semantics exist, and multi-operation forms conflict
   with the Blueprint boundary.
2. Treat every accepted runtime form as portable. Rejected because structural
   acceptance does not prove equivalent rendering or operation granularity.
3. Keep only a Boolean `portable` marker. Rejected because failures cannot be
   attributed to a stable extension contract.
4. Ban implementation-specific instruction forms. Rejected because POP permits
   namespaced extensions and experimentation is useful when claims stay scoped.

## Review record

- 2026-09-01: initial draft; registered PixieCore input-binding extension IDs
  and separated object-form instruction experiments from the Core Blueprint
  boundary.

## Final call

- Eligible maintainers: not determined
- Recused maintainers: none disclosed
- Votes: none
- Quorum result: not evaluated
- Approval result: not decided
- Unresolved objections: registration schema and independent object-form evidence remain open

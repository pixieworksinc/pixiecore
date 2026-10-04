# POP-RFC-0004: Restore prompt-first business logic

- Status: draft
- Authors: Codex, implementing project-owner direction from @naoi
- Change class: incompatible normative
- Created: 2026-10-04
- Proposed review start: not started
- Decision date: not decided
- Discussion: https://github.com/pixieworksinc/pixiecore/tree/0.2.x
- Affected artifacts: POP abstract model, Blueprint granularity, Role semantics;
  future portable specification and schemas
- Conflicts and recusals: no independent approval or community consensus claimed
- Supersedes: none; proposes replacement of the POP 0.1 conceptual restrictions
- Superseded by: none

## Summary

Define POP as direct LLM execution of prompt-defined business behavior, including
deterministic policies, and allow several reasoning Roles inside one Blueprint.
Do not require authors to partition logic into deterministic code and cognitive
functions.

## Motivation and scope

The supplied original specifications and presentations, together with the
owner's explicit clarification, establish the direction recorded in
[POP principles](../specification/pop-principles.md). The later one-cognitive-verb
restriction and ordinary-code recommendation changed the intended research
question. This proposal restores the original scope while preserving structural
validation, evaluation, transport, and capability controls.

## Specification

Proposed requirements for a future portable profile:

- A Blueprint MAY declare a deterministic business specification.
- A Blueprint MAY decompose that specification into ordered reasoning Roles.
- A runtime claiming the LLM-execution profile MUST deliver that business logic
  to the model and MUST NOT silently replace it with host-code policy execution.
- Runtime parsing, binding, structural validation, and explicit external
  capabilities MAY use ordinary code.
- A quality claim MUST distinguish structural validity from semantic accuracy
  and identify the evidence used.

The experimental PixieCore representation uses a structured Scenario object
that is serialized to instruction text. It does not establish a portable
serialization identifier or claim that array order guarantees model compliance.

## Compatibility and migration

Text Blueprints and registered Role plugin contracts remain supported. The
experimental validator returns normalized text in `Blueprint.prompt`, including
for structured source input. The current PixieCore schema alias points to a new
v2 asset; v1 remains separately exported and unchanged.

POP 0.1 identifiers, conformance claims, and independently validated fixtures
remain unchanged. This RFC does not amend them in place or claim completed
quorum. A future accepted incompatible portable specification needs its own
version, schemas, migration rules, and independent validation under existing
governance. A `0.2.x` runtime branch does not imply a portable POP 0.2 release.

Rollback restores the prior runtime and schema alias. A structured Blueprint
can be migrated to 0.1 by serializing its prompt as YAML text; the business
instructions stay in the prompt rather than being rewritten as TypeScript.

## Security, privacy, cost, and interoperability

Scenario Roles grant no plugin or tool access. Existing authorization,
tool allowlists, and output-schema validation still apply. No additional
external side effects or logging fields are introduced. Business instructions
and supplied inputs are visible to the selected model provider as before.

Model execution can cost more and be less reliable than ordinary arithmetic.
Repeated evaluation must measure those costs and failure rates. This proposal
preserves POP's experiment rather than making an unmeasured reliability claim.

## Conformance and independent evidence

- PixieCore v2 JSON Schema and runtime-validator positive/negative tests.
- Provider-capture tests for Role order, input binding, and a single invocation.
- A schema-valid wrong discount is returned unchanged by the runtime and
  rejected by semantic evaluation, proving there is no hidden host correction.
- An 18-case synthetic discount dataset covers Boolean boundaries and arithmetic.
- Real-model accuracy and independent portable-profile validation remain pending.

## Alternatives

Keeping only atomic cognitive operations would preserve the conceptual drift.
Rewriting deterministic logic as Tools would remove the requested LLM
accuracy challenge. Removing all runtime code would also remove the mechanics
needed to load Blueprints, call providers, and measure results.

## Review record

Initial implementation is confined to the owner-requested `0.2.x` development
branch. Formal portable review has not started.

## Final call

Not held. No votes, quorum, approval, or independent review are claimed.

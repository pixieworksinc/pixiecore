# TC-ADR-0011: Restore prompt-first POP on the 0.2 development branch

- Status: proposed
- Date: 2026-10-04
- Participants: @naoi (project direction), Codex (implementation)
- Conflicts and recusals: no independent review claimed
- Related: [POP-RFC-0004](../rfcs/0004-prompt-first-business-logic.md)
- Supersedes: none; inherited 0.1 records remain historical
- Superseded by: none

## Context

The project owner identified a drift from the original LLM-executed business
logic model to atomic cognitive functions combined with ordinary-code policy.
The owner requested a `0.2.x` branch to restore the original direction.

## Options considered

- Keep the one-cognitive-operation restriction and deterministic Tool guidance.
- Restore prompt-first business behavior, retaining compatible runtime mechanics.
- Discard the mature runtime and rebuild everything from the earliest snapshot.

## Decision proposed for development

Use the second option on `0.2.x`. Support several ordered reasoning Roles in a
Blueprint, including deterministic comparisons and calculations. Add structured
Scenario authoring as serialization to model instructions, with no host-code
business interpreter. Retain existing text prompts and Role plugin contracts.

The implementation is experimental branch work requested by the owner. This
record and the portable RFC remain proposed/draft; they claim no formal votes,
quorum, accepted portable specification, or production release.

## Compatibility and migration

The current Blueprint schema alias moves to a distinct v2 schema. An explicit
v1 schema export preserves the prior contract. Structured prompts are normalized
to text before existing Role plugins run. Published POP 0.1 artifacts and
conformance fixtures are unchanged. See the
[development plan](../project/0.2-development.md) for rollback and release work.

## Consequences

The branch restores the intended LLM accuracy experiment. A single invocation
does not guarantee the model follows every Role or performs correct arithmetic.
Existing evaluation machinery records those failures instead of concealing them
with a host-code result. Comparative real-model evidence and complete migration
of inherited examples remain follow-up work.

No new authorization capability, external side effect, logging field, or
credential requirement is introduced. Input and output contract enforcement
continues to use the existing runtime boundaries.

## Evidence

- [Original direction and source provenance](../specification/pop-principles.md)
- [Customer discount Blueprint and dataset](../../examples/customer-discount/README.md)
- [Provider-capture and error-detection tests](../../src/plugins/runtime/tests/contract/scenario-prompt.contract.test.ts)
- [Current and legacy schema tests](../../tests/contract/blueprint-schema.contract.test.ts)

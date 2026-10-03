# TC-ADR-0002: Adopt the POP specification change process

- Status: accepted
- Date: 2026-08-25
- Participants: `@naoi`
- Conflicts and recusals: none disclosed
- Related: `STD-006`
- Supersedes: none
- Superseded by: none

## Context

POP Core 0.1, portable schemas, and conformance fixtures are public, but their
first publication predates a defined proposal, vote, deprecation, and
project-name usage process. Applying a future multi-maintainer quorum to the
rule that creates that quorum would make initial adoption impossible.

## Options considered

1. Leave changes to ordinary repository permissions.
2. Let one maintainer approve every future change indefinitely.
3. Adopt a transparent bootstrap rule now, then require public review and
   multi-maintainer approval for breaking, governance, and name-usage changes.

## Decision

Adopt option 3 and publish [`docs/specification/pop-governance.md`](../specification/pop-governance.md).
This record is the sole bootstrap exception. Compatible normative proposals
require at least 14 days of public review. Incompatible, governance, and
project-name proposals require at least 30 days, at least two non-recused
release-capable maintainers, and two-thirds approval.

## Compatibility and migration

Existing POP Core 0.1 artifacts are unchanged. Future normative publications
must use immutable versioned identifiers. Deprecated portable artifacts remain
publicly addressable, with at least 180 days before active support withdrawal.

## Consequences

The current single-maintainer project can accept compatible proposals but
cannot finalize breaking, governance, or project-name changes until another
qualified maintainer participates. This intentionally favors legitimacy and
interoperability over unilateral speed.

## Evidence

- Contract tests verify review periods, quorum, versioning, deprecation, and
  project-name claim boundaries.
- The published POP 0.1 conformance suite and independent validator establish
  the evidence model required for later normative proposals.

# POP specification governance

This document governs changes to the implementation-independent
Prompt-Oriented Programming (POP) specification, portable schemas,
conformance fixtures, and related project-name usage. PixieCore implementation
changes remain subject to [PixieCore project governance](../../GOVERNANCE.md) and
the [release policy](../project/release-policy.md).

## Scope and authorities

The governed POP artifacts are:

- normative specification text;
- portable artifact schemas and their identifiers;
- conformance suite schemas, fixtures, profiles, and claim language;
- the standard Role and comparison vocabularies; and
- this change process and the project-name usage rules below.

An implementation, including PixieCore, may add namespaced extensions without
changing POP. An extension becomes portable only through this process.

## Change classes

Every proposal must declare exactly one primary class:

| Class | Meaning | Examples |
|---|---|---|
| Editorial | No normative meaning or observable conformance result changes | spelling, links, non-normative examples |
| Compatible normative | Adds an optional contract while preserving every conforming artifact and result | optional capability, new namespaced-neutral vocabulary |
| Incompatible normative | Can invalidate a conforming artifact, change a required result, or alter an existing field's meaning | required field, removed behavior, changed fixture outcome |
| Governance or name usage | Changes decision authority, process, conformance claims, or project-name rules | quorum, review period, badge policy |

When classification is disputed, the proposal uses the more restrictive class.
Splitting unrelated changes into separate proposals is required.

## Proposal lifecycle

Normative, governance, and name-usage changes use a public POP RFC:

1. Copy [`rfcs/0000-template.md`](../rfcs/0000-template.md), allocate the next
   four-digit identifier, and set the status to `draft`.
2. State the affected artifacts, change class, compatibility impact,
   alternatives, migration, conformance evidence, conflicts, and a stable
   discussion link.
3. A maintainer verifies that the proposal is complete and changes its status
   to `proposed`. The public review period starts on that recorded date.
4. Material revisions restart the review period. Editorial corrections do not.
5. After the review period, a non-recused maintainer records the final call,
   objections, votes, evidence, and resulting status.
6. Accepted changes land with specification text, schemas, fixtures,
   migration guidance, and decision records required by their scope.

RFC statuses are `draft`, `proposed`, `accepted`, `rejected`, `withdrawn`, and
`superseded`. Accepted RFCs are immutable except for clearly marked editorial
corrections. Changed decisions require a superseding RFC.

Editorial-only changes may use normal pull-request review. If an editorial
change can reasonably alter normative meaning, it must use an RFC.

## Review periods, quorum, and votes

Reasoned consensus is preferred. Silence is never a vote.

| Change class | Minimum public review | Quorum | Approval |
|---|---:|---:|---:|
| Compatible normative | 14 calendar days | All currently non-recused release-capable maintainers, minimum 1 | More than half of votes cast |
| Incompatible normative | 30 calendar days | At least 2 non-recused release-capable maintainers | At least two thirds of votes cast |
| Governance or name usage | 30 calendar days | At least 2 non-recused release-capable maintainers | At least two thirds of votes cast |

Abstentions count toward quorum but not approval. A tie rejects the proposal.
A conflicted maintainer discloses the conflict, does not vote, and does not
count toward quorum. If quorum cannot be reached, the proposal remains
`proposed`; urgency does not lower quorum.

The initial adoption of this document is a bootstrap exception recorded in
[TC-ADR-0002](../decisions/0002-pop-governance.md). After that adoption, changes
to these rules require the governance-or-name-usage threshold above.

## Evidence requirements

An accepted normative proposal must include:

- updated language-neutral schemas or fixtures when observable behavior
  changes;
- at least one passing reference implementation or harness;
- independent implementation or validator evidence for a portable Core
  requirement;
- negative cases for a newly prohibited behavior;
- migration and rollback instructions; and
- a statement of security, privacy, cost, and interoperability impact.

Evidence must identify exact artifact and suite versions. Model-quality claims
remain separate from structural conformance.

## Compatibility and versioning

Published POP identifiers are immutable compatibility boundaries.

- Editorial corrections may retain an identifier only when no normative
  meaning or conformance outcome changes; the correction must be logged.
- A compatible normative change publishes a new minor specification and
  artifact line.
- An incompatible normative change publishes a new major specification and
  artifact line.
- A consumer must reject an unsupported discriminator instead of guessing.
- A newer publication must not overwrite a schema, fixture, report schema, or
  specification document under an older identifier.

PixieCore package versions and POP specification versions are independent. A
PixieCore release must state which POP profiles it implements; matching version
numbers do not imply compatibility.

## Deprecation and withdrawal

A portable artifact, capability, or profile may be deprecated only by an
accepted RFC. The notice must name the replacement, migration path, first
deprecated publication, earliest withdrawal date, and known security impact.

The public deprecation period is at least 180 calendar days. An incompatible
replacement must be available throughout that period. Published schemas,
fixtures, and specifications remain archived and addressable after support
ends; withdrawal removes active support or recommendation, not historical
artifacts. A critical security issue may end active support earlier, but it
does not permit mutation or deletion of the published compatibility boundary.

## Conformance and project-name usage

POP and PixieCore are project names. This policy does not claim that either
name is a registered trademark, and no official logo or certification program
is established by this document.

Descriptive use is allowed, including:

- “implements POP Core 0.1” when the stated profile passes the exact published
  conformance suite;
- “compatible with POP Core 0.1” with the same evidence; and
- “built with PixieCore” when PixieCore is actually used.

Such claims must identify the profile, suite version, implementation version,
and result date, and must remain narrower than the evidence. Passing Core
fixtures does not imply model quality, extension security, or project
endorsement.

Without explicit written project authorization, third parties must not use
“official”, “certified”, “approved”, or confusingly similar package, domain,
organization, or product presentation that implies ownership or endorsement.
Forks and extensions must identify their own publisher. The software license
does not grant permission to imply project endorsement.

A future logo, certification program, domain policy, or formal trademark
adoption requires a separate accepted governance-or-name-usage RFC. Reports of
confusing or misleading use follow the public project contact path, without
publishing private personal information.

## Records and amendments

Accepted POP RFCs are indexed in [`docs/rfcs/`](../rfcs/README.md). Durable
governance choices are also recorded in [`docs/decisions/`](../decisions/README.md).
No merge, release, or repository-administration privilege bypasses this
process.

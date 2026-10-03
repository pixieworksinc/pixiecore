# Change review and ownership policy

This policy defines the evidence and ownership review required for Blueprint,
plugin, and POP specification changes. Automated checks prove structural
properties; reviewers remain responsible for meaning, rights, compatibility,
and risk.

## Ownership roles

Three ownership records have different purposes:

| Record | Meaning | Authority |
|---|---|---|
| GitHub `CODEOWNERS` | Requests review for affected repository paths | Does not grant merge or release authority |
| Blueprint catalog `owner` | Accountable token for one reference unit's contract and fixtures | Accepts semantic and data-rights maintenance |
| `MAINTAINERS.md` | Authoritative project roles, merge authority, and release authority | Controls merge and release decisions |

A plugin manifest ID or npm scope does not prove ownership. A cryptographic
signature proves control of a key, not the identity or trustworthiness of its
holder.

Ownership changes require an explicit pull request. Blueprint ownership
transfer updates the catalog and unit README and should be approved by both old
and new owners when the old owner is available. Maintainer or release-authority
changes additionally require a decision record. An unavailable owner is not
silently replaced; the pull request records contact attempts, interim owner,
scope, and follow-up decision.

## Review levels

- A compatible implementation or documentation change requires one maintainer
  approval after relevant automated checks pass.
- A public PixieCore contract, trust boundary, or security-default change
  requires a durable decision record and release-authorized maintainer review.
- A normative POP specification change follows the RFC voting, quorum,
  recusal, versioning, and conformance rules in
  [POP governance](../specification/pop-governance.md).
- An embargoed security fix follows [SECURITY.md](../../SECURITY.md) and uses
  private review until coordinated disclosure.

Authors do not approve their own change when another qualified reviewer is
available. While the project has only one qualified maintainer, that maintainer
may merge a non-normative change only after recording a self-review, every
required automated result, compatibility classification, and unresolved risk.
This exception does not satisfy RFC quorum or create a claim of independent
review.

## Checklist for every change

- State the problem, intended behavior, non-goals, and affected public surface.
- Classify compatibility and identify required version changes.
- Add or update tests proportional to behavior and failure risk.
- Use authorized, redistributable, non-secret fixtures and record provenance
  where it matters.
- Update public documentation, schemas, examples, changelog, and package
  inventory together when affected.
- Record security, privacy, data retention, cancellation, lifecycle, and
  rollback effects, or state why each is unchanged.
- Run the relevant repository gates and include failure replay seeds.
- Disclose conflicts and recuse where required.

## Blueprint review

A Blueprint change is accepted only when reviewers can answer all of these:

- Does the unit perform exactly one independently meaningful cognitive verb?
- Do typed placeholders, `input_schema`, and `output_schema` express the real
  caller and consumer contract without server-owned identity or secrets?
- Are unsupported, ambiguous, missing, and invalid inputs handled without
  hidden guessing?
- Do the policy README, evaluation dataset, fixtures, offline public-API test,
  catalog entry, and application mappings remain synchronized?
- Does the dataset cover ordinary, boundary, ambiguous, unsupported, and
  relevant failure cases with an explicit semantic comparison method?
- Are Blueprint, dataset, provider, model, seed, and run count stated for any
  quality claim?
- Does the version advance, and does a contract or stable-path change use a
  major Blueprint bump?
- Does the catalog owner accept semantic meaning, fixture rights, deprecation,
  and maintenance responsibility?

Prompt wording alone is not sufficient review evidence. The expected behavior
must be visible in schemas and versioned cases.

## Plugin review

A plugin is trusted executable code. Review must verify:

- the named entry, manifest, `src/`, and plugin-owned `tests/` layout;
- use of only supported `@pixieworks/pixiecore/plugin` authoring contracts;
- dependency, conflict, PixieCore compatibility, and contribution identities;
- activation scope, disabled behavior, resource ownership, reverse cleanup,
  cancellation, and failure isolation;
- requested tools, provider credentials, filesystem/network access, and every
  externally visible side effect;
- offline tests for every contribution plus installed-consumer activation;
- complete production-file inventory, provenance, license, checksum, and
  signature verification policy;
- upgrade, rollback, revocation, and compromised-publisher handling.

Passing schema validation does not make a plugin safe. Reviewers inspect all
distributed executable code and dependencies under the permissions of the host
process.

## POP specification review

A normative proposal must include:

- an RFC identifier, scope, abstract-model impact, alternatives, and non-goals;
- exact normative wording and affected versioned schema fields;
- compatibility class, deprecation and migration path, and rollback limits;
- positive and negative conformance fixtures with expected results;
- at least one implementation result and independent validation when required
  by the target conformance profile;
- security, privacy, portability, and implementation-neutrality analysis;
- named participants, conflicts, recusals, vote, quorum, and final status.

Implementation convenience in PixieCore is not by itself evidence for a
language-neutral POP requirement.

## Completion evidence

The pull-request template is the review handoff. A reviewer may mark an item
not applicable only with a short reason. Merge is blocked by failing required
CI, unresolved requested changes, missing required decision/RFC evidence, or an
unowned public artifact.

The complete release gate remains in the
[public-contract checklist](public-contract-checklist.md).

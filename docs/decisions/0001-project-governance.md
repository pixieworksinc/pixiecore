# TC-ADR-0001: Establish public project governance and decision records

- Status: accepted
- Date: 2026-08-25
- Participants: `@naoi`
- Conflicts and recusals: none disclosed
- Related: `GOV-001`
- Supersedes: none
- Superseded by: none

## Context

The project publishes a runtime, ecosystem contracts, and an
implementation-independent specification. Repository permissions and informal
discussion alone do not explain who may make decisions, how conflicts are
handled, or how future maintainers can revisit durable choices.

## Options considered

1. Keep governance informal until more maintainers join.
2. Adopt a public charter, roster, decision-log process, and Code of Conduct
   while honestly recording current single-maintainer risk.
3. Delegate governance to an external foundation immediately.

## Decision

Adopt option 2. `GOVERNANCE.md` defines the charter, roles, responsibilities,
decision process, conflicts, and amendments. `MAINTAINERS.md` is the roster
authority. `CODE_OF_CONDUCT.md` defines participation and enforcement. Durable
decisions use numbered records in this directory.

## Compatibility and migration

There is no runtime compatibility impact. Future normative, compatibility,
security, architecture, and maintainer decisions must follow this process from
the merge date onward.

## Consequences

Governance becomes reviewable before the community expands. The project also
makes its single-maintainer continuity risk explicit and must not imply that
distributed ownership already exists.

## Evidence

- The published roster identifies current merge and release authority.
- Contract tests check that required governance sections, links, and decision
  fields remain present.

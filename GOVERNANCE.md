# PixieCore project governance

## Project charter

PixieCore develops an open, testable runtime and reference implementation for
Prompt-Oriented Programming (POP). The project prioritizes small typed
Blueprints, reproducible evaluation, implementation-independent contracts,
safe composition boundaries, and a sustainable third-party ecosystem.

The project maintains two related but distinct public surfaces:

- the implementation-independent POP specification, schemas, fixtures, and
  governance; and
- the PixieCore runtime, developer tools, plugins, examples, and release
  artifacts.

Implementation convenience must not silently become a portable POP
requirement. Security, compatibility, and reproducibility take priority over
short-term feature count.

## Roles

### Contributors

Anyone who proposes documentation, fixtures, Blueprints, code, tests, issue
analysis, or review is a contributor. Contributors are expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md), disclose relevant conflicts, and provide
the evidence required by the affected contract.

### Reviewers

Reviewers are contributors trusted to evaluate changes in one or more areas.
They check correctness, test evidence, compatibility, security boundaries,
documentation, and ownership. Review does not by itself grant merge or release
authority.

### Maintainers

Maintainers may merge changes and manage repository settings within their
granted permissions. They must:

- preserve public contracts or document and stage incompatible changes;
- require tests and independent evidence proportional to risk;
- keep specification requirements separate from implementation extensions;
- record durable architectural and governance decisions;
- disclose conflicts of interest and recuse when impartial review is not
  possible;
- protect private reports and embargoed security information; and
- avoid representing personal preference as community consensus.

The authoritative roster and release authority are recorded in
[MAINTAINERS.md](MAINTAINERS.md). Repository permissions alone do not amend that
file.

### Project Lead

The Project Lead is a maintainer responsible for resolving deadlocks,
coordinating releases, appointing or removing maintainers through a recorded
decision, and ensuring the charter is followed. The Project Lead may not bypass
required security, compatibility, or conformance gates.

## Decision process

Routine fixes and compatible implementation work use normal pull-request
review. A durable decision record is required for changes that affect:

- the POP abstract model, normative language, schemas, conformance, or
  governance;
- public PixieCore contracts or compatibility policy;
- security and trust boundaries;
- maintainer membership or release authority; or
- architecture that constrains future implementations.

Proposals should seek reasoned consensus. When consensus cannot be reached, the
Project Lead records the alternatives, material objections, conflicts or
recusals, and final decision. Silence is not consent. A decision may be revisited
with new evidence through a new record; accepted records are not silently
rewritten.

Decision records live in [`docs/decisions/`](docs/decisions/README.md). Their
status, supersession links, date, participants, context, decision, consequences,
and evidence are part of the public history.

## Transparency and conflicts

Project decisions, compatibility exceptions, deprecations, and maintainer
changes are public unless temporary confidentiality is required for a security
report or a Code of Conduct matter. A participant with a financial, employment,
personal, or organizational conflict must disclose it and must not be the sole
approver of the affected decision.

## Amendments

Changes to this governance document require a decision record and maintainer
approval. Amendments take effect when merged and do not retroactively alter
the meaning of prior decisions.

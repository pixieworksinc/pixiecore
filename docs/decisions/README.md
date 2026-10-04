# PixieCore decision log

Decision records preserve why durable project choices were made. They are not
a replacement for implementation documentation or issue discussion.

## When a record is required

Create a record for normative POP changes, public compatibility changes,
security or trust-boundary decisions, long-lived architecture constraints,
governance amendments, and maintainer membership changes.

## Lifecycle

1. Copy [`0000-template.md`](0000-template.md) to the next four-digit number and
   a short lowercase slug.
2. Set the status to `proposed` and link the supporting issue or pull request.
3. Record participants, disclosed conflicts, alternatives, evidence, and
   compatibility impact before a final decision.
4. Set the status to `accepted` or `rejected` when the decision is made.
5. Never rewrite an accepted decision to change its meaning. Add a new record
   with status `supersedes` and cross-link both records.

Valid statuses are `proposed`, `accepted`, `rejected`, `superseded`, and
`withdrawn`.

## Records

| ID | Status | Decision |
|---|---|---|
| [0001](0001-project-governance.md) | accepted | Establish public project governance and decision records |
| [0002](0002-pop-governance.md) | accepted | Adopt the POP specification change process |
| [0003](0003-deferred-execution-boundary.md) | accepted | Keep deferred execution outside the core runtime |
| [0004](0004-hosted-blueprint-registry.md) | accepted | Defer a hosted Blueprint registry |
| [0005](0005-hosted-control-plane.md) | accepted | Keep PixieCore self-hosted in 0.1 |
| [0006](0006-standard-plugin-recipe.md) | accepted | Compose the locked foundation with a Recipe |
| [0007](0007-remove-preset-layer.md) | accepted | Remove the redundant preset layer |
| [0008](0008-colocate-recipe-plugin.md) | accepted | Co-locate Recipe with bundled plugins |
| [0009](0009-group-repeated-source-prefixes.md) | accepted | Group repeated production source prefixes |
| [0010](0010-fractal-directory-ownership.md) | accepted | Use fractal directory ownership at every level |
| [0011](0011-prompt-first-0.2-development.md) | proposed | Restore prompt-first POP on the 0.2 development branch |

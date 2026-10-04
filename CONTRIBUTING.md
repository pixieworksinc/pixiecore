# Contributing to PixieCore

PixieCore welcomes small, reviewable contributions to Blueprints, fixtures,
documentation, plugins, runtime code, and the implementation-independent POP
artifacts. Read the [Code of Conduct](CODE_OF_CONDUCT.md) and
[project governance](GOVERNANCE.md) before participating.

## Choose the smallest contribution

- Fix documentation when behavior is already correct but unclear.
- Add or improve a Blueprint when prompt-defined business behavior is missing.
  Several reasoning Roles and deterministic rules may share its contract.
- Add a Tool for an explicit external capability. Deterministic business logic
  is not automatically moved out of the prompt.
- Add a Plugin only for trusted executable capabilities that cannot be
  expressed as data-only Blueprints or Tools.
- Propose an RFC or decision record before changing a normative POP contract,
  public compatibility boundary, security boundary, or durable architecture.

Start with an issue when ownership, expected behavior, fixture rights, or the
appropriate extension boundary is unclear. Security reports must follow
[SECURITY.md](SECURITY.md), not a public issue.

## Local setup

Use development Node.js `^22.22.2 || >=24.15.0`, preferably the current Node 24
release. The installed runtime still supports Node.js 22.13.0 or later; see
[Node compatibility](docs/guides/node-compatibility.md).

```bash
npm ci --engine-strict
npm run check:node-engines
npm run typecheck
npm test
```

The default test run uses one random seed for the process and prints it. Replay
a failure with the reported value:

```bash
TEST_SEED=<reported-seed> npm test
```

Before requesting review, run the narrow test for the changed area, then the
full test suite. Public contract, package, architecture, documentation,
security, or coverage changes may require the additional gates listed in the
[public contract checklist](docs/project/public-contract-checklist.md).

Do not commit credentials, private production data, confidential source
material, generated secrets, or fixtures whose redistribution rights are
unknown.

## Good-first Blueprint workflow

A good-first Blueprint has a coherent business result with typed input and output,
has no hidden side effect, and can be evaluated offline with authorized data.
Use the issue form in `.github/ISSUE_TEMPLATE/good-first-blueprint.yml` to
define the unit before implementation.

1. Scaffold one of the supported operation types:

   ```bash
   npm run build
   node dist/core/kernel/cli/index.js blueprint create \
     examples/blueprints/<operation>/<unit-name> \
     --operation=<operation>
   ```

2. Keep `<unit-name>.yaml`, its README, versioned evaluation dataset, and owned
   contract test in the generated unit directory.
3. Replace generated examples with authorized fixtures. Cover ordinary,
   boundary, ambiguous, unsupported, and relevant failure inputs.
4. Import PixieCore only through published package entry points in the owned
   test. Do not import private source files.
5. Run `blueprint validate`, `blueprint test`, and `blueprint eval` through the
   built CLI, then run `npm test` and `npm run typecheck`.
6. For a reference-library addition, update the machine-readable catalog and
   follow [Blueprint library](docs/blueprints/blueprint-library.md), including ownership,
   stable ID, version, and deprecation rules.

The detailed semantic checklist is in
[change review and ownership](docs/project/review-policy.md). Prompt wording alone is
not sufficient evidence.

Third-party package authors should also follow the
[Blueprint publishing guide](docs/blueprints/blueprint-publishing.md), including namespace,
license, provenance, signature, quality-evidence, and lifecycle review.

## Pull requests

Keep one compatibility story per pull request. Complete the repository pull
request template and include:

- problem, intended behavior, non-goals, and affected public surface;
- compatibility classification and every required version change;
- tests, replay seed, and exact commands used;
- fixture authorization and provenance where relevant;
- security, privacy, retention, cancellation, lifecycle, side-effect, and
  rollback impact;
- synchronized documentation, examples, schemas, changelog, and package
  inventory; and
- ownership, conflicts, recusals, or the single-maintainer self-review record.

Review approval and release authority follow `CODEOWNERS`,
[MAINTAINERS.md](MAINTAINERS.md), and the
[review policy](docs/project/review-policy.md). These records have different meanings.

## Review service targets

These are public service targets, not contractual guarantees:

- acknowledge a complete non-security pull request within five business days;
- provide a first substantive review or a clear scheduling update within ten
  business days;
- state missing evidence or an unavailable owner instead of leaving the change
  silently pending; and
- review privately reported vulnerabilities under the response targets in
  [SECURITY.md](SECURITY.md).

The clock starts when required CI and the pull request checklist are complete.
Maintainer availability, embargoed work, or missing specialist ownership may
extend a review. Contributors may post one concise status request after the
target has elapsed.

## Release cadence

During the `0.1.x` line, maintainers evaluate releasable compatible changes at
least monthly. A release is cut only when there is a meaningful verified change
and every required gate passes; the calendar does not create empty releases.
Critical security fixes may be released outside that cadence. Breaking changes
follow SemVer, the POP governance rules where applicable, and an explicit
migration path.

Release status is established by the intended package artifact and signed tag,
not by an `Unreleased` changelog entry. See
[release policy](docs/project/release-policy.md) and [SECURITY.md](SECURITY.md).

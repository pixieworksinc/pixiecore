# Publishing third-party Blueprint packages

This guide is for authors who distribute data-only Blueprint packages for
PixieCore consumers or propose them for ecosystem review. PixieCore 0.1 has no
official hosted registry. Authors distribute signed package directories through
their own channels, and each consumer explicitly decides which publisher key
and package to trust.

Executable integrations use the separate trusted Plugin system. A Blueprint
package must not contain or require JavaScript, TypeScript, shell commands,
install hooks, native binaries, or another executable entry.

## Submission packet

A reviewable package contains:

- `pixiecore.blueprint-package.json` with package namespace, complete SemVer,
  SPDX license expression, compatibility, Blueprint IDs, and SHA-256 inventory;
- every referenced Blueprint YAML file, with one cognitive operation and typed
  input and output contracts;
- versioned evaluation datasets with authorized, redistributable, non-secret
  fixtures;
- documentation for intended behavior, unsupported or ambiguous cases,
  ownership, security assumptions, and migration;
- offline tests that use only published PixieCore package entry points;
- source and commit provenance, an Ed25519 signature, and the publisher public
  key or an independently verifiable key-distribution reference; and
- a proposed quality-catalog entry that states evidence kind, tested provider
  and model, dataset version, score, case counts, run count, and license.

A remote-provider quality claim also includes the value-free benchmark artifact
required by `@pixieworks/pixiecore/blueprint/quality-catalog-schema.json`. Offline fixture
accuracy and remote model quality are different evidence kinds and must never
be presented as interchangeable.

## Namespace and ownership

Choose a stable namespace controlled by the publisher. `pixiecore.*` is reserved.
Package names and Blueprint IDs must not imitate another publisher or occupy a
name without maintaining its artifacts. State the accountable owner and a
security contact in the submission. A transfer requires consent from the prior
owner when available, a new signed release, and an explicit migration record.

The license must cover every distributed Blueprint, dataset, fixture, and
document. Identify separately licensed material and its notices. Do not submit
confidential prompts, customer records, credentials, copyrighted source without
distribution rights, or model output whose reuse terms are unknown.

## Prepare and verify

Build PixieCore, add provenance, sign the final inventory, and verify the exact
directory intended for distribution:

```bash
npm ci
npm run build
node dist/core/kernel/cli/index.js blueprint package provenance ./package \
  --source=https://publisher.example/source.git \
  --commit=<full-commit>
node dist/core/kernel/cli/index.js blueprint package sign ./package \
  --private-key=./publisher-private.pem
node dist/core/kernel/cli/index.js blueprint package verify ./package \
  --public-key=./publisher-public.pem \
  --require-signature
```

Keep the private key outside the repository and package. Run each Blueprint's
offline validation and evaluation, then install the signed package into a
temporary consumer. Test enable, disable, compatible upgrade, version pin,
rollback, missing dependency, collision, tampered file, and wrong-key failure.
Record the exact commands and `TEST_SEED` values in the pull request.

## Publisher checklist

- [ ] The package is data-only and has no executable or install hook.
- [ ] Package and Blueprint IDs use a publisher-controlled namespace.
- [ ] Package, Blueprint, and dataset versions are complete and synchronized.
- [ ] The file inventory is complete and every SHA-256 digest verifies.
- [ ] Provenance identifies the reviewed source and exact commit.
- [ ] An Ed25519 signature verifies with the disclosed publisher key.
- [ ] License and fixture redistribution rights cover every included file.
- [ ] Dependencies, compatibility, collisions, upgrade, and rollback were tested.
- [ ] Each Blueprint performs one typed cognitive operation without hidden I/O.
- [ ] Datasets cover ordinary, boundary, ambiguous, unsupported, and failure cases.
- [ ] Quality entries distinguish offline fixtures from remote-provider results.
- [ ] Security contact, maintenance owner, deprecation, and key-rotation plans are stated.

## Reviewer checklist

- [ ] Recompute the inventory and verify the signature from a separately obtained key.
- [ ] Confirm namespace control, ownership, license, notices, and fixture provenance.
- [ ] Inspect every distributed file and reject executable or undeclared content.
- [ ] Run schema, offline evaluation, installation, lifecycle, and negative tests.
- [ ] Verify dependency ranges, ID collisions, PixieCore/POP compatibility, and SemVer.
- [ ] Reproduce quality evidence and confirm provider, model, dataset, seed, and counts.
- [ ] Confirm no score implies quality beyond its declared evidence kind.
- [ ] Review data sensitivity, prompt injection, denial-of-service, and ambiguous outputs.
- [ ] Record requested changes, conflicts, recusals, and the final acceptance scope.
- [ ] Define how consumers learn of deprecation, revocation, malware, or key compromise.

Schema validity, checksums, and signatures do not prove that a Blueprint is
useful, safe, legally distributable, or semantically correct. Acceptance always
requires human review of those properties.

## Start a review

Use the `Good-first Blueprint` issue form for a new small unit. Use the
`Third-party Blueprint package review` form for an existing package. A complete
submission receives the service targets in [CONTRIBUTING.md](../../CONTRIBUTING.md).
The project records accepted external packages independently; documentation of
this process does not claim that the `ECO-BP-006` target of three external
publishers has been met.

See [data-only Blueprint packages](blueprint-packages.md),
[Blueprint library policy](blueprint-library.md),
[change review and ownership](../project/review-policy.md), and the
[hosted registry decision](../decisions/0004-hosted-blueprint-registry.md).

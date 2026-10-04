# Release and compatibility versioning

PixieCore uses two related but distinct version boundaries:

1. **PixieCore package version.** The `version` in `package.json` is the SemVer
   version of a concrete PixieCore package artifact. A version is published only
   after the release gates pass and the matching artifact is intentionally
   released.
2. **Development tree.** Entries under `CHANGELOG.md`'s `Unreleased` heading
   describe changes in the current source tree. They are not part of the npm
   package named by the unchanged `package.json` version until a release is cut.

Consequently, a development checkout whose manifest still says `0.1.0` may
contain unpublished changes beyond the published 0.1.0 artifact. Do not infer
publication status from the working tree or compatibility label. Confirm it
from the intended npm artifact or Git tag.

PixieCore follows SemVer for package releases. Compatibility-preserving features
and hardening normally increment the minor version; compatible fixes increment
the patch version; incompatible public API or documented behavior changes
increment the major version. Security-hardening defaults are recorded in the
[public-contract checklist](public-contract-checklist.md).

Blueprint versions are independent of the PixieCore package version. CI compares
changed Blueprint YAML against the pull-request or push base. Every semantic
content change advances the Blueprint version; declared contract and stable-path
changes require a Blueprint major bump. Blueprint removal additionally requires
a PixieCore package major bump. A standalone Blueprint with valid version syntax
does not by itself satisfy this repository transition policy.

Release work is tracked in repository Issues. The post-publication cleanup and
next-release procedure are tracked in
[Issue #1](https://github.com/pixieworksinc/pixiecore/issues/1). A closed Issue
does not replace the gates in this policy or the security policy.

The [0.1.0 release](release-notes-0.1.0.md) is already published. Preserve its
source commit, signed tag, GitHub Release assets, and npm package bytes. New
changes belong to a separately approved version, not a replacement `0.1.0`.

Supported release lines, private vulnerability reporting, coordinated
disclosure, signed-tag and artifact-digest requirements, npm provenance, and
signing-key compromise handling are defined in the repository
[security policy](../../SECURITY.md). A version is not a release merely because
its source tree builds or a tag name exists.

## Release candidate workflow

The manually dispatched `Release candidate` workflow is intentionally unable to
publish. It uses a read-only workflow token, contains no package-registry secret
or OIDC permission, runs the release gates, builds once through `prepack`, and
then invokes `npm pack --ignore-scripts` so lifecycle scripts cannot rebuild the
candidate. The installed-package gate receives that candidate directory and
its exact source/version, verifies the manifest digests, and installs/tests the
same tarball without packing or building again. Missing, corrupt or mismatched
candidates fail rather than falling back to a checkout build. The gate checks
the candidate digests again after the consumer checks; upload follows only on
success. Ordinary development `verify:package` without candidate arguments
continues to pack its own checkout. The uploaded artifact contains the tarball and
`release-manifest.json`, which binds the package name, version, full source
revision, byte length, SHA-256, npm integrity, and npm shasum.

Running this workflow is not approval to create a tag, GitHub Release, trusted
publisher, or npm version. A later publication job must download and verify this
exact candidate instead of packing the checkout again.

## Subsequent release workflow

The manually dispatched `Publish package` workflow uses OIDC only. It requires
a public repository, a numeric annotated and independently signed tag at the
`0.1.x` HEAD, the protected `release` GitHub environment, and an npm trusted
publisher for repository `pixieworksinc/pixiecore`, workflow `release.yml`,
environment `release`. It has no token fallback or first-publication mode. The
existing npm package must remain present; package absence is an error, not
permission to recreate it. The workflow rejects a branch
dispatch, a tag/version mismatch, a non-annotated or unsigned tag, a tag not at
`0.1.x` HEAD, a prerelease or build-metadata version, or a confirmation other
than `publish:<version>` before any publication. Publication accepts only stable
numeric `X.Y.Z` versions. Prerelease candidates cannot be promoted by this
workflow and therefore cannot change npm's `latest` tag.

Before separately approving tag creation and publication, a maintainer must:

1. Agree on the exact next version, release scope, source revision, commit
   subject, tag name, and authorized signing identity. Do not infer the version
   from these instructions or reuse `0.1.0`. Merge the reviewed version and
   release-note changes into `0.1.x`, then require successful CI on that exact
   revision. The package manifest and lockfile must agree on the chosen version.
2. Select a successful `release-candidate.yml` dispatch from this repository's
   `0.1.x` branch at the intended release source revision. Record its run ID,
   attempt number, and immutable artifact ID. Candidate approval is approval of
   these exact bytes, not permission to rebuild them.
3. Inspect the tarball and `release-manifest.json`, including the source revision
   and SHA-256. Put exactly one `SHA256: <64 lowercase hex characters>` line in
   the annotated tag message before signing it. The digest must be the tarball
   digest, not the manifest-file digest.
4. Verify the authorized signing identity with `git tag -v`. The workflow also
   requires GitHub's tag-object verification to report a valid signature; a
   signature envelope alone is not sufficient. The runner has no signing
   keyring and does not choose who is authorized to approve a release.
5. Obtain explicit approval to push that tag and separately to update the
   `release` environment's deployment-tag allowlist for the exact chosen tag.
   The initial allowlist admits only `0.1.0`; it does not admit the next release
   automatically. Do not broaden it to all tags or remove independent review.
6. Confirm the npm trusted publisher still matches the repository, workflow,
   and environment above. After publication approval, dispatch on the signed
   tag with `version`, `confirmation` set to `publish:<version>`,
   `candidate_run_id`, and `candidate_artifact_id`. The release operator uses
   `@ai-yas`; `@naoi` independently approves the protected environment after
   reviewing the exact source, tag object, candidate IDs, and digest. Keep
   self-review and administrator bypass disabled. Missing independent approval
   stops publication.
7. Record the results listed under [OIDC validation evidence](#oidc-validation-evidence).
   A successful candidate build or environment approval alone is not a release.

The verification job checks candidate provenance, downloads by immutable ID,
and compares the actual tarball bytes to both the manifest and signed tag digest.
It then transfers those same files within the publication run. It does not
recompute an artifact name from the publisher's retry attempt: downstream jobs
download the immutable artifact ID output by the successful upload step. A
failed-job-only rerun reuses that successful build's original artifact ID.
It does not
install project dependencies, rebuild, or repack. The only job with
`id-token: write` verifies the transferred bytes again before publishing.
The publish command passes the tarball with an explicit `./release/` prefix so
npm interprets it as a local file rather than a GitHub package shorthand.
Both privileged jobs check out the verified annotated tag's immutable object ID,
not its mutable tag name. Initial admission also requires the checked-out HEAD
and dispatch SHA to equal the tag's commit. Each privileged job checks that the
remote tag still points to the admitted object before proceeding. A moved,
deleted or lightweight replacement tag stops verification; there is no fallback
checkout by name. These checks do not replace tag protection or an authorized
maintainer's signing-identity review.
The publisher installs exact npm CLI version `11.21.0` from the official
registry with lifecycle scripts disabled, then checks the installed version.
The version meets the OIDC minimum `11.5.1` and is not a moving major range.
Changes to privileged publication tooling require a separately reviewed change;
a future npm release cannot silently change the publisher used on retry.

Retries are safe only for identical bytes: when the exact version is absent,
an anonymous package lookup must confirm an existing package with a stable
`latest` strictly older than the candidate. Package absence, backfills, equal
versions, malformed metadata, and missing or prerelease `latest` values stop
before publication.
Publication runs share one package-wide concurrency group, including different
versions, so this workflow cannot race its own `latest` updates. External registry
writes are not controlled by that queue and still require coordinated maintainer
access. An existing exact version skips publication only
after its identity, size, SHA-256, integrity, shasum and required provenance match
the approved artifact, and `latest` resolves to the approved stable version.
Provenance is downloaded from npm's official attestation endpoint. The official
GitHub CLI verifies the Sigstore bundle and transparency proof against the
artifact's SHA-512, exact release-workflow certificate identity, GitHub OIDC
issuer, source commit, signed tag ref and hosted-runner requirement. Decoding a
statement or checking a digest alone is not cryptographic verification. The
verified statement must also name this exact npm package and version. Missing or
unrelated provenance and a moved `latest` stop the workflow; no fallback silently
restores a distribution tag. Authorization, rate-limit, network, and byte-mismatch failures stop
the workflow. Registry verification still runs after a skipped publication.
Immediately after a successful npm publish, the anonymous registry may
still return HTTP 404 while npm processes the package. Post-publication
verification waits up to approximately ten minutes for that one condition.
Other HTTP errors and mismatched metadata fail immediately. If the wait expires,
inspect the exact registry version before retrying the failed jobs: the package
may already exist, and a retry must verify it rather than publish it again.

A separate GitHub Release job receives `contents: write` only after registry
verification succeeds. Its notes contain the approved `SHA256:` and source
revision, and its assets are the exact tarball and manifest. Creation explicitly
starts as a draft. On retry, it includes authenticated drafts in its lookup,
verifies notes and downloads existing assets for byte comparison before adding
missing assets. It rejects extra or duplicate assets without deleting them. The
draft is published only after both expected assets are verified, with a final
metadata readback. It never overwrites an asset or edits mismatched release notes.
After creating a draft, the job briefly waits for GitHub's API to expose its
complete fields. An existing release with a different digest, source revision,
tag, or assets fails closed. A failed-job retry resumes an approved draft; it
does not create a second release or replace its files.

The release command receives the exact annotated tag object admitted by the
build job. It checks the live remote tag before and after draft creation, before
resuming assets or adding missing assets, immediately before publication, and
after the final release readback, including already published releases. A moved,
deleted or lightweight replacement tag, or a failed tag lookup, stops the job.
Detection does not roll back or delete a draft, asset or published release; a
failure after publication requires a maintainer to inspect the remote state.
These checks narrow and detect race windows but cannot eliminate them: GitHub
does not atomically lock the tag reference with release writes, and a tag can
change between checks or after the final read. Protected, immutable release tags
and coordinated maintainer access remain required.

The candidate transfer uses the pinned action's
[cross-run artifact inputs](https://github.com/actions/download-artifact/blob/v4.3.0/action.yml)
and checks the [artifact provenance returned by GitHub](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2022-11-28).
Registry handling respects npm's
[immutable package-version and distribution-tag rules](https://docs.npmjs.com/cli/v11/commands/npm-publish/).
Certificate-bound bundle verification follows the
[GitHub CLI verification policy](https://cli.github.com/manual/gh_attestation_verify)
and [npm's provenance format](https://github.com/npm/provenance).

## OIDC validation evidence

The first `0.1.0` publication used the former one-time token-authenticated path,
with OIDC provenance. Its
[successful publication run](https://github.com/pixieworksinc/pixiecore/actions/runs/37162087728)
does not demonstrate OIDC-authenticated npm publication. The npm trusted
publisher is registered and the first-publication environment secret has been
removed. Registration is setup evidence only; actual OIDC publication remains
to be verified at the next separately approved release.

For that release, retain a public, secret-free verification record containing:

- The approved version, source commit and subject, signed tag object and
  verification result, candidate run/attempt/artifact IDs, and SHA-256.
- The actual publication run URL, deployment approval, and successful
  `Publish immutable package through OIDC` step. If an existing version caused
  that step to be skipped, report a verified retry, not an OIDC publication test.
- An anonymous registry read for the exact package/version and `latest`, plus
  downloaded tarball size, SHA-256, npm integrity, and shasum matching the
  approved manifest. Record the cryptographic provenance verification result
  for the exact repository, workflow, source commit, and signed tag.
- The GitHub Release URL and byte comparison of both uploaded assets with the
  approved candidate, followed by an installed-package smoke check.

Do not publish an extra version merely to exercise OIDC. Do not move the
`0.1.0` tag, repack its artifact, or rerun its historical workflow as a way to
test the new publisher. If authentication fails, stop and diagnose the trusted
publisher configuration; do not restore a token fallback. Never record secrets
or authentication tokens in the verification record.

See npm's [trusted-publisher prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites)
and [provenance instructions](https://docs.npmjs.com/generating-provenance-statements/).
Environment and publisher changes, tag signing/push, dispatch, and all registry
writes remain separately approved operations. Publication dispatch approval
covers both npm publication and the subsequent GitHub Release creation.

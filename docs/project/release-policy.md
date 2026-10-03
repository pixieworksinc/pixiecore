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

Release work is tracked in repository Issues after source publication. A closed
Issue does not replace the gates in this policy or the security policy.

For a fresh public repository, prepare the GitHub source tree independently of
`npm pack`. The command below exports only the approved tracked-file inventory,
keeps the private source-to-public mapping outside the candidate, and fails on
old product names, high-confidence credentials, machine-local paths, private
archive paths, or symbolic links:

```bash
npm run prepare:public-snapshot -- \
  --output=/absolute/path/outside/the/repository \
  --report=/absolute/path/outside/the/candidate/audit.json \
  --source-ref=<reviewed-commit-sha>
```

The output and report paths must be new or empty and must remain outside the
source repository. The report records file paths, byte counts, hashes, omitted
private-archive paths, and rule identifiers. It never records matched secret
values. Review binary metadata and fixture redistribution authority separately;
passing the automated scan is necessary but not sufficient publication review.

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

## Publish workflow readiness

The manually dispatched `Publish package` workflow is checked in as a dormant
release definition. It cannot complete before the repository is public, a
numeric annotated and independently signed tag is present at the `0.1.x` HEAD,
the `release` GitHub environment has been configured, and npm authentication is
ready. The default `authentication: oidc` requires a trusted publisher for the
exact repository and workflow. The limited first-publication exception is
described below. The workflow rejects a branch
dispatch, a tag/version mismatch, a non-annotated or unsigned tag, a tag not at
`0.1.x` HEAD, a prerelease or build-metadata version, or a confirmation other
than `publish:<version>` before any publication. Publication accepts only stable
numeric `X.Y.Z` versions. Prerelease candidates cannot be promoted by this
workflow and therefore cannot change npm's `latest` tag.

Before separately approving tag creation and publication, a maintainer must:

1. Select a successful `release-candidate.yml` dispatch from this repository's
   `0.1.x` branch at the intended release source revision. Record its run ID,
   attempt number, and immutable artifact ID. Candidate approval is approval of
   these exact bytes, not permission to rebuild them.
2. Inspect the tarball and `release-manifest.json`, including the source revision
   and SHA-256. Put exactly one `SHA256: <64 lowercase hex characters>` line in
   the annotated tag message before signing it. The digest must be the tarball
   digest, not the manifest-file digest.
3. Verify the authorized signing identity with `git tag -v`. The workflow also
   requires GitHub's tag-object verification to report a valid signature; a
   signature envelope alone is not sufficient. The runner has no signing
   keyring and does not choose who is authorized to approve a release.
4. Supply `candidate_run_id` and `candidate_artifact_id` along with the exact
   version and `publish:<version>` confirmation when dispatch is approved.

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
an anonymous package lookup must also confirm either package absence or a stable
`latest` strictly older than the candidate. Backfills, equal versions, malformed
metadata, and missing or prerelease `latest` values stop before publication.
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
Immediately after a successful first npm publish, the anonymous registry may
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

The candidate transfer uses the pinned action's
[cross-run artifact inputs](https://github.com/actions/download-artifact/blob/v4.3.0/action.yml)
and checks the [artifact provenance returned by GitHub](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2022-11-28).
Registry handling respects npm's
[immutable package-version and distribution-tag rules](https://docs.npmjs.com/cli/v11/commands/npm-publish/).
Certificate-bound bundle verification follows the
[GitHub CLI verification policy](https://cli.github.com/manual/gh_attestation_verify)
and [npm's provenance format](https://github.com/npm/provenance).

## One-time first publication

npm trusted publishing requires an existing package. For the separately approved
first `@pixieworks/pixiecore@0.1.0` publication only, the same workflow accepts
`authentication: bootstrap` and the additional exact confirmation
`bootstrap:0.1.0`. Keep the ordinary `publish:0.1.0` confirmation too. OIDC remains
the default; an OIDC error never triggers token fallback. Leave
`bootstrap_confirmation` empty for normal OIDC dispatches.

1. Review and merge the workflow change, then build and approve a **new candidate
   at that merged source revision**. A candidate from an older revision cannot
   be reused. Tag signing, dispatch and publication still need separate approval.
2. Configure the `release` environment to require independent approval, prevent
   self-review and administrator bypass, and admit only the approved release tag.
3. After credential-registration approval, create a short-lived npm granular
   token with only the permissions needed to create the package in the
   `pixieworks` scope. Verify account/scope authority and the token's noninteractive
   publishing permissions, including the required 2FA policy. Put it only in the
   `release` environment secret `NPM_BOOTSTRAP_TOKEN`, never in a repository file,
   chat, workflow input or repository-wide secret.
4. After separate publication approval, dispatch the signed tag with the candidate
   IDs and bootstrap inputs above. The workflow requires both version and package
   absence before a new bootstrap publication. Anonymous 404 responses are not
   proof of scope ownership; npm authorization remains authoritative. Existing
   packages, registry failures and versions other than `0.1.0` fail closed.
5. Only the bootstrap publish step receives the credential. Its temporary npm
   configuration contains an environment-variable reference, not the token;
   the configuration is removed on shell exit. Lifecycle scripts are disabled.
   Explicit `--provenance` uses GitHub OIDC for attestation, while the short-lived
   token authorizes publication. The signed artifact, certificate identity and
   anonymous post-publication checks are the same as normal OIDC publication.
6. After exact bytes and provenance are verified, configure the package's npm
   trusted publisher for `pixieworksinc/pixiecore`, workflow `release.yml`,
   environment `release`, with direct publication allowed. Revoke the bootstrap
   token at npm and remove the environment secret, even if the attempt failed;
   obtain a new narrowly scoped token only if a new publication attempt needs it.
   All future releases use OIDC. Retire the bootstrap code through a reviewed
   follow-up after the first release succeeds.

A retry of an already published `0.1.0` skips both publication steps only after
the existing bytes, provenance and `latest` pass the normal checks, so it needs
no bootstrap secret. Unverified existing versions stop instead of republishing.
The GitHub Release job still follows successful registry verification; approval
to dispatch this workflow therefore covers both npm and GitHub Release creation.
This procedure does not create a staged placeholder package or publish locally.

See npm's [trusted-publisher prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites)
and [provenance instructions](https://docs.npmjs.com/generating-provenance-statements/).
Source visibility, environment/credential configuration, tag signing, publisher
configuration, dispatch and all registry writes remain separately approved operations.

# Security policy

## Supported versions

PixieCore supports the current minor release branch only. A security fix is
released as a patch on that branch unless the fix requires an incompatible
public-contract change.

| Release line | Status |
|---|---|
| `0.1.x` | Supported |
| Earlier or unlisted lines | Unsupported |

This table is updated in the same change that opens or retires a release line.
An unsupported version may still receive a narrowly scoped fix when required
by law or to reduce ecosystem harm, but that exception does not reopen general
support.

## Private reporting

Report suspected vulnerabilities privately through GitHub Security Advisories
for this repository. Do not include credentials, personal data, customer
prompts, production outputs, signing keys, or exploit details in a public
issue. If GitHub private reporting is unavailable, contact a release-authorized
maintainer through a private channel listed on their verified GitHub profile
and request a secure reporting path before sending sensitive material.

Maintainers will acknowledge a report within 3 business days and provide an
initial assessment within 7 days. These are response targets, not a guaranteed
fix deadline. The reporter and maintainers coordinate disclosure after a fix
or documented mitigation is available. Embargoed details remain limited to
people required to investigate, review, release, or notify affected operators.

A public advisory should identify affected and fixed versions, severity and
impact, mitigations, credit when requested, and any rotated trust material. It
must not publish credentials, private fixtures, customer data, or unnecessary
exploit detail.

## Security release process

Every security release must:

1. use a private advisory fork or another access-controlled branch until
   coordinated disclosure;
2. add a regression test that contains no secret or unauthorized data;
3. pass the ordinary test, coverage, conformance, architecture, documentation,
   dependency audit, license, SBOM, and packed-artifact gates;
4. receive approval from a maintainer with release authority who is not the
   sole author when another qualified reviewer is available;
5. publish fixed and affected versions plus operational mitigation; and
6. preserve evidence needed to reproduce the release without publishing the
   embargoed report.

The public [threat model](docs/project/threat-model.md) and
[release checklist](docs/project/public-contract-checklist.md) define the current
technical gates.

## Release signing and provenance

This policy applies to releases created after its adoption. It does not
retroactively describe the historical `0.1.0` tag or artifact as signed.

- A release uses the numeric SemVer tag `X.Y.Z`, matching `package.json`.
- A release-authorized maintainer creates an annotated cryptographically
  signed Git tag. GitHub must display the tag signature as verified before the
  release is announced.
- The exact npm tarball is built only after all release gates pass. Its SHA-256
  digest is included in the signed tag annotation and the GitHub release notes.
- When PixieCore is published to npm, publication must use npm provenance from
  a protected GitHub Actions release environment. The published registry
  digest and provenance must match the tarball tested by the release job.
- Private signing keys never enter the repository, npm package, logs, test
  fixtures, or ordinary CI secrets. Key custody and signing authorization are
  limited to the release-authorized roster in
  [MAINTAINERS.md](MAINTAINERS.md).
- Verification failure, version mismatch, digest mismatch, absent required
  provenance, or an unverified tag stops publication. A maintainer must not
  waive the failure by editing release notes after the fact.

If a release signing identity is lost or suspected compromised, maintainers
revoke its release authority, publish a security notice, record the replacement
identity through the governance decision process, and sign future releases
with the replacement. Existing tags and artifacts remain immutable; affected
releases are identified explicitly rather than silently re-signed.

## Boundary of project guarantees

Ed25519 signatures used for plugin, Blueprint-package, or audit artifacts
authenticate the signed bytes and supplied key only; they do not establish
publisher trust. Operators remain responsible for key custody, tenant
isolation, secrets, provider accounts, deployment hardening, backups, and
incident response.

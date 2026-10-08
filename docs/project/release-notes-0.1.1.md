# PixieCore 0.1.1

PixieCore 0.1.1 is the security patch release for the supported `0.1.x` line.
It includes the MCP client dependency update and the test-fixture correction
listed below. It does not include the unpublished 0.2.x development features.

## Security

- Raise the supported minimum `@modelcontextprotocol/client` version from
  `^2.0.0` to `^2.2.0`; the lockfile resolves and tests version `2.3.1`.

## Fixed

- Make the seeded log-rotation fixture names unique, preventing a reproducible
  collision under seed `545b11a2-13b4-4817-bd88-94535ab226a1`. This changes test
  data only; production logging behavior is unchanged.
- Harden release snapshot checks, signed-tag race checks, and the accuracy
  wording in structural-summary evaluation reports, as recorded in the
  changelog.

## Changed

- Align the bundled core plugin manifests and standard Recipe version with the
  package version `0.1.1`.

## Verification

The release source revision, signed tag, immutable candidate artifact, npm
provenance, registry metadata, and GitHub Release assets will be recorded in the
public release and the verification record after publication. This document
does not claim that PixieCore 0.1.1 has already been published.

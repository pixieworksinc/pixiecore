# Data-only Blueprint packages

A Blueprint package distributes versioned Blueprint YAML and supporting data
without executable plugin code. Its root metadata file is
`pixiecore.blueprint-package.json`, validated by the published
`@pixieworks/pixiecore/blueprint/package-schema.json` schema.

```json
{
  "schema": "pixiecore.blueprint-package/v1",
  "package": {
    "name": "acme.travel-blueprints",
    "namespace": "acme.travel",
    "version": "1.0.0",
    "license": "Apache-2.0"
  },
  "compatibility": {
    "pop": "^0.1.0",
    "pixiecore": "^0.1.0"
  },
  "dependencies": {
    "acme.shared-blueprints": "^2.0.0"
  },
  "provenance": {
    "source": "https://example.invalid/acme/travel-blueprints.git",
    "commit": "0123456789abcdef"
  },
  "blueprints": [{
    "id": "acme.travel.date-normalizer",
    "version": "1.0.0",
    "path": "blueprints/date-normalizer.yaml"
  }],
  "files": {
    "blueprints/date-normalizer.yaml": "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  }
}
```

`signature`, when present, is generated over the canonical JSON form of every
field shown above. It records the `Ed25519` algorithm, the SHA-256 ID of the
publisher public key, and the Base64 signature value. The signature itself is
excluded from the signed value.

The package and every Blueprint use publisher-controlled namespaced IDs;
`pixiecore.*` is reserved. Every path is relative, cannot escape the package
root, and must appear in the SHA-256 inventory. Package version and individual
Blueprint versions are independent SemVer values. `compatibility.pop` declares
the language-neutral contract range; `compatibility.pixiecore` is optional and
only constrains this implementation.

`license` is required package metadata. Publishers should use an SPDX license
expression. The v1 schema deliberately accepts a non-blank string so schema
validation does not freeze a copy of the evolving SPDX catalog.

This format carries data, not JavaScript or TypeScript entry points. It is
validated and copied as data and is never loaded through the executable plugin
loader.

## Local lifecycle

PixieCore supports an offline lifecycle from a local package root directory or
its `pixiecore.blueprint-package.json` path:

```bash
pixiecore blueprint package install ./acme-travel --enable
pixiecore blueprint package disable acme.travel-blueprints
pixiecore blueprint package enable acme.travel-blueprints
pixiecore blueprint package upgrade ./acme-travel-1.1.0
pixiecore blueprint package rollback acme.travel-blueprints
```

Use `--config=./path/pixiecore.blueprints.yml` on lifecycle commands to select a
state file. The default is `pixiecore.blueprints.yml` in the working directory.
Installed immutable versions are copied below
`blueprints/packages/<package-name segments>/<version>/`, relative to that
state file. The state records the active version, enabled flag, installed
versions, and activation history. It is written through a mode-`0600`
temporary file and atomic rename.

Before copying a package, PixieCore verifies the metadata schema, POP and
PixieCore compatibility ranges, namespace ownership, the exact file inventory,
every SHA-256 digest, every Blueprint schema and version, and collisions with
other installed package IDs. Reinstalling identical content is idempotent;
different content at the same package/version is rejected. Upgrade requires a
strictly newer SemVer and preserves the current enabled state. Rollback changes
the active pin to the previous version without deleting either immutable
version.

## Dependencies and collisions

The optional `dependencies` object maps namespaced package IDs to SemVer
ranges. Installation requires every dependency to be installed at a matching
active version. Enabling additionally requires those dependencies to be
enabled. PixieCore rejects disabling a package while an enabled dependent uses
it, and rejects a rollback that would violate an enabled dependent's range.

Blueprint IDs are publisher-owned global identifiers. Installation and upgrade
compare a candidate against every installed version, including disabled
versions, and reject any ID already owned by another package. This conservative
policy prevents an enable or rollback operation from changing ownership later.

## Provenance and publisher trust

Publishers can record source provenance and sign the resulting metadata:

```bash
pixiecore blueprint package provenance ./acme-travel \
  --source=https://example.invalid/acme/travel-blueprints.git \
  --commit=0123456789abcdef
pixiecore blueprint package sign ./acme-travel --private-key=./publisher-private.pem
pixiecore blueprint package verify ./acme-travel \
  --public-key=./publisher-public.pem --require-signature
pixiecore blueprint package install ./acme-travel --enable \
  --public-key=./publisher-public.pem --require-signature
```

The private key must be Ed25519 and remains outside the package. Verification
without `--public-key` reports a present signature as unverified;
`--require-signature` requires successful verification. A package first
installed with a verified signature pins that publisher key ID in local state.
Every subsequent upgrade must be verified with the same key. Provenance changes
invalidate an existing signature and therefore remove it until the package is
signed again.

Local v1 installation intentionally does not fetch network resources, unpack
archives, execute package files, discover keys, or decide revocation. Catalog,
key distribution, revocation, and hosted-registry policy remain separate trust
phases.

PixieCore 0.1 intentionally has no official hosted registry, global trust
authority, network downloader, or automatic updater. Signed local catalogs and
explicit publisher-key trust are the supported baseline. Any hosted service
requires separately approved operational ownership and trust policy under
[TC-ADR-0004](../decisions/0004-hosted-blueprint-registry.md).

Hosts that need a programmatic lifecycle can import the same operations from
`@pixieworks/pixiecore/blueprint-packages`. In particular,
`resolveEnabledBlueprintPackages()` returns only active, enabled packages and
revalidates their metadata, compatibility, inventory, hashes, and Blueprints
before exposing the immutable snapshot.

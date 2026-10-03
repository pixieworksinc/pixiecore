# PixieCore third-party plugin authoring

This guide is the canonical workflow for creating, validating, testing,
installing, and distributing a third-party PixieCore plugin. Managed plugins run
as trusted Node.js code with the same process and filesystem permissions as the
host. PixieCore does not sandbox them. Install and enable only code you trust.

## Create a project

Choose one public component kind: `agent_role`, `decorator`, `tool`,
`provider`, or `extension`. An extension contributes a typed value to a
namespaced extension point owned by another plugin. Core-only `service` and
`command` components are not available to third parties.

```bash
pixiecore plugin create ./weather-tool \
  --id=acme.weather-tool \
  --kind=tool
pixiecore plugin validate ./weather-tool
pixiecore plugin test ./weather-tool
```

An extension project also names its owner-defined point:

```bash
pixiecore plugin create ./company-apisix-policy \
  --id=acme.company-apisix-policy \
  --kind=extension \
  --extension-point=pixiecore.providers.apisix.plugin
```

The generated source project is directly testable and has the required
Drupal-style ownership layout:

```text
weather-tool/
├── weather-tool.ts       # named TypeScript entry
├── weather-tool.js       # executable ESM build artifact
├── weather-tool.yaml     # pixiecore.plugin/v1 manifest
├── package.json
├── src/
│   ├── index.ts
│   └── index.js
└── tests/
    └── weather-tool.test.js
```

The directory name must be lowercase kebab-case. The plugin ID must be
namespaced, its final segment must match the directory name when installed, and
the `pixiecore.*` namespace is reserved. Authoring types come only from the
public, type-only `@pixieworks/pixiecore/plugin` subpath. APISIX extension projects may also
use the public `@pixieworks/pixiecore/apisix` contract. `plugin validate` rejects imports
from private PixieCore subpaths.

Complete source projects for the four execution-component kinds live under
[`examples/plugin-authoring`](../../examples/plugin-authoring/README.md).
The recursively owned [APISIX plugin family](apisix.md) demonstrates the
extension kind.

## What validate and test guarantee

`pixiecore plugin validate <path>` performs these checks in order:

1. named `.ts` and `.yaml` entries plus `src/` and `tests/` exist;
2. at least one `tests/**/*.test.*` file exists;
3. production source does not import a private PixieCore subpath;
4. the manifest passes the published `@pixieworks/pixiecore/plugin/schema.json` contract;
5. IDs, SemVer ranges, dependencies, file containment, and component policy
   pass the runtime validator;
6. the executable ES module imports and declares every configured export.

`pixiecore plugin test <path>` repeats validation, runs the plugin-owned Node
tests, and activates the plugin through a temporary managed consumer. The
temporary consumer and state file are removed even when activation fails. Both
commands are offline and do not contact a package registry.

## Install and activation state

Install a local source or package directory by creating a project-local
directory symlink. Pass `--enable` to update activation state in the same
operation:

```bash
pixiecore plugin install ../weather-tool \
  --config=./pixiecore.plugins.yml \
  --enable

pixiecore plugin disable acme.weather-tool --config=./pixiecore.plugins.yml
pixiecore plugin enable acme.weather-tool --config=./pixiecore.plugins.yml
```

`install` and `link` are aliases. They never replace a regular file, directory,
or link to another source. State updates are written to a mode-0600 temporary
file and atomically renamed. If `install --enable` cannot update state, a newly
created link is rolled back. Reinstalling the same source is idempotent.

Dependencies activate before dependants. A parent plugin may own child plugins
only in its `plugins/` directory; child IDs must start with the parent ID plus
`.`. Enabling a parent enables its non-disabled descendants. Disabling a parent
blocks the entire subtree before import. Contribution-name collisions retain
the documented PixieCore registration and override rules, while duplicate plugin
IDs, dependency conflicts, and dependency cycles are fatal before activation.
Each activator and registered closeable is cleaned up once in reverse ownership
order.

## Package contract

Use a namespaced npm package such as `@acme/pixiecore-plugin-weather-tool` and
SemVer for both package and manifest versions. Declare PixieCore as a peer:

```json
{
  "type": "module",
  "files": ["weather-tool.js", "weather-tool.yaml", "src/**/*.js"],
  "peerDependencies": { "@pixieworks/pixiecore": "^0.1.0" },
  "devDependencies": { "typescript": "^5.9.2" },
  "scripts": {
    "typecheck": "tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --strict *.ts src/**/*.ts"
  }
}
```

Compile the named TypeScript entry and its production sources to ESM. Include
only the named JavaScript entry, manifest, production `src/`, license, and
documentation in the published file allowlist. Keep tests and TypeScript source
in the source repository; they are not part of the integrity inventory.

## Provenance, integrity, and signatures

Create deterministic distribution metadata after the production build:

```bash
pixiecore plugin provenance ./weather-tool \
  --pixiecore-range='^0.1.0' \
  --source=https://github.com/acme/weather-tool.git \
  --commit=0123456789abcdef
pixiecore plugin verify ./weather-tool
```

This writes `pixiecore.plugin.json` using the
`pixiecore.plugin-package/v1` schema. It binds plugin ID/version, manifest and
entry paths, the supported PixieCore SemVer range, optional source/commit
provenance, and a sorted SHA-256 inventory of production files. The schema is
published at `@pixieworks/pixiecore/plugin/package-schema.json`. Verification rejects a
missing, added, or changed production file and an incompatible PixieCore version.
Symbolic links inside the distributed directory are rejected.

For signed distribution, use an Ed25519 key whose private half remains outside
the plugin directory:

```bash
pixiecore plugin sign ./weather-tool --private-key=./release-private.pem
pixiecore plugin verify ./weather-tool \
  --public-key=./release-public.pem \
  --require-signature
```

The metadata records a SHA-256 public-key identifier. A valid signature proves
that the metadata was signed by the supplied key; it does not establish that
the key or plugin author is trustworthy. Key distribution and trust policy
belong to the consumer or registry operator.

## Local catalogs

Build a deterministic offline catalog from already downloaded plugin
directories:

```bash
pixiecore plugin catalog ./vendor-plugins > pixiecore.plugin-catalog.json
```

The catalog verifies every discovered `pixiecore.plugin.json`, sorts entries by
plugin ID, and rejects duplicate IDs. This is a local catalog format, not a
hosted registry, dependency downloader, or automatic updater. ECO-04 does not
grant network access or define a global trust authority.

## Upgrade and rollback

1. Build, validate, test, and verify the candidate in a new versioned directory.
2. Stop new application work and close the current runtime.
3. Atomically replace the installation symlink with one pointing to the
   candidate, leaving the old directory intact.
4. Start PixieCore and run an installed-consumer smoke test.
5. On failure, restore the previous symlink and restart.
6. Remove the old directory only after the rollback window expires.

Never edit a live installed directory in place: integrity metadata would no
longer describe it, active imports cannot be unloaded safely, and rollback
would be ambiguous.

See also [plugin runtime behavior](plugins.md) and the
[recursive plugin layout](plugin-layout.md).

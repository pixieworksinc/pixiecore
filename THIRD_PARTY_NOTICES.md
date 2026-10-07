# PixieCore third-party dependency notices

This file records the production dependency graph locked for the PixieCore
release. It is generated deterministically from `package-lock.json` by
`npm run check:licenses`. Optional platform artifacts are included even when
they are not installed on the current operating system.

This inventory is informational and does not replace the license text or
notices shipped by each dependency. The dependency package metadata and its
own license files remain authoritative.

The release gate accepts only the reviewed SPDX expressions listed here. A
new expression fails the gate until it is explicitly reviewed.

- Production package versions: 77
- Direct dependencies: 9
- Optional lockfile entries: 12
- Declared licenses: `0BSD` (1), `Apache-2.0` (4), `BSD-2-Clause` (1), `BSD-3-Clause` (2), `ISC` (4), `MIT` (65)

| Package | Version | Declared license | Relationship |
|---|---:|---|---|
| `@azure/abort-controller` | `2.2.0` | `MIT` | transitive |
| `@azure/core-auth` | `1.11.0` | `MIT` | transitive |
| `@azure/core-client` | `1.11.0` | `MIT` | transitive |
| `@azure/core-rest-pipeline` | `1.25.0` | `MIT` | transitive |
| `@azure/core-tracing` | `1.4.0` | `MIT` | transitive |
| `@azure/core-util` | `1.14.0` | `MIT` | transitive |
| `@azure/identity` | `4.13.1` | `MIT` | direct |
| `@azure/logger` | `1.4.0` | `MIT` | transitive |
| `@azure/msal-browser` | `5.18.0` | `MIT` | transitive |
| `@azure/msal-common` | `16.12.0` | `MIT` | transitive |
| `@azure/msal-node` | `5.5.0` | `MIT` | transitive |
| `@modelcontextprotocol/client` | `2.3.1` | `Apache-2.0` | direct |
| `@modelcontextprotocol/core` | `2.0.0` | `MIT` | transitive |
| `@modelcontextprotocol/core` | `2.3.1` | `Apache-2.0` | transitive |
| `@modelcontextprotocol/server` | `2.0.0` | `MIT` | direct |
| `@napi-rs/canvas` | `1.0.6` | `MIT` | optional |
| `@napi-rs/canvas-android-arm64` | `1.0.6` | `MIT` | optional |
| `@napi-rs/canvas-darwin-arm64` | `1.0.6` | `MIT` | optional |
| `@napi-rs/canvas-darwin-x64` | `1.0.6` | `MIT` | optional |
| `@napi-rs/canvas-linux-arm-gnueabihf` | `1.0.6` | `MIT` | optional |
| `@napi-rs/canvas-linux-arm64-gnu` | `1.0.6` | `MIT` | optional |
| `@napi-rs/canvas-linux-arm64-musl` | `1.0.6` | `MIT` | optional |
| `@napi-rs/canvas-linux-riscv64-gnu` | `1.0.6` | `MIT` | optional |
| `@napi-rs/canvas-linux-x64-gnu` | `1.0.6` | `MIT` | optional |
| `@napi-rs/canvas-linux-x64-musl` | `1.0.6` | `MIT` | optional |
| `@napi-rs/canvas-win32-arm64-msvc` | `1.0.6` | `MIT` | optional |
| `@napi-rs/canvas-win32-x64-msvc` | `1.0.6` | `MIT` | optional |
| `@typespec/ts-http-runtime` | `0.3.8` | `MIT` | transitive |
| `agent-base` | `7.1.4` | `MIT` | transitive |
| `ajv` | `8.20.0` | `MIT` | direct |
| `buffer-equal-constant-time` | `1.0.1` | `BSD-3-Clause` | transitive |
| `bundle-name` | `4.1.0` | `MIT` | transitive |
| `cross-spawn` | `7.0.6` | `MIT` | transitive |
| `debug` | `4.4.3` | `MIT` | transitive |
| `default-browser` | `5.5.0` | `MIT` | transitive |
| `default-browser-id` | `5.0.1` | `MIT` | transitive |
| `define-lazy-prop` | `3.0.0` | `MIT` | transitive |
| `dotenv` | `17.4.2` | `BSD-2-Clause` | direct |
| `ecdsa-sig-formatter` | `1.0.11` | `Apache-2.0` | transitive |
| `eventsource` | `3.0.7` | `MIT` | transitive |
| `eventsource-parser` | `3.1.1` | `MIT` | transitive |
| `fast-deep-equal` | `3.1.3` | `MIT` | transitive |
| `fast-uri` | `3.1.8` | `BSD-3-Clause` | transitive |
| `http-proxy-agent` | `7.0.2` | `MIT` | transitive |
| `https-proxy-agent` | `7.0.6` | `MIT` | transitive |
| `is-docker` | `3.0.0` | `MIT` | transitive |
| `is-inside-container` | `1.0.0` | `MIT` | transitive |
| `is-wsl` | `3.1.1` | `MIT` | transitive |
| `isexe` | `2.0.0` | `ISC` | transitive |
| `jose` | `6.2.9` | `MIT` | transitive |
| `json-schema-traverse` | `1.0.0` | `MIT` | transitive |
| `jsonwebtoken` | `9.0.3` | `MIT` | transitive |
| `jwa` | `2.0.1` | `MIT` | transitive |
| `jws` | `4.0.1` | `MIT` | transitive |
| `lodash.includes` | `4.3.0` | `MIT` | transitive |
| `lodash.isboolean` | `3.0.3` | `MIT` | transitive |
| `lodash.isinteger` | `4.0.4` | `MIT` | transitive |
| `lodash.isnumber` | `3.0.3` | `MIT` | transitive |
| `lodash.isplainobject` | `4.0.6` | `MIT` | transitive |
| `lodash.isstring` | `4.0.1` | `MIT` | transitive |
| `lodash.once` | `4.1.1` | `MIT` | transitive |
| `ms` | `2.1.3` | `MIT` | transitive |
| `open` | `10.2.0` | `MIT` | transitive |
| `path-key` | `3.1.1` | `MIT` | transitive |
| `pdfjs-dist` | `6.2.108` | `Apache-2.0` | direct |
| `pkce-challenge` | `5.0.1` | `MIT` | transitive |
| `require-from-string` | `2.0.2` | `MIT` | transitive |
| `run-applescript` | `7.1.0` | `MIT` | transitive |
| `safe-buffer` | `5.2.1` | `MIT` | transitive |
| `semver` | `7.8.5` | `ISC` | direct |
| `shebang-command` | `2.0.0` | `MIT` | transitive |
| `shebang-regex` | `3.0.0` | `MIT` | transitive |
| `tslib` | `2.8.1` | `0BSD` | transitive |
| `which` | `2.0.2` | `ISC` | transitive |
| `wsl-utils` | `0.1.0` | `MIT` | transitive |
| `yaml` | `2.9.0` | `ISC` | direct |
| `zod` | `4.4.3` | `MIT` | direct |

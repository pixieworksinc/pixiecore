# PixieCore 0.1.0

PixieCore 0.1.0 was published on 2026-10-03 as the first public release of the
PixieCore TypeScript runtime. The source, signed tag, GitHub Release, and npm
package are available:

- [GitHub Release and immutable artifacts](https://github.com/pixieworksinc/pixiecore/releases/tag/0.1.0)
- [npm package: @pixieworks/pixiecore@0.1.0](https://www.npmjs.com/package/@pixieworks/pixiecore/v/0.1.0)
- [Verified publication run](https://github.com/pixieworksinc/pixiecore/actions/runs/37162087728)
- Source commit: `696c75bd704dd8ba90a2435f8a9b52dc8b987681` (`chore: Initial commit`).
- Signed tag object: `88e60d3d37cd1e728b6b3f35cc45ee60297b237c`.
- Tarball SHA-256: `f84e8f31eb417dcc1319d66f5f7a8eb3e94b8750df036aa33aadcc38b002977b`.

## Included scope

- Schema-validated Blueprint loading, Mustache-style input binding, Role
  selection, Provider execution, structured output validation, bounded retry,
  Tool calls, Decorators, localization, attachments, and runtime cleanup.
- Composition-based bootstrap and kernel boundaries with 24 generated,
  Recipe-locked first-party plugins under `src/plugins/`.
- Managed third-party plugin discovery, validation, dependency ordering,
  activation state, lifecycle cleanup, distribution integrity, and signing
  support.
- Direct Provider adapters and an APISIX gateway adapter with nested APISIX
  capability plugins. Provider credentials remain external configuration.
- CLI, authenticated HTTP API, MCP client/server, application composition,
  telemetry, audit, review, cache, retention, RAG, fallback, and optional JIT
  interfaces.
- Eight independently testable reference Blueprint roles, including synthetic
  PDF and screenshot Extractor fixtures generated from checked-in source.
- Public PixieCore and POP schemas, POP Core 0.1 conformance fixtures,
  independent validation, cross-runtime instruction-template comparison, and
  installed-package consumer checks.

## Verified candidate boundary

The renamed candidate was checked in isolated source trees on Node.js 22.13.0
and 24.20.0. Both environments passed the production dependency audit,
license/SBOM gate, typecheck, POP Core conformance, source coverage floors, and
installed package, CLI, and plugin smoke checks. The publication run verified
the approved candidate bytes and npm provenance before creating the GitHub
Release. These results apply to the release artifact, not to later changes in
the development branch.

The repository's default test suite is offline. Fake and deterministic
Providers verify request, response, retry, lifecycle, and error contracts
without using paid APIs. The initial public release makes no claim that a given
real model reaches a particular semantic accuracy, latency, or cost.

## Security and distribution

- Non-loopback HTTP binding requires an API token, and caller-controlled
  identities and roles remain restricted at the server boundary.
- Provider URLs reject embedded credentials and non-HTTP schemes. Errors and
  logs sanitize credentials and line breaks.
- Uploads enforce name, path, encoding, individual-size, aggregate-size, and
  cleanup boundaries.
- Plugins and Blueprint packages have schema, integrity, provenance, signature,
  lifecycle, and namespace checks.
- Apache-2.0 and generated third-party dependency notices are included.
- Private plans, archived real-provider evidence, historical conformance
  evidence, credentials, user settings, build products, and dependency installs
  are excluded from the fresh public source snapshot.

## Subsequent releases

The initial publication used token authentication with OIDC provenance. The npm
trusted publisher is now configured; actual OIDC-authenticated publication will
be verified at the next separately approved release, not by replacing `0.1.0`.
Follow the [release policy](release-policy.md) and
[Issue #1](https://github.com/pixieworksinc/pixiecore/issues/1) for that work.

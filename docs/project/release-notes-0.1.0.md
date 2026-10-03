# PixieCore 0.1.0 release candidate

PixieCore 0.1.0 is the planned first public source release of the PixieCore
TypeScript runtime. It has not yet been tagged or published to npm.

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
installed package, CLI, and plugin smoke checks. Final publication repeats the
same gates on the exact exported source snapshot.

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

## Deferred release actions

Source publication, the `0.1.0` tag, and npm publication are separate approval
and verification flows. The initial GitHub repository is created private and is
made public only after its one-commit source inventory and branch policy have
been reviewed. npm remains unpublished during the source-publication flow.

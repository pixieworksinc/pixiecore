# Changelog

All notable PixieCore changes will be documented here. PixieCore follows
semantic versioning.

## Unreleased

Changes below are not part of the published `0.1.0` artifact.

## 0.1.1 - 2026-10-08

### Security

- Raised the minimum `@modelcontextprotocol/client` version to `^2.2.0` and
  locked the tested dependency graph to version `2.3.1`.

### Fixed

- Corrected collisions in the seeded log-rotation test fixtures without
  changing production logging behavior.
- Detect fine-grained GitHub tokens and reject environment-file variants in
  public source snapshots without exposing matched credential values.
- Recheck the approved tag object around GitHub Release writes and final
  verification; fail closed on changed tags without deleting remote state.
- Preserve explicit factuality limitations in structural-summary evaluation
  results and reports. Comparator pass rates are not factual-accuracy claims.

### Changed

- Removed first-publication token authentication from the release workflow;
  subsequent releases use OIDC only, without a token fallback.
- Recorded the completed `0.1.0` publication and documented approval and
  verification gates for subsequent releases. Trusted publisher registration
  is not evidence of an OIDC-authenticated publication.

## 0.1.0 - 2026-10-03

### Added

- Added a TypeScript runtime for schema-validated, role-oriented Blueprints with
  deterministic input binding and structured output validation.
- Added a composition-based plugin kernel, mandatory locked Recipe, nested
  plugin ownership, lifecycle management, third-party plugin authoring contract,
  and generated first-party catalog.
- Added Provider adapters for OpenAI-compatible APIs, Anthropic, Azure, Gemini,
  and APISIX gateway deployments while retaining an offline fake-provider test
  boundary.
- Added CLI, HTTP API, MCP client and server integration, tool execution,
  multimodal input, logging, permissions, telemetry, audit, review, data policy,
  cache, RAG, fallback, and evidence-admitted JIT capabilities.
- Added application composition helpers and independently versioned reference
  Blueprints for Extractor, Classifier, Summarizer, Validator, Verifier,
  Converter, Translator/Localizer, and Router/Orchestrator roles.
- Added public JSON Schemas, a language-neutral POP Core 0.1 specification,
  conformance fixtures, an independent validator, instruction-template
  interoperability fixtures, and package-installed consumer verification.
- Added seeded offline tests, architecture boundaries, source documentation
  checks, TypeDoc generation, dependency-license review, security gates, and a
  separate public-source snapshot audit.

### Publication boundary

- [0.1.0](https://github.com/pixieworksinc/pixiecore/releases/tag/0.1.0)
  is published as source, a verified signed tag, GitHub Release assets, and
  npm `@pixieworks/pixiecore@0.1.0`. The exact commit and artifact digest are in
  the [release notes](docs/project/release-notes-0.1.0.md).
- Offline contract evidence does not claim real-provider semantic accuracy.
- Private planning documents, archived provider measurements, and historical
  conformance evidence are not part of the fresh public source snapshot.

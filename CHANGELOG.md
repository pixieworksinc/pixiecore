# Changelog

All notable PixieCore changes will be documented here. PixieCore follows
semantic versioning.

## Unreleased

The public source repository and npm package have not been published. Changes
after the first `0.1.0` source tag will be recorded here.

## 0.1.0 - planned

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

- `0.1.0` remains a release candidate until the approved commit is tagged and
  the separate release workflow succeeds.
- The initial source publication does not publish an npm package.
- Offline contract evidence does not claim real-provider semantic accuracy.
- Private planning documents, archived provider measurements, and historical
  conformance evidence are not part of the fresh public source snapshot.

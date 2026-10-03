# Threat model and security release boundary

PixieCore processes untrusted Blueprint inputs, model output, plugin metadata,
tool arguments, files, and remote provider responses. Protected assets include
credentials, tenant data, prompts and outputs, signing keys, audit integrity,
resource budgets, and the host filesystem/network authority.

Primary threats are prompt or tool injection, schema bypass, path traversal,
plugin supply-chain substitution, cross-tenant data access, secret leakage in
logs/cache/audit records, unbounded cost or concurrency, provider fallback to
an untested model, and tampering with release evidence. Existing boundaries
address these with validation, permissions, managed-plugin signatures,
data-policy redaction, sensitive-cache bypass, execution controls, explicit
fallback policy, sanitized telemetry, and signed value-free audit exports.

`@pixieworks/pixiecore/audit` accepts only timestamp, trace ID, source, event, outcome, and
optional error code. It deliberately cannot carry prompts, inputs, outputs, or
free-form messages. Ed25519 verification detects mutation but does not prove
that an event was complete or truthful. Private keys stay outside PixieCore and
the repository.

`npm run check:security-release` requires this model and `SECURITY.md` and
generates/parses an SPDX 2.3 SBOM from the lockfile. The immediately preceding
CI step separately runs the high-severity production dependency audit; CI also
runs the complete test and package gates. A host
must still provide sandboxing for executable plugins, encryption, authorization,
network egress policy, durable append-only storage, key rotation, backup,
monitoring, and breach response.

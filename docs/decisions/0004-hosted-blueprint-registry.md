# TC-ADR-0004: Defer a hosted Blueprint registry

- Status: accepted
- Date: 2026-08-25
- Participants: `@naoi`
- Conflicts and recusals: none disclosed
- Related: `ECO-BP-003`, `ECO-BP-004`, `ECO-BP-005`, `ADOPT-007`
- Supersedes: none
- Superseded by: none

## Context

PixieCore can install and verify data-only Blueprint packages from local
directories. The package format includes integrity, provenance, publisher-key
pinning, dependencies, compatibility, and collision checks. A hosted registry
would add a continuously operated trust and distribution service rather than a
library feature.

No operating organization, moderation team, service objective, revocation
authority, malware response process, funding model, or production quality
catalog currently exists. Selecting those policies inside the package client
would imply guarantees the project cannot yet provide.

## Options considered

1. Launch and operate an official hosted registry now.
2. Make PixieCore depend on a third-party package registry without a dedicated
   Blueprint trust policy.
3. Keep signed local catalogs and offline installation as the supported
   baseline, and reconsider hosting only after its prerequisites exist.

## Decision

Adopt option 3.

PixieCore 0.1 does not define an official hosted Blueprint registry, global
trust authority, network downloader, automatic update service, or central
revocation service. Signed local catalogs and explicit publisher-key trust
remain the supported distribution baseline.

A hosted registry proposal must identify, before implementation:

- the legal and operational owner and a sustainable funding model;
- publication, moderation, appeal, and removal responsibilities;
- publisher identity and key-rotation policy;
- revocation propagation and emergency malware response targets;
- availability, backup, retention, privacy, and incident-response objectives;
- a machine-readable quality catalog backed by published evaluation evidence;
- client behavior for unavailable, stale, revoked, or compromised metadata.

The proposal must be a new decision record. It must not weaken offline use,
require network access for Blueprint validation or execution, or silently
enable remote packages.

## Compatibility and migration

There is no API or artifact change. Existing local package installation,
verification, enablement, rollback, and catalogs remain supported. A later
registry client must be additive and preserve pinned offline operation.

## Consequences

The project avoids operating an under-specified trust service and keeps local
development reproducible. Discovery is less convenient, and registry-backed
adoption work remains blocked until quality evidence and operational ownership
exist. Independent publishers may distribute signed packages through their own
channels without representing those channels as an official PixieCore registry.

## Evidence

- The current package contract verifies immutable local content and pinned
  publisher keys without network access.
- The public trust documentation assigns key distribution, revocation, and
  hosted-registry policy to a separate boundary.
- `ECO-BP-004` still requires an evidence-backed machine-readable quality
  catalog, and external publisher evidence has not yet been collected.

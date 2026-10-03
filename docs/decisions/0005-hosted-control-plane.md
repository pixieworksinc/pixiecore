# TC-ADR-0005: Keep PixieCore self-hosted in 0.1

- Status: accepted
- Date: 2026-08-25
- Participants: `@naoi`
- Conflicts and recusals: none disclosed
- Related: `PROD-001` through `PROD-007`, `ADOPT-004`
- Supersedes: none
- Superseded by: none

## Context

PixieCore is a library and runtime that applications can embed or expose through
CLI, REST, and MCP adapters. Its public boundaries cover telemetry, data policy,
safe caching, admission, fallback, and signed audit artifacts while leaving
storage and operations under host control.

A hosted control plane would introduce account tenancy, authentication,
billing, remote configuration, data processing, service availability,
regional deployment, support, and incident-response obligations. No completed
production pilots currently demonstrate that these responsibilities solve a
shared problem that cannot be handled by the self-hosted runtime.

## Options considered

1. Build an official hosted control plane as part of PixieCore 0.1.
2. Add remote control-plane hooks to the core contract before a service exists.
3. Keep the runtime self-hosted and reconsider a separately governed service
   after production evidence identifies a stable shared need.

## Decision

Adopt option 3.

PixieCore 0.1 remains a self-hosted library and runtime. It does not require or
implicitly contact an official hosted control plane. Configuration, identity,
secrets, persistence, data residency, deployment, scaling, monitoring, and
operator access remain host responsibilities.

A future hosted-service proposal requires a new decision record and evidence
from at least three independent production pilots. That evidence must identify
a repeated operational gap and compare a hosted service with documented
self-hosted alternatives. The proposal must define:

- product and legal ownership, funding, support, and service objectives;
- tenant isolation, identity, authorization, audit, and administrator access;
- data flow, retention, deletion, residency, backup, and incident response;
- remote configuration authenticity, rollback, availability, and fail-closed
  behavior;
- billing and usage semantics, exportability, and a service exit path;
- compatibility with fully offline and self-hosted PixieCore operation.

Hosted-service interfaces must remain additive. A hosted service must not
become necessary to validate, test, package, or execute local Blueprints.

## Compatibility and migration

There is no API change. Existing deployments retain their current ownership
and can use the public telemetry, policy, cache, fallback, and audit contracts
with infrastructure selected by the host.

## Consequences

The project can focus on portable execution contracts without prematurely
assuming SaaS operations or collecting user data. Users must assemble their
own deployment and operations stack. Adoption research must measure whether
that assembly cost becomes a repeated product gap before a hosted service is
proposed.

## Evidence

- Production-readiness contracts are storage-neutral and explicitly return
  frozen artifacts or call host-owned ports.
- Current CLI, REST, MCP, package, and Blueprint workflows work without an
  official PixieCore service.
- `ADOPT-004` production pilots have not yet supplied evidence for a shared
  hosted-control-plane requirement.

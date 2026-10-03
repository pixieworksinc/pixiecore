# TC-ADR-0003: Keep deferred execution outside the core runtime

- Status: accepted
- Date: 2026-08-25
- Participants: `@naoi`
- Conflicts and recusals: none disclosed
- Related: `SPEC-004`, `APP-005`, `PROD-004`
- Supersedes: none
- Superseded by: none

## Context

PixieCore executes one Blueprint call and provides application helpers for
validation, admission, cancellation, explicit retry ownership, and partial
results. Durable deferred or batch execution additionally requires queue
transport, persistence, leasing, visibility timeouts, idempotency, retry and
dead-letter policies, scheduling, and operational ownership.

Putting those concerns into the core runtime would select an operational model
for every host and would blur the existing boundary between Blueprint execution
and application orchestration.

## Options considered

1. Add a durable queue and batch scheduler to the core runtime.
2. Add a transport-neutral queue abstraction to core before a concrete
   production integration exists.
3. Keep durable execution host-owned and introduce an integration plugin only
   after a concrete queue or workflow system supplies testable requirements.

## Decision

Adopt option 3.

The PixieCore core runtime remains asynchronous at the JavaScript API level but
does not create, persist, lease, schedule, resume, or monitor durable jobs.
`ApplicationExecutionController` continues to reject work immediately when an
admission limit is reached and must not create a hidden queue.

A host application or workflow system owns:

- enqueueing, persistence, leasing, visibility timeouts, and scheduling;
- idempotency keys, durable retries, dead-letter handling, and resumption;
- distributed quotas, worker allocation, notifications, and operator controls;
- storage and restoration of business inputs, outputs, and approval state.

A future integration plugin may adapt a specific queue or workflow system to
PixieCore. It must keep these responsibilities explicit, use the existing public
Blueprint and application contracts, and avoid changing offline Blueprint
loading. A generic queue contract will be proposed only when at least three
production integrations demonstrate the same portable boundary.

## Compatibility and migration

There is no public API change. Existing applications continue to call PixieCore
directly or place those calls inside their own worker or workflow handlers.
Applications that need durable execution should persist and retry outside a
PixieCore invocation while retaining the documented single retry owner.

## Consequences

Core execution remains small, deterministic, and deployable without storage or
queue dependencies. Hosts retain control over operational guarantees and data
residency. The accepted cost is that PixieCore does not yet provide a turnkey
durable worker. Integration authors must document their queue semantics and
prove cleanup, cancellation, replay, and idempotency behavior independently.

## Evidence

- `ApplicationExecutionController` already defines immediate, in-process
  admission and cancellation without a hidden queue.
- `executeApplicationNode()` already assigns retry ownership to exactly one of
  runtime, application, or host.
- The packaged application examples and integration guide keep persistence,
  queueing, and side effects in the host.
- `APP-005` and `PROD-004` contract tests cover the boundaries on which this
  decision depends.

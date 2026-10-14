# Application adoption guide

Adopt PixieCore around a coherent business result and its contract. A Blueprint
may use several reasoning Roles and deterministic instructions when they
contribute to that result. The 0.2.x model does not require one Blueprint or
model call per cognitive verb. Keep application orchestration, authorization,
and external side effects in the host unless an explicit tool contract says
otherwise.

## 1. Inventory the current boundary

For each workflow boundary you are considering, record:

- the business result and decision boundary it should own;
- caller-owned inputs and their current validation;
- structured output consumed downstream;
- model/provider configuration and tool access;
- authorization, persistence, retries, and side effects around the call;
- representative successes, boundaries, ambiguities, and failures.

Use this inventory to choose a Blueprint boundary. Related extraction,
classification, validation, calculation, and verification can stay together
when they support one declared result. Split them only when separate ownership,
reuse, deployment, evaluation, or measured execution behavior justifies it.

## 2. Choose a migration shape

| Existing design | First PixieCore step | Preserve outside the Blueprint |
|---|---|---|
| One large prompt | Define a coherent result, its input/output contract, and the Roles needed to produce it | Application state, authorization, and external side effects |
| Direct provider SDK wrapper | Put its prompt contract in one Blueprint and inject the existing provider during tests | Transport rollout and credentials |
| Agent graph | Replace one node body with a Blueprint call | Graph edges, branching, state, and scheduler |
| Workflow engine task | Make the worker execute one Blueprint | Queue, lease, retries, idempotency, and notifications |
| Deterministic policy or calculation | Include it in the Blueprint when it contributes to the declared result; use explicit tools for external capabilities | Runtime mechanics, authorization, and external side effects |

The Blueprint can state deterministic policy and expected outcomes. Runtime
mechanics, database updates, and access-control enforcement remain in the host
application or an explicitly authorized tool.

## 3. Establish the contract before behavior

Create a Blueprint with `pixiecore blueprint create`. Replace the scaffold
with:

1. typed placeholders and an `input_schema` for business inputs;
2. one narrow prompt with explicit unsupported and ambiguity behavior;
3. a strict `output_schema` that downstream code can validate;
4. a versioned evaluation dataset using production-shaped but authorized
   fixtures;
5. an offline public-API test with a deterministic fixture provider.

Keep server-owned caller identity, tenant, permission scope, credentials, and
retention decisions outside business inputs.

## 4. Run old and new paths safely

Introduce an application adapter with one stable input and result type. During
the comparison period:

- run the new path in shadow mode when duplicate provider cost and data policy
  permit it;
- compare schema validity separately from semantic correctness;
- record Blueprint, dataset, provider, model, seed, and run count;
- block new-path side effects until its output is accepted;
- retain the old path behind an explicit rollback switch.

Never log raw sensitive inputs merely to compare implementations. Use
value-free telemetry and an authorized evaluation artifact store.

## 5. Cut over one consumer

Map the Blueprint result into the existing application explicitly. The host
continues to own authorization, retries, persistence, notification, approval,
and external mutations. Cut over one consumer or route, observe it, then widen
the rollout.

Rollback means selecting the previous application path and Blueprint version,
not silently changing the content under an existing version. The repository
version gate requires every semantic content change to advance the Blueprint
version and conservatively requires a major bump for declared contract or
stable-path changes.

## 6. Evolve the boundary from evidence

Split a Blueprint only when another result needs independent ownership,
deployment, reuse, context, or evaluation, or when measurements justify a
separate call. An application can use one or several Blueprints over time. It does not
need a flag-day rewrite or one giant replacement YAML.

## Completion checklist

- Each Blueprint has one verb and one accountable owner.
- Input and output schemas reject malformed values before downstream use.
- Unit datasets cover ordinary, boundary, ambiguous, unsupported, and failure
  cases relevant to the accepted domain.
- Application tests cover mapping, cancellation, failure ownership, and side
  effects separately from Blueprint semantic tests.
- Version pins, data policy, provider/model identity, and rollback are explicit.
- Old behavior is removed only after the support and deprecation window ends.

See [Blueprint granularity](../architecture/blueprint-granularity.md),
[application composition](../architecture/application-composition.md), and
[evaluation](../blueprints/evaluation.md) for the underlying contracts.

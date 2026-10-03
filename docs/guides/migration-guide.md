# Migration guide

Migrate one observable operation at a time. Keep the existing application as
the orchestrator until a Blueprint has a declared contract, offline tests,
versioned evaluation evidence, and a rollback path.

## 1. Inventory the current boundary

For each prompt or model call, record:

- the one business verb it should perform;
- caller-owned inputs and their current validation;
- structured output consumed downstream;
- model/provider configuration and tool access;
- authorization, persistence, retries, and side effects around the call;
- representative successes, boundaries, ambiguities, and failures.

If one call contains several independent verbs, list them separately before
writing YAML. Extraction, classification, validation, translation, and routing
are different Blueprint candidates.

## 2. Choose a migration shape

| Existing design | First PixieCore step | Preserve outside the Blueprint |
|---|---|---|
| One large prompt | Extract one verb with one input/output schema | Existing order, state, and remaining prompt steps |
| Direct provider SDK wrapper | Put its prompt contract in one Blueprint and inject the existing provider during tests | Transport rollout and credentials |
| Agent graph | Replace one node body with a Blueprint call | Graph edges, branching, state, and scheduler |
| Workflow engine task | Make the worker execute one Blueprint | Queue, lease, retries, idempotency, and notifications |
| Deterministic function | Usually keep it as code or expose it as a Tool | Deterministic validation and calculation |

Do not migrate deterministic arithmetic, database updates, or access-control
decisions into a prompt merely to make the application look uniform.

## 3. Establish the contract before behavior

Create a unit with `pixiecore blueprint create`. Replace the scaffold with:

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

## 6. Split the next operation

Repeat the process only where a second operation is independently meaningful.
An application becomes a collection of Blueprint calls over time. It does not
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

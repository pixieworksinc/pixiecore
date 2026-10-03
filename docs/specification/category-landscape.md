# POP and adjacent application patterns

This landscape explains where PixieCore's Prompt-Oriented Programming model
overlaps with adjacent application patterns. It is a structural comparison,
not a product ranking or a remote-model quality benchmark.

Last reviewed: 2026-08-26

## Comparison dimensions

| Pattern | Primary reusable unit | Typed boundary | Control-flow owner | Evaluation unit | Typical strength | Typical limitation |
|---|---|---|---|---|---|---|
| Structured model output | One model response schema | Output schema, sometimes input schema | Caller | One response shape | Reliable machine-readable handoff | Does not by itself define reusable task semantics, datasets, versioning, or composition |
| Prompt template | Parameterized instruction or message sequence | Template variables; output typing varies | Caller | Prompt or invocation | Simple reuse of wording and context assembly | Semantics, evaluation, and version compatibility often remain project conventions |
| Agent graph | Nodes, state, and conditional edges | Framework-specific node/state contracts | Graph runtime and application | Node, trajectory, or final result | Dynamic tool use, branching, and iterative behavior | More execution freedom increases the policy, replay, and evaluation surface |
| Workflow engine | Durable task or activity | Workflow/activity contracts | Workflow runtime | Activity and workflow run | Scheduling, persistence, retries, timers, and operational recovery | Cognitive task semantics and model evaluation remain separate concerns |
| Code-only pipeline | Function, class, or service call | Host-language types and tests | Application code | Function or integration test | Maximum local control and direct use of language tooling | Cross-language portability and data-only sharing require additional conventions |
| PixieCore Blueprint | One small typed cognitive operation | Typed placeholders plus input/output JSON Schema | Host application | Versioned Blueprint dataset and result | Portable, independently testable cognitive units with explicit host boundaries | PixieCore 0.1 intentionally does not own durable workflows, UIs, databases, or final side effects |

These patterns can be combined. A workflow activity can call a PixieCore
Blueprint; an agent graph can expose a Blueprint through MCP; a code-first
application can compose several Blueprints; and every one of those calls may
use structured output.

## What is distinctive in PixieCore

PixieCore makes the following combination the default unit contract:

- one independently meaningful cognitive operation per Blueprint;
- typed business input and structured output contracts;
- versioned data-only YAML, with no executable package privilege;
- versioned evaluation datasets and explicit semantic comparison;
- provider-independent application composition through public runtime calls;
- explicit Tool, Role, Provider, Decorator, permission, retry, cancellation,
  persistence, and side-effect ownership boundaries; and
- offline validation, fixture evaluation, packaging, and conformance checks.

None of these properties alone is unique. The category claim concerns their
combination around a small, portable cognitive unit.

## Boundary examples

### Use structured output alone when

One call is local to one application, the schema is the only reusable contract,
and no independent versioned dataset or cross-application unit is needed.

### Use a prompt template when

The main reusable asset is message construction and the surrounding application
already owns validation, evaluation, versioning, and lifecycle.

### Use an agent graph when

Runtime exploration, conditional tool selection, or iterative planning is part
of the required behavior. A graph node may still call one or more Blueprints
for constrained typed operations.

### Use a workflow engine when

The requirement is durable scheduling, persistence, retries, timers, approval
waits, or operator recovery. PixieCore deliberately leaves those responsibilities
to the host under TC-ADR-0003.

### Use a code-only pipeline when

The work is deterministic, tightly coupled to one codebase, or gains no value
from a portable data-only cognitive contract. PixieCore applications themselves
remain code-first in 0.1.

### Use a Blueprint when

A cognitive operation should be named, typed, versioned, evaluated, reused, and
composed independently from the surrounding application or provider.

## Evidence status

| Claim | Current evidence | Status |
|---|---|---|
| One Blueprint can be validated and evaluated independently | Public schemas, CLI workflow, and contract tests | Verified repository contract |
| Multiple Blueprints can form an application without a workflow DSL | Four code-first reference applications | Verified repository example |
| The same task can be shaped as one prompt or five Blueprints | Executable publication-brief comparison | Verified structural comparison |
| Fixture regression accuracy across eight reference roles | 71 canonical offline cases and the quality catalog | Verified offline contract evidence |
| Remote-model accuracy, latency, and cost versus adjacent patterns | Four-case, four-approach, three-run OpenAI benchmark with value-free report | Measured for the publication-brief corpus; not a universal ranking |
| Development time and change impact in real organizations | Three independent production pilots | Pending `ADOPT-004` |

The pending rows must not be replaced with estimates or subjective rankings.
PixieCore does not currently claim higher accuracy, lower cost, or faster
development than every adjacent approach.

## Maintenance procedure

Update this page when a public PixieCore contract changes, an adjacent pattern
is added, or new reproducible evidence is published. Each update must:

1. identify whether a statement is a contract fact, executable example,
   measured result, or interpretation;
2. link the PixieCore evidence and state unavailable evidence explicitly;
3. compare the same task, dataset, provider/model, run count, and environment
   for quantitative claims;
4. preserve use cases where an adjacent pattern is the simpler choice; and
5. update the review date without silently rewriting historical benchmark
   artifacts.

See [POP concepts](pop-concepts.md),
[monolithic/composed comparison](../architecture/monolithic-comparison.md),
[application composition](../architecture/application-composition.md), and
[evaluation](../blueprints/evaluation.md).

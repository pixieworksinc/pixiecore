# POP in one page

## Thirty-second explanation

Prompt-Oriented Programming describes business behavior in a Blueprint and
executes it with an LLM. That behavior can include deterministic comparisons,
branching, arithmetic, validation, conversion, and routing. Several reasoning
Roles can work inside one Blueprint to produce its declared result.

PixieCore supplies the TypeScript runtime mechanics: loading, input binding,
structural contracts, provider calls, and output validation. POP's question is
how accurately a probabilistic runtime can execute the prompt-defined
specification. See [POP principles](pop-principles.md) for the original project
direction and the status of this `0.2.x` development branch.

## Concrete example

The [Customer discount example](../../examples/customer-discount/README.md)
keeps the entire discount policy and calculation in one Blueprint. Classifier
checks exact Gold membership and a strict amount threshold. Converter computes
the final price. Verifier rechecks the comparisons and arithmetic. Orchestrator
returns only the declared JSON.

PixieCore delivers those instructions to the LLM. The 18-case dataset then
compares the result with explicit expected outcomes. A schema-valid answer can
still fail that comparison.

## Responsibility boundaries

| Part | Responsibility |
|---|---|
| Blueprint | Business rules, reasoning Roles, input/output contract, examples |
| LLM | Execute the declared comparisons, decisions, transformations, and verification |
| Runtime | Parse and bind instructions, enforce structural and authorization contracts, call providers, validate returned structure |
| External capability | Fetch data or carry out an explicitly authorized external action |
| Evaluation | Compare observed business results with versioned expected outcomes and record execution evidence |

Small reusable Blueprints and composition across calls remain possible.
Neither a single cognitive verb nor relocation of deterministic policy into
host code is mandatory.

## Accuracy claims

Schemas prove shape. Offline provider captures prove delivery and runtime
behavior. Mock evaluation proves the comparison machinery works. Repeated
real-provider evaluation measures model accuracy under a particular Blueprint,
corpus, provider, model, and sampling configuration. Keep those claims separate.

## Current status

Text prompts and structured ordered Scenario arrays are supported on `0.2.x`.
The validated runtime `Blueprint.prompt` stays text for existing Role plugins.
Published portable POP 0.1 identifiers remain unchanged; the conceptual change
is proposed in [POP-RFC-0004](../rfcs/0004-prompt-first-business-logic.md).

See [POP concepts](pop-concepts.md),
[Blueprint granularity](../architecture/blueprint-granularity.md), and the
[0.2 development plan](../project/0.2-development.md) for migration and remaining
work.

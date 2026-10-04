# Prompt-Oriented Programming principles

This is the working direction for the PixieCore `0.2.x` development branch.
It restores the original POP model at the project owner's request. It is not a
published portable conformance profile. The versioned POP 0.1 specification,
schemas, and fixtures remain archived under their existing identifiers.

## Business logic is prompt-first

POP describes business behavior in a Blueprint and uses an LLM as its execution
runtime. Comparisons, Boolean conditions, branching, arithmetic, validation
rules, conversion, and routing can all belong in the instructions. A
deterministic specification is a valid POP target.

The research question is how reliably a probabilistic runtime can reproduce
that specification. Moving a discount policy into a TypeScript function changes
what is being evaluated; it does not demonstrate better LLM execution of the
policy.

## Roles divide reasoning inside a Blueprint

A Blueprint can contain several ordered Roles serving one declared business
result. For example, Classifier selects the discount, Converter computes the
price, Verifier checks both, and Orchestrator returns the final JSON. These
Roles do not require separate files, provider calls, or host-code steps.

Text prompts remain supported. PixieCore also accepts a structured `prompt`
with an optional `agent_role` and a non-empty `Scenario` array. Each step has
`Role` and `Instruction`; the instruction contains `Given`, `When`, `Then`,
and optionally `And` as a string or a non-empty array of strings.

The validator serializes this object to YAML text, preserving Scenario array
order, then the existing renderer binds inputs. The LLM interprets and executes
the instructions. PixieCore does not compile a Scenario into host-code
comparisons, arithmetic, or a separate workflow interpreter.

Top-level `role` selects a registered message-preparation plugin. Inner `Role`
and `agent_role` values are reasoning hints delivered to the LLM; they do not
select plugins or grant permission to execute tools.

## Runtime mechanics and business behavior have different responsibilities

TypeScript still implements loading, serialization, input binding, structural
contracts, authorization enforcement, provider transport, schema validation,
retries, and evaluation. Explicit external capabilities can fetch data or carry
out authorized side effects. Their implementations and permissions must remain
visible.

Those mechanisms support prompt execution. They must not silently substitute
an ordinary-code implementation for the business policy declared in a
Blueprint. Existing host-composition helpers remain compatible integration
facilities; they are not the definition of POP.

## Correctness requires measured evidence

Output-schema validation proves shape and types. It cannot establish that the
chosen discount or calculated price matches the inputs. Role verification and
self-evaluation can help, but they are also fallible model behavior.

Versioned expected outcomes, exact or explicitly defined semantic comparisons,
boundary cases, and repeated real-provider runs measure correctness. Report
Blueprint and dataset versions, provider, model, sampling settings, run count,
case accuracy, latency, and cost when available. Neither `temperature: 0` nor
an offline mock-provider test proves deterministic LLM behavior.

The [customer discount example](../../examples/customer-discount/README.md)
keeps the policy and arithmetic in the prompt. Its offline tests verify runtime
delivery and the evaluator's ability to detect wrong answers. They make no
model-accuracy claim.

## Source direction and provenance

The supplied June 9, 2025 POP specifications describe direct Blueprint
execution by a probabilistic runtime. The supplied November 17, 2025 DrupalCon
Nara presentation and June 27, 2026 DrupalCamp Tokyo presentation provide the
original project context. The Tokyo deck shows ordered Roles inside one
Blueprint (slide 50) and proposes expressing conventional `if` behavior in
prompts (slide 10).

The owner explicitly confirmed on October 4, 2026 that deterministic business
logic should remain LLM-executed and that Role decomposition can remain inside
a Blueprint. This document records that direction without redistributing the
supplied PDFs or copying their implementation code.

The proposed portable-model change is tracked in
[POP-RFC-0004](../rfcs/0004-prompt-first-business-logic.md). The branch migration
and remaining work are tracked in the [0.2 development plan](../project/0.2-development.md).

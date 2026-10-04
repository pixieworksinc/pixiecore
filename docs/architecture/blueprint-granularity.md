# Blueprint granularity guide

A Blueprint declares prompt-first business behavior with an explicit input
and output contract. It may contain several reasoning Roles and deterministic
logic. Granularity follows the business result and measured execution behavior,
not a mandatory one-cognitive-verb rule.

Read [POP principles](../specification/pop-principles.md) and the
[canonical glossary](../specification/pop-concepts.md) first.

## Choose a coherent business contract

Keep related comparisons, calculations, and verification together when they
serve one declared result. The Customer discount Blueprint can classify
eligibility, calculate the price, verify both, and return the final JSON.
A travel-policy Blueprint can extract request facts, classify the destination,
validate expenses, and recommend an approval result.

Small independently testable Blueprints remain useful. Split when different
results need independent ownership, deployment, reuse, context, or evaluation,
or when measured accuracy, latency, and cost justify separate calls. Do not
split merely because instructions use more than one Role.

## Roles inside a Blueprint

Role decomposition is a prompt structure. A structured `Scenario` array can
declare Classifier, Converter, Verifier, and Orchestrator instructions in order.
The runtime validates and serializes the array; the LLM executes its meaning.
One Role does not imply one provider invocation or a TypeScript workflow node.

Plain text supports the same reasoning decomposition. Compare the two
representations using the same business input corpus and model configuration.

## Deterministic specifications

An exact `Gold` comparison, a strict amount threshold, percentage conversion,
and price arithmetic are valid Blueprint instructions. Their deterministic
expected results create useful, stringent semantic tests for the probabilistic
runtime. They are not an anti-pattern simply because ordinary code could
implement them.

Keep expected outcomes in evaluation fixtures. Do not move the tested policy
into host code and then label successful host calculation as LLM accuracy.

## Runtime and external capabilities

Runtime mechanics still use code for parsing, binding, schemas, authorization,
provider transport, lifecycle, and evaluation. Explicit external capabilities
can fetch records, persist an approved result, or notify a recipient through
authorized integrations. Declaring a policy result in a prompt does not itself
perform or authorize those side effects.

Any tool-executed calculation, cache hit, or compiled execution path must be
identified when reporting model-execution evidence. The default example for
this branch keeps discount logic in the LLM instructions.

## Review checklist

1. Does the Blueprint state an understandable business result and contract?
2. Are all policy conditions and arithmetic explicit in its instructions?
3. Do its Roles serve that result and have an explicit reasoning order?
4. Do schemas express structural constraints without claiming semantic proof?
5. Do fixtures cover normal inputs, boundaries, and likely logical mistakes?
6. Does real-provider evidence identify model, settings, run count, errors,
   accuracy, latency, and cost?
7. Are external effects and any delegated logic visible and authorized?

See the [Customer discount example](../../examples/customer-discount/README.md)
and the [0.2 development plan](../project/0.2-development.md).

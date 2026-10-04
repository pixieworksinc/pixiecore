# Prompt-Oriented Programming concepts

POP defines business behavior in prompts and uses an LLM as the execution
runtime. Deterministic rules, arithmetic, and branching are part of this model.
See [POP principles](pop-principles.md) for the original direction and the
status of the `0.2.x` development branch.

## Current PixieCore scope

`execute()` and `executeYaml()` execute one Blueprint per call. That Blueprint
can contain several reasoning Roles inside one text prompt or structured
Scenario array. The built-in path delivers all those instructions in one
provider request; tool or output-validation retry rounds remain possible when
configured. Scenario order is an instruction to the LLM, not a claim that host
code independently executed or verified each Role.

Existing host-composition helpers remain available for integrations. PixieCore
does not require a workflow to be split into one Blueprint per cognitive verb
and does not relocate business rules to ordinary code merely because they are
deterministic.

## Canonical glossary

### Prompt-Oriented Programming (POP)

A programming model in which business logic is described in Blueprints and
executed through an LLM. Its accuracy target may be a deterministic
specification. Contract validation, examples, Role decomposition,
self-evaluation, and repeated semantic evaluation support the execution.

POP does not prescribe a provider, host language, transport, storage system,
or user interface.

### Blueprint

A versioned declaration of business behavior with inputs, instructions, an
output contract, and optional examples and execution settings. It can contain
multiple Roles serving the declared result. A complete discount calculation
or travel-policy decision can be one Blueprint when its contract and
evaluation corpus are explicit.

The exported `Blueprint` type describes the validated runtime representation.
Its `prompt` remains a string. A structured source `prompt` is validated and
serialized to YAML instruction text before the existing binding and Role
plugin path. `ScenarioPrompt` and `ScenarioPromptStep` describe authoring
structures; they do not provide an executable host workflow.

### Application

A usable system whose business behavior is expressed through one or more
Blueprints, with interfaces, data, persistence, and explicit external
capabilities. TypeScript can supply infrastructure and integration mechanics.
It is not required to implement the application's deterministic business rules.

Application decomposition is a design choice evaluated against domain scope,
context, reliability, latency, and cost. A graph of small Blueprints is one
option; it is not the definition of POP.

### Role

A reasoning responsibility such as Extractor, Classifier, Summarizer,
Validator, Verifier, Converter, Translator/Localizer, or Router/Orchestrator.
Several Roles can cooperate inside one Blueprint.

PixieCore has a separate message-preparation mechanism: top-level `role`
selects a registered `AgentRolePlugin`. The inner `Scenario[].Role` and
`prompt.agent_role` are hints in model instructions. They need no plugin
registration and grant no execution capability. Existing Role plugins continue
to receive rendered text.

### Tool

A named capability with a declared argument contract and an explicit
implementation. Tools can provide external data or perform authorized side
effects. They are allowlisted and their arguments are validated before
execution.

A Tool is not the mandatory implementation of a deterministic business rule.
If an experiment delegates calculation to a Tool, its evidence must identify
that delegation instead of claiming the LLM performed the calculation.

### Plugin

A trusted executable package that contributes runtime implementation
components, such as providers, message-preparation Roles, decorators, tools,
or transport services. Plugins have their own lifecycle and permission
boundaries. They implement runtime capabilities; they do not determine which
business logic is eligible for a Blueprint.

### Orchestrator

A Role coordinating the declared reasoning steps and producing the final
result. It can live inside one Blueprint. This is distinct from a host service
that schedules provider calls, stores state, enforces authorization, or carries
out external actions.

### Validation, verification, and evaluation

Structural validation checks declaration shape, typed inputs, and output
schemas. Business validation and verification can be LLM-executed Roles.
Semantic evaluation independently compares observed results with the expected
business outcome. Schema success alone proves neither semantic correctness nor
determinism.

## Example

The [Customer discount Blueprint](../../examples/customer-discount/README.md)
contains Classifier, Converter, Verifier, and Orchestrator Roles. They evaluate
the policy, compute the price, recheck it, and return one JSON result through
the LLM runtime. The host does not replace any of those business steps with
a discount function.

For decomposition choices, see the
[Blueprint granularity guide](../architecture/blueprint-granularity.md). For
the transition from inherited code-first examples, see
[application composition](../architecture/application-composition.md).

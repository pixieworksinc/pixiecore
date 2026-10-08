# Prompt-Oriented Programming concepts

Prompt-Oriented Programming (POP) builds applications from small, typed,
testable cognitive functions. PixieCore is a TypeScript runtime for executing
those functions as Blueprints.

The central rule is:

> A Blueprint is one typed cognitive function. An application is a collection
> or graph of Blueprints.

For example, converting `2026年2月4日` to `2026-02-04` is an appropriate
Converter Blueprint. A complete travel-approval process is an application that
combines Extractor, Classifier, Validator, Verifier, Converter, Summarizer,
Translator or Localizer, and Router or Orchestrator operations.

## Current PixieCore scope

PixieCore 0.1 validates and executes one Blueprint per
`PromptRuntime.execute()` or `PromptRuntime.executeYaml()` call. An application
can already compose several calls in TypeScript host code. PixieCore 0.1 does
not expose a first-class `Application` or `Orchestrator` API and does not define
a general workflow language.

This distinction separates the current public contract from future
composition work. Conceptual mappings below do not promise APIs that PixieCore
does not currently export.

## Concept map

```text
Application or host service
  └─ Orchestrator chooses order and maps data
       ├─ Blueprint: extract fields
       ├─ Blueprint: normalize a date
       ├─ Blueprint: classify a destination
       └─ Blueprint: select the next approver

PromptRuntime executes each Blueprint
  ├─ Role constructs provider messages
  ├─ Tools provide bounded external capabilities
  └─ Plugins register reusable implementation components
```

## Canonical glossary

### Prompt-Oriented Programming (POP)

**Definition:** POP is a programming model in which independently typed and
tested cognitive functions are composed into applications.

**Owns:** the unit of decomposition, the contract around each cognitive
operation, independent evaluation, replaceability, and composition principles.

**Does not own:** a particular model provider, programming language, user
interface, storage engine, deployment platform, or universal workflow syntax.

**TypeScript mapping:** an architectural programming model rather than one
TypeScript interface. PixieCore supplies the runtime and contracts used by a POP
application.

### Blueprint

**Definition:** A Blueprint is a versioned declaration of one cognitive
operation with named inputs, a role, instructions, and a JSON Schema output.

**Owns:** one input-to-output transformation, its prompt contract, input
declarations, output shape, examples, and operation-level policy such as tools
or permissions.

**Does not own:** an entire application, unrelated business decisions,
application state, transport, persistence, arbitrary loops, deployment, or the
lifecycle of downstream systems.

**TypeScript mapping:** the exported `Blueprint` interface describes the
validated declaration. Calling `PromptRuntime.execute()` resembles invoking an
asynchronous typed function, although the public return type remains a JSON
object whose runtime shape is enforced by the Blueprint's `output_schema`.

Conceptually:

```ts
type BlueprintFunction<Input, Output> = (input: Input) => Promise<Output>;
```

This alias explains the intended granularity; it is not a PixieCore export.

### Application

**Definition:** An application is a deployable behavior made by composing
multiple Blueprint operations with deterministic code, tools, data, and user
interfaces.

**Owns:** the call graph, data mapping between operations, state, application
errors, budgets, cancellation, persistence, authorization context, and user or
system side effects.

**Does not own:** the internal prompt instructions or evaluation corpus of
every component Blueprint.

**TypeScript mapping:** currently an application service or ordinary function
that owns a `PromptRuntime` and calls `execute()` or `executeYaml()` for each
required Blueprint. `Application` is not a PixieCore 0.1 public type.

### Role

**Definition:** A Role is a reusable strategy that turns a rendered Blueprint
prompt into canonical provider messages and optional model defaults.

**Owns:** supported role names, system and user message construction, and
optional model or temperature defaults.

**Does not own:** the application workflow, Blueprint output schema, provider
transport, permissions, or the complete business task.

**TypeScript mapping:** the exported `AgentRolePlugin` interface. A Blueprint's
`role` selects one registered implementation.

Names such as Extractor, Classifier, Summarizer, Validator, Verifier,
Converter, Translator or Localizer, and Router or Orchestrator describe useful
behavioral families. Each concrete Blueprint should still perform only one
operation.

### Tool

**Definition:** A Tool is a named, schema-described capability that a provider
may invoke while executing a Blueprint.

**Owns:** its argument schema, bounded implementation, returned result, and any
explicitly authorized side effect.

**Does not own:** the Blueprint contract, model reasoning, application graph,
or unrestricted access to every host capability.

**TypeScript mapping:** the exported `RegisteredTool` interface. A Blueprint's
`tools` list is an allowlist; the runtime validates provider-supplied arguments
before calling its `execute` handler.

### Plugin

**Definition:** A Plugin is a trusted ES-module package that contributes
reusable runtime implementation components.

**Owns:** declared roles, decorators, tools, providers, dependencies, lifecycle,
and cleanup for the components it contributes.

**Does not own:** a complete application by default, the content of every
Blueprint, process isolation, or automatic trust. Plugin code executes with the
Node.js process's permissions.

**TypeScript mapping:** third-party authors use the exported `PixieCorePlugin`,
`AgentRolePlugin`, `OutputDecorator`, `RegisteredTool`, and provider contracts
from `@pixieworks/pixiecore/plugin`.

Blueprints and plugins are different units: a Blueprint is a declarative
cognitive function; a plugin supplies executable runtime capabilities that one
or more Blueprints may use.

### Orchestrator

**Definition:** An Orchestrator chooses which operation runs next and maps the
current application state into the next operation's input.

**Owns:** sequencing, routing, branching, parallelism, error routing, data
mapping, and application-level stop conditions.

**Does not own:** every operation's prompt, one giant output schema, unrelated
business decisions, or hidden side effects. An Orchestrator should not turn a
Blueprint into a monolithic workflow.

**TypeScript mapping:** currently an application service or function in host
code. A narrow Router Blueprint may recommend a next user or route from a CSV
routing table, but host code remains responsible for actually sending,
persisting, approving, or invoking the next step. `Orchestrator` is not a
PixieCore 0.1 public type.

## How to choose a Blueprint boundary

A good default boundary has one independently meaningful verb, one declared
input contract, and one declared output contract. It can be tested and replaced
without rewriting unrelated operations.

Good boundaries include:

- extract requested form fields from one document;
- classify one destination under one supplied travel policy;
- validate one form against one rule set;
- compare submitted fields with extracted evidence;
- convert one date expression to a declared format;
- choose the next approver from one routing table.

If a unit extracts a document, applies policy, approves the request, sends a
message, and updates a database, it is an application or workflow, not one
Blueprint.

Use the [Blueprint granularity guide](../architecture/blueprint-granularity.md) for the complete
boundary test, recommended examples, anti-patterns, and review checklist.
Normative, implementation-independent requirements are defined by the
[POP Core Specification 0.1](pop-core-specification-0.1.md).

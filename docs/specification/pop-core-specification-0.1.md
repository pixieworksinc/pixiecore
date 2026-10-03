# Prompt-Oriented Programming Core Specification 0.1

- Status: Draft specification
- Version: 0.1

Changes to this specification follow the public [POP specification governance
process](pop-governance.md). Published version identifiers are immutable.

## 1. Scope

Prompt-Oriented Programming (POP) is a programming model for building
applications from small, typed, independently testable cognitive functions
called Blueprints.

This specification defines:

- the abstract Blueprint data model;
- the observable behavior of validators and runtimes;
- input, output, error, and cancellation boundaries;
- independent semantic evaluation;
- application-composition responsibilities; and
- conformance claims and optional-capability reporting.

This specification does not select a programming language, file format, model
provider, transport, storage system, plugin mechanism, user interface, or
workflow language. The versioned [POP 0.1 serialization
schemas](pop-schemas-0.1.md) are separate artifacts, as are the conformance
fixtures.

## 2. Normative language

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
RECOMMENDED, MAY, and OPTIONAL are to be interpreted as described by RFC 2119
and RFC 8174 when, and only when, they appear in all capitals.

## 3. Core concepts

### 3.1 Cognitive operation

A cognitive operation maps declared input to structured output where natural
language interpretation, classification, extraction, summarization,
verification, conversion, localization, or routing judgment may be required.
Deterministic code MAY perform all or part of an operation.

### 3.2 Blueprint

A Blueprint is a versioned declaration of exactly one cognitive operation. It
MUST be independently validatable, executable, and evaluable without executing
an entire application.

A Blueprint MUST NOT conceal unrelated workflow control, persistence,
notification, approval, or deployment behavior inside its instructions.

### 3.3 Application

An application is a collection or graph of Blueprint invocations combined with
deterministic code, tools, data, and interfaces. The application owns control
flow, state, mappings, authorization context, persistence, and side effects.

### 3.4 Role

A Role identifies the behavioral strategy used to prepare or execute one
Blueprint operation. Role identifiers form an open set. A runtime MUST report
an unsupported Role explicitly and MUST NOT silently substitute a different
Role.

### 3.5 Tool

A Tool is a named capability with a declared argument contract and a bounded
implementation. Tool execution is OPTIONAL. When supported, a runtime MUST
validate generated arguments before invoking the Tool and MUST restrict
available Tools to the Blueprint's declared allowlist.

## 4. Blueprint abstract data model

A Blueprint declaration MUST contain:

1. a non-empty human-readable name;
2. a numeric `major.minor` or `major.minor.patch` version;
3. a non-empty Role identifier;
4. non-empty instructions for one cognitive operation; and
5. an output contract expressed as JSON Schema.

A Blueprint declaration MAY contain:

- named or typed input declarations;
- an input contract expressed as JSON Schema;
- examples;
- localization settings;
- Tool identifiers;
- model-selection hints;
- sampling hints;
- authorization-policy metadata; and
- namespaced extensions.

If no input declaration or input schema is present, the effective input
contract is an unconstrained JSON object. A runtime MUST NOT infer required
input fields solely from prose instructions.

The output contract MUST describe a JSON object. Schema success proves only
structural validity; it MUST NOT be reported as semantic correctness.

An implementation MUST reject an invalid required field. It MAY ignore an
unsupported optional extension, but it MUST preserve the distinction between
an ignored optional extension and an unsupported capability required for
execution.

## 5. Blueprint boundary

A conforming Blueprint MUST have one independently meaningful verb, one input
boundary, and one output boundary. It SHOULD be replaceable without modifying
the fixtures or instructions of unrelated Blueprints.

The following are appropriate boundaries:

- extract requested fields from one document;
- classify one item under one supplied policy;
- summarize one supplied record without adding claims;
- validate one form against one supplied rule set;
- compare one submitted record with one evidence record;
- convert one expression to one declared representation;
- localize one text while preserving declared terms; or
- recommend one next route from one supplied routing table.

A declaration that extracts data, applies several unrelated policies, approves
a request, sends a notification, and updates storage is an application, not one
Blueprint.

## 6. Validation and execution

### 6.1 Declaration validation

A validator MUST validate the required abstract fields and every declared JSON
Schema without contacting a model provider or executing a Tool.

A runtime MUST perform declaration validation before an execution attempt.
Invalid declarations MUST fail before provider, Tool, or application side
effects.

### 6.2 Input processing

A runtime MUST accept one JSON object as business input. It MUST validate that
input against the effective input contract before cognitive execution.

If an implementation supports declared defaults or type normalization, it MUST
apply them deterministically before input-schema validation and MUST document
the rules. It MUST NOT silently repair a value that cannot be normalized under
those rules.

Authentication and authorization context are host-owned execution context.
They MUST NOT be inserted into business input unless the Blueprint explicitly
declares them as business fields.

### 6.3 Instruction rendering

Every referenced named input MUST be resolved from the normalized business
input. A missing required value MUST fail before cognitive execution. Rendering
MUST NOT reinterpret control-flow syntax or execute embedded host-language
code.

### 6.4 Cognitive execution

A runtime MAY use a remote model, a local model, deterministic code, a human
operation, or a combination of these mechanisms. The mechanism MUST NOT change
the declared input and output boundaries.

Provider, model, temperature, seed-like controls, and Tool use that can affect
results SHOULD be exposed as execution metadata. Credentials MUST NOT appear in
results, replay commands, or evaluation artifacts.

### 6.5 Output processing

A successful execution MUST return one JSON object satisfying the declared
output schema. A runtime MUST NOT return structurally invalid output as a
success.

A runtime MAY attempt output correction. Correction attempts MUST be bounded,
MUST retain the same Blueprint and input contract, and MUST be distinguishable
from application-level retries.

### 6.6 Cancellation

A runtime MUST accept or provide an equivalent cancellation mechanism. Once an
execution is cancelled, the runtime MUST NOT begin a later Tool or correction
attempt for that execution. Cancellation MUST NOT be converted into an
ordinary semantic failure.

## 7. Errors

A conforming implementation MUST distinguish at least:

- invalid Blueprint declaration;
- invalid business input;
- unsupported required capability or Role;
- cognitive execution failure;
- invalid structured output; and
- cancellation.

Errors SHOULD identify the Blueprint version and failed stage. They MUST NOT
include credentials. Implementations SHOULD avoid retaining raw inputs and
outputs in errors unless an explicit host policy authorizes that retention.

## 8. Semantic evaluation

Every published Blueprint SHOULD have a versioned evaluation dataset that is
independent from application end-to-end tests. Each case MUST define:

- a stable case identifier;
- JSON business input;
- expected JSON output;
- an explicit comparison policy; and
- tags sufficient to identify ordinary, boundary, ambiguous, and failure
  behavior.

Comparison MAY be exact, schema-only, selected-field, set-equivalent,
numeric-tolerance, or a named custom comparator. A custom comparator MUST be
versioned or otherwise reproducibly identified.

An evaluation result MUST distinguish schema pass rate from semantic pass rate.
Any accuracy claim MUST state the Blueprint version, dataset version, case
count, run count, execution mechanism, and comparison method. Model-based
execution SHOULD also record provider, model, execution time, and available
sampling controls.

Failed randomized evaluations MUST report a replay value or seed when the
execution mechanism provides one. Repeating the same seed and inputs MUST be
possible without changing the dataset.

## 9. Application composition

An application MAY invoke a Blueprint more than once and MAY combine different
Blueprint versions. It MUST explicitly own:

- node order, branching, joining, and parallelism;
- mapping one output into another input;
- application state and persistence;
- authorization and tenant boundaries;
- application budgets, deadlines, and retry policy;
- notifications, approvals, writes, and other side effects; and
- end-to-end failure and compensation behavior.

Mapping MUST be testable independently of model output generation. An
application MUST NOT rely on undeclared field-name matching or hidden coercion
between Blueprint boundaries.

Runtime-level output correction and application-level retry MUST have one
explicit owner at a time. Cancellation MUST propagate across active nodes and
MUST prevent unstarted dependent nodes from beginning.

POP does not require a workflow serialization. Host-language code, an existing
workflow engine, or an agent graph MAY own composition if the Blueprint
boundaries remain observable and independently evaluable.

## 10. Security and side effects

Blueprint declarations are data and MUST NOT gain executable-code authority
merely by being loaded. A distribution MAY contain executable extensions, but
their trust level MUST be represented separately from data-only Blueprints.

Network retrieval, Tool execution, filesystem access, approval, notification,
and persistence are side effects. A runtime MUST NOT perform them implicitly
because prose instructions mention them. The host or an explicitly enabled
capability MUST authorize each side-effect boundary.

Implementations SHOULD support redaction and retention policy at the host
boundary. Metadata labels such as access level or sensitivity MUST NOT be
treated as authorization grants by themselves.

## 11. Versioning and compatibility

Blueprint versions identify behavior and contract revisions. A publisher MUST
change the version when instructions, input behavior, output behavior, or
policy can change an observable result.

A compatible update MUST preserve every previously valid required input and
the meaning of every previously promised output field. Adding a required input,
removing an output field, changing a field's meaning, or changing a documented
semantic policy is incompatible.

Applications SHOULD pin Blueprint versions. Distribution systems SHOULD retain
or make recoverable the previous pin because even compatible model-facing
changes can alter observed results.

## 12. Conformance

An implementation MAY claim one of two Core 0.1 profiles:

### 12.1 POP Core 0.1 Validator

A conforming Validator MUST implement declaration and JSON Schema validation
defined in Sections 4 and 6.1. It MUST report unsupported required capabilities
without executing the Blueprint.

### 12.2 POP Core 0.1 Runtime

A conforming Runtime MUST satisfy the Validator profile and Sections 6, 7, and
10. It MUST preserve the runtime/application responsibility boundary defined
in Section 9 and expose enough execution metadata to identify the Blueprint
version and execution mechanism.

A conformance statement MUST list supported OPTIONAL capabilities, including
Tools, multimodal input, localization, examples, authorization policy,
correction, and provider selection. Absence of an OPTIONAL capability is not a
Core violation when it is reported before execution.

Conformance is established by the versioned [POP Core 0.1 conformance
fixtures](pop-conformance-0.1.md), not by implementation language, package
name, or self-assertion alone.

## 13. Non-goals

POP Core 0.1 does not define:

- a universal application or workflow language;
- a provider wire protocol;
- model quality thresholds for every domain;
- a plugin sandbox;
- a hosted registry or trust authority;
- storage, queue, cache, or vector-database APIs;
- human-review user interfaces; or
- automatic authority to perform external side effects.

These capabilities may be specified independently without enlarging the
Blueprint unit.

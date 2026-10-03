# POP in one page

## Thirty-second explanation

Prompt-Oriented Programming (POP) treats one AI-assisted operation as a small,
typed, independently testable Blueprint. A Blueprint is comparable to an
interface method: it declares inputs, one cognitive behavior, and a JSON Schema
output. An application combines many Blueprint calls with deterministic code,
tools, data, and interfaces. PixieCore is the TypeScript runtime that validates
and executes each Blueprint.

```text
Blueprint = one typed cognitive function
Application = a collection or graph of Blueprint calls
PixieCore = the runtime that validates and executes each call
```

POP is not a request to put an entire workflow into one prompt or YAML file.

## One-page model

```text
Travel-approval application (host code owns control and side effects)

 PDF / screenshot       Web form        Policies and routing CSV
        │                   │                       │
        ▼                   │                       │
 ┌─────────────┐            │                       │
 │  Extractor  │──fields────┤                       │
 └─────────────┘            │                       │
        │                    ▼                       │
        │             ┌─────────────┐                │
        ├────────────▶│  Verifier   │                │
        │             └─────────────┘                │
        ▼                    ▲                        │
 ┌─────────────┐             │                        │
 │  Converter  │──date───────┤                        │
 └─────────────┘             │                        │
        │                    │                        │
        ▼                    │                        │
 ┌─────────────┐             │                        │
 │ Classifier  │◀────────────┴────travel policy──────┤
 └─────────────┘                                      │
        │                                             │
        ▼                                             │
 ┌─────────────┐                                      │
 │  Validator  │◀────────────validation rules────────┤
 └─────────────┘                                      │
        │                                             │
        ▼                                             │
 ┌─────────────┐       ┌──────────────────────┐       │
 │ Summarizer  │──────▶│ Translator/Localizer │       │
 └─────────────┘       └──────────────────────┘       │
                                │                     │
                                ▼                     │
                         ┌─────────────┐               │
                         │   Router    │◀──routing CSV─┘
                         └─────────────┘
                                │
                                ▼
                    typed next-user recommendation

 Host code authorizes and performs persistence, notification, and approval.
```

Each box has its own input schema, output schema, fixtures, expected results,
version, and failure report. The application has an end-to-end test in addition
to those independent Blueprint tests.

## One operation, not one application

An appropriate Converter Blueprint does this:

```text
input:  "2026年2月4日"
output: { "date": "2026-02-04" }
```

It does not also extract a receipt, approve a trip, send email, and update a
database. Those are separate operations or application responsibilities.

This boundary reduces the model's freedom, makes expected results concrete,
and allows one failed operation to be improved or replaced without rewriting
the entire application.

## Five-minute demonstration script

This is the canonical presentation sequence. The complete runnable eight-Role
application is packaged under `examples/application-composition/`. It is a
code-first example built from public PixieCore APIs, not a general workflow DSL
or a first-class `Application` orchestration API.

### 0:00–0:30 — State the problem

“Large prompts mix extraction, policy, validation, translation, and routing.
When the result is wrong, we cannot isolate which behavior failed, and a small
change can alter everything.”

### 0:30–1:00 — Give the rule

“POP makes each cognitive operation a typed Blueprint. The application is the
collection of those Blueprints. PixieCore validates and executes each one.”

Show the three-line definition at the top of this page.

### 1:00–1:45 — Show one atomic Blueprint

Use the date Converter example. Point out its one input, one output, narrow
schema, and expected result. Explain that date validity can be checked with
deterministic code after natural-language interpretation.

### 1:45–2:45 — Show independent testing

Present ordinary, boundary, ambiguous, invalid, locale, and leap-year cases.
Report schema pass rate separately from semantic pass rate. Include dataset
version, provider/model configuration, run count, and a replay command for any
failure.

Do not say “100% accurate” without the tested domain, dataset size, model, run
count, and comparison method.

### 2:45–3:45 — Compose the application

Show the travel-approval diagram. Explain each box with one verb:

- Extractor obtains form fields and evidence.
- Converter normalizes dates.
- Classifier assigns a policy level.
- Validator checks the form rules.
- Verifier compares the form with evidence.
- Summarizer prepares the approval facts.
- Translator or Localizer prepares the approver's representation.
- Router recommends the next approver from CSV policy data.

Emphasize that host code owns order, mapping, state, authorization, persistence,
notification, and side effects.

### 3:45–4:30 — Replace one component

Change one travel-policy fixture or one Blueprint version. Re-run that
Blueprint's evaluation, then the application test. Show that unrelated
Blueprint fixtures remain unchanged and that a failure identifies its Role,
node, version, input, and output.

### 4:30–5:00 — Close with the category

“Agent frameworks can execute a graph. POP defines the typed, tested cognitive
functions placed at its nodes. PixieCore is the TypeScript reference runtime;
the long-term contract is an open POP specification and conformance suite.”

End by showing how a third party creates and adds a ninth Blueprint. The target
authoring time is 30 minutes or less, measured with developers who have not used
PixieCore before.

## Claims that require evidence

- Accuracy claims require a versioned dataset and semantic comparison method.
- Cost and latency claims require provider/model and measurement conditions.
- Portability claims require an independent validator or runtime.
- Ease-of-use claims require external usability sessions.
- Ecosystem claims require external authors and published Blueprint packages.

Until those artifacts exist, describe them as roadmap goals rather than
completed PixieCore capabilities.

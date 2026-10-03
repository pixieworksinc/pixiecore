# Blueprint granularity guide

A Blueprint represents one independently meaningful cognitive operation. It is
closer to an interface method or typed function than to a complete application,
agent, or business workflow.

Read the [POP concepts and canonical glossary](../specification/pop-concepts.md) first for the
responsibility boundaries between Blueprint, Application, Role, Tool, Plugin,
and Orchestrator.

## Default boundary

Use this default when deciding whether behavior belongs in one Blueprint:

> One independently testable transformation from one declared input contract
> to one declared output contract.

The operation should normally have one primary verb, such as extract, classify,
summarize, validate, verify, convert, translate, or route. Supporting
instructions may be detailed, but every instruction must serve that one
operation.

Small does not mean trivial. An Extractor may recognize many document layouts,
and a Classifier may understand many city aliases. They remain one operation if
their only responsibility is producing one declared kind of result.

## Boundary test

A candidate is probably one Blueprint when all of these answers are yes:

1. Can its purpose be described with one primary verb and one object?
2. Is its output useful and understandable without running the next step?
3. Can expected results be asserted without observing unrelated side effects?
4. Can it be versioned or replaced without rewriting unrelated operations?
5. Can failures be attributed to this operation rather than an entire process?
6. Does its output schema describe one cohesive result?
7. Can the required context fit without including the application's complete
   history, persistence state, and routing logic?

Split the candidate when one or more answers are no.

## Recommended examples

The following are appropriately narrow starting points. Each row is a separate
Blueprint, even when several rows are combined into one application.

| # | Role family | One operation | Example input | Example output |
|---:|---|---|---|---|
| 1 | Extractor | Extract requested travel-form fields and evidence from one PDF or screenshot. | document plus requested field names | field values with source page and evidence text |
| 2 | Classifier | Classify one destination under one supplied travel policy. | city, country, and policy levels | normalized destination, level, and matched rule |
| 3 | Summarizer | Summarize one travel request for an approver under a length limit. | validated request facts | factual approval summary |
| 4 | Validator | Validate one web form against one supplied rule set. | form fields and validation rules | field-level validity and error codes |
| 5 | Verifier | Compare submitted form values with extracted document evidence. | submitted values and extracted evidence | matched, mismatched, and unverified fields |
| 6 | Converter | Convert one natural-language date to `yyyy-mm-dd`. | `2026年2月4日` | `2026-02-04` |
| 7 | Translator | Translate one travel justification while preserving names and numbers. | source text and target language | translated text and preserved terms |
| 8 | Localizer | Render one approved result for a target locale without changing its facts. | typed result and locale | localized display values |
| 9 | Router | Select the next approver from one CSV routing table. | normalized request and routing rows | next user and matched route rule |
| 10 | Extractor | Extract invoice number, date, currency, and total from one invoice. | invoice file | requested fields with evidence |
| 11 | Classifier | Classify one support request into a closed category list. | request text and category definitions | category and supporting reason |
| 12 | Verifier | Verify that one cited statement is supported by supplied source passages. | statement and passages | supported status and evidence references |
| 13 | Converter | Convert one monetary amount into a canonical decimal representation. | localized amount string and locale | decimal amount and currency code |
| 14 | Router | Choose one processing queue from a supplied routing policy. | normalized case facts and policy | queue ID and matched rule |

Examples 7 and 8 are separate when translation and locale-specific rendering
have independent contracts or tests. They may share a Role implementation, but
Role reuse does not require merging their Blueprints.

## Eight-Role travel application

A travel application can compose eight independent operations:

```text
Extractor:            obtain form fields and evidence from attachments
Converter:            normalize date expressions
Classifier:           classify destinations under the travel policy
Validator:            validate submitted web-form fields
Verifier:             compare submitted fields with document evidence
Summarizer:           produce an approval summary
Translator/Localizer: render the result for the approver's locale
Router/Orchestrator:  recommend the next approver from routing data
```

The host application owns their execution order, data mapping, authorization,
persistence, notifications, and side effects. Each Blueprint remains runnable
and testable without the complete application.

## Anti-patterns

### 1. Complete business process in one Blueprint

```text
Read the receipt, extract every field, classify the city, validate the form,
approve or reject the trip, email the manager, and update the expense system.
```

This combines extraction, classification, validation, decision policy,
notification, and persistence. Split each cognitive operation into a Blueprint;
keep side effects and process control in the application.

### 2. Universal document processor

```text
Accept any file, determine its business purpose, extract all useful data,
translate it, summarize it, detect fraud, and route it correctly.
```

The output cannot have one stable semantic contract. Create document-specific
or field-specific Extractors and compose them with separate Classifier,
Translator, Verifier, and Router operations.

### 3. Hidden workflow control inside the prompt

```text
If the destination is overseas, loop over every expense, ask for missing data,
retry twice, otherwise escalate, then continue from the previous process state.
```

Loops, retries, process state, and escalation ownership belong to application
composition. A Blueprint may return a typed recommendation such as
`requires_review`; it should not secretly operate the whole process.

### 4. Output schema as an application database

```text
Return the extracted document, approval history, translated messages, audit
records, routing queue, provider usage, and final persisted entity.
```

A schema containing unrelated lifecycle records signals multiple operations.
Define a cohesive output for each Blueprint and let the application own its
state model.

### 5. Unbounded autonomous agent

```text
Use any available tool until the company objective is achieved.
```

The operation has no bounded result, tool allowlist, stop condition, or
independent expected output. Replace it with explicit operations and
application-owned control.

### 6. Deterministic code disguised as reasoning

```text
Calculate a SHA-256 hash, add two integers, or check whether a parsed ISO date
is a valid leap-day value entirely through model reasoning.
```

Use ordinary code or a bounded Tool when the operation is already deterministic.
A Blueprint may first interpret ambiguous natural language, then pass the
canonical value to deterministic validation.

### 7. Role name used as the complete requirement

```yaml
role: validator
prompt: Validate everything and return the correct result.
```

A Role is a reusable execution strategy, not the operation's complete contract.
The Blueprint must still declare what is validated, under which supplied rules,
and what the typed result means.

## Data and side-effect rules

- Pass only the context needed for the current operation.
- Prefer stable IDs and typed values over an application's entire mutable state.
- Preserve evidence references when later operations must verify extracted facts.
- Return a recommendation before performing a side effect. Host code should
  authorize and execute email, approval, database, payment, or routing actions.
- Use a Tool for a bounded external lookup or deterministic operation needed
  during execution. Do not use a Tool to hide an unbounded application workflow.
- Treat a routing table, validation rule set, glossary, or category list as
  versioned input or policy data when it changes independently of the Blueprint.

## Testing rules

Every Blueprint should have its own fixtures and expected outputs. Report JSON
Schema validity separately from semantic correctness.

For each operation:

1. Test ordinary cases, boundaries, ambiguity, invalid input, and missing data.
2. Keep the provider/model configuration with live evaluation results.
3. Add every confirmed failure to the regression corpus.
4. Test deterministic tools independently from model behavior.
5. Test an application end to end in addition to, not instead of, Blueprint
   tests.

An application passing does not prove that each Blueprint is correct, and one
Blueprint failing should not make the source of failure impossible to identify.

## Review checklist

Before accepting a Blueprint, verify:

- [ ] Its name begins with one clear operation.
- [ ] Inputs contain only data required for that operation.
- [ ] The output schema has one cohesive meaning.
- [ ] Semantic expected results can be written independently.
- [ ] It has no hidden application state or unauthorized side effect.
- [ ] Routing, retry, persistence, and notification ownership is explicit.
- [ ] Deterministic work is delegated to code or a Tool where appropriate.
- [ ] It can be replaced without modifying unrelated Blueprint fixtures.
- [ ] Known unsupported inputs and ambiguity policy are documented.
- [ ] Its Role describes behavior but does not replace its operation contract.

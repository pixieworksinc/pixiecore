# Code-first application composition

`publication-brief.ts` is a concrete five-node TypeScript application. It uses
only the public `PromptRuntime` entry point and keeps workflow behavior out of
Blueprint YAML.

The application executes these independently usable Blueprints in order:

1. extract explicit facts;
2. classify the brief;
3. summarize the extracted facts;
4. validate the summary against those facts;
5. localize the validated publication output.

Run it from a PixieCore checkout with provider configuration already present:

```bash
npx tsx examples/application-composition/run.ts \
  'Release Orion adds a typed export for application developers.' \
  en-US
```

Each node also has a standalone dataset under `evaluations/`:

```bash
npx --package @pixieworks/pixiecore pixiecore blueprint eval \
  examples/application-composition/evaluations/extract-brief.yaml
```

The code owns sequencing, explicit mapping functions, cancellation, fail-fast
behavior, and one shared runtime. `PromptRuntime` continues to own validation,
provider calls, tool rounds, and bounded output-correction retries. This is an
example to copy and adapt, not a public workflow engine or declarative DSL.

## Eight-Role travel approval application

`travel-approval.ts` composes the packaged Extractor, Converter, Classifier,
Validator, Verifier, Summarizer, Translator / Localizer, and Router /
Orchestrator units. The Converter is intentionally executed twice because each
Blueprint call normalizes one independently testable date.

The application owns explicit mappings from extracted field names to verifier
evidence, canonical date boundaries, policy injection, domain stop conditions,
one shared runtime, cancellation, and fail-fast node identity. Every reference
Blueprint remains independently executable through its own colocated dataset.

This example recommends the next user but does not notify that user, approve a
request, persist workflow state, or define a general workflow DSL.

Both composers accept `traceId` and `onTrace` options. The callback receives a
versioned trace containing node identity, pinned Blueprint version, duration,
result, provider/model calls, and normalized token usage without raw business
inputs or model outputs.

Each node also declares `failureMode: 'fail-fast'` and
`retryOwner: 'runtime'` through `executeApplicationNode()`. This means the
composer never repeats a provider call; only `PromptRuntime` may perform its
bounded output-correction retry. Applications with independent branches can
instead select `recoverable`, retain successful outputs, and publish a
value-free partial result with `createApplicationPartialResult()`.

## Customer inquiry triage application

`customer-inquiry.ts` composes five inquiry-specific Blueprints: extraction,
classification, summarization, completeness validation, and policy-based
routing. Each Blueprint and its standalone evaluation dataset lives under
`customer-inquiry/`.

The host injects versioned classification and routing policies, maps only the
required fields, stops before routing when validation fails, and returns a
recommendation without notifying an owner or mutating a ticket system. The
example uses the same public schema-boundary, trace, failure-policy,
cancellation, and shared-runtime contracts as the other composers.

## Invoice review application

`invoice-review.ts` composes five business-document Blueprints: field
extraction, document classification, required-field and arithmetic validation,
ledger verification, and a review summary. Each unit and standalone dataset is
under `invoice-review/`.

Validation failures stop before ledger comparison. A matching result produces
only `ready_for_human_review`; it never approves payment, changes the ledger,
or hides those side effects inside a prompt.

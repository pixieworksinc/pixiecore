# Travel request Summarizer

This reference Blueprint turns one normalized travel request into a bounded,
factual summary for an approver. It covers only summarization: extraction,
validation, evidence comparison, translation, approval decisions, persistence,
and workflow routing remain separate operations.

## Contract

The application supplies a strict request object containing purpose, dates,
destinations, total cost, and approval notes. Every field is present in the
object; unavailable scalar or object values use `null`, and unavailable list
values use an empty array. `max_characters` is an integer from 40 through 500
and counts Unicode code points.

A successful result contains:

- `summary` and its `character_count`;
- one or more `claims`, each with text that appears in the summary and the
  exact source fields supporting it;
- `omitted_source_fields` for supplied facts excluded by the length limit;
- `missing_source_fields` for facts the application did not supply.

The source-field vocabulary is closed. A field must be represented by a claim,
reported as omitted, or reported as missing. When every field is unavailable,
the Blueprint returns `insufficient_facts` with no prose instead of inventing a
generic trip.

[`fixtures/travel-request-v1.yaml`](fixtures/travel-request-v1.yaml) is the
canonical complete request. The first evaluation case embeds that same object,
and the offline contract test checks exact equality to prevent fixture drift.

## Factuality boundary

The summary may paraphrase a supplied fact, but every resulting claim must cite
all source fields needed to support it. Dates, destination names, amounts, and
currencies are preserved. The Blueprint does not infer missing facts, state an
approval outcome, or add policy conclusions. It also preserves the language of
the source facts; translation and locale formatting belong to BPL-007.

JSON Schema can cap the absolute summary length at 500. The caller-selected
`max_characters` is a cross-field semantic condition, so the evaluation corpus
independently checks each expected Unicode count and selected limit. Consumers
that need a hard runtime guarantee should re-count the returned summary before
display or persistence.

## Evaluation

The eight-case dataset covers a complete request, constrained length with
explicit omissions, dates only, zero cost, Japanese source text, an approval
note only, destinations only, and a request with no usable facts. Its canonical
target is 8/8 deterministic traceability and schema passes. The comparator
allows alternate valid prose when the source-field partition, priority,
Unicode length, and claim coverage remain correct. It does not use an LLM judge
or present prose similarity as a semantic guarantee:

```bash
pixiecore blueprint eval \
  examples/blueprints/summarizer/travel-request-summary/evaluations/travel-request-summary.yaml \
  --seed=travel-summary-reference-1
```

The checked-in contract test uses the public runtime and evaluation exports
with an offline fixture provider. Live-provider evaluation is opt-in and must
record provider, model, model version, temperature, seed-equivalent setting,
execution time, dataset version, and result artifact before an accuracy claim
is made.

## Known non-supported inputs

- Raw PDFs, screenshots, unnormalized free-form applications, or evidence.
- Date, currency, or policy validation and normalization.
- Dynamic limits below 40 or above 500 Unicode code points.
- Translation, locale-specific number formatting, or terminology rewriting.
- Approval recommendations, risk scoring, notification, and next-user routing.
- A hard schema-level assertion that `character_count` equals the dynamic input
  limit; applications should enforce that final boundary independently.

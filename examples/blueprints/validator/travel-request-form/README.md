# Travel request form Validator

This reference Blueprint validates one normalized travel-request web form
against a versioned rule object supplied by the application. It returns one
result for every field and keeps field validity separate from the aggregate
`form_valid` value.

## Contract

The form envelope has seven fixed keys, but their values deliberately remain
untyped at the input-schema boundary. Invalid user values must reach the
Validator so it can return field-level errors instead of failing the runtime
envelope before evaluation.

The canonical rules cover:

- required values, including null and blank strings;
- string and numeric JSON types;
- employee ID, ISO date, and country-code formats;
- real Gregorian calendar dates;
- purpose length and inclusive estimated-cost bounds;
- an allowed currency set;
- start/end date order and domestic-country/currency correlation.

Each field result uses one of two strict schema branches: `valid: true` requires
an empty error list, while `valid: false` requires at least one typed error
code. `form_valid` is true only when all seven field results are valid. It is an
aggregate for convenience, not a replacement for field-specific feedback.

[`fixtures/travel-form-rules-v1.yaml`](fixtures/travel-form-rules-v1.yaml) is
embedded into every evaluation case. The contract test asserts exact equality
with the standalone fixture so rule changes cannot silently drift between test
cases.

## Evaluation

The nine-case dataset covers a valid foreign request, every required field,
wrong JSON types, independent format and calendar errors, reversed dates,
both cost boundaries, domestic currency mismatch, and a valid zero-cost
domestic request. Its canonical target is 9/9 exact schema and semantic passes:

```bash
pixiecore blueprint eval \
  examples/blueprints/validator/travel-request-form/evaluations/travel-request-form.yaml \
  --seed=travel-form-validator-reference-1
```

The checked-in test uses an offline fixture provider through the public runtime
and evaluation APIs. Incidental negative-test values come from the run-wide
seeded generator. Live-provider evaluation remains opt-in and must record the
provider, model, model version, temperature, seed-equivalent value, execution
time, dataset version, and result artifact.

## Boundary and non-supported behavior

This Blueprint reports validation facts only. It does not mutate or normalize
the form, extract attachments, compare evidence, approve travel, persist data,
or route a workflow.

The supplied patterns and rule relationships are trusted policy input. A
production form with stable machine-expressible rules should normally use a
deterministic validator at the application boundary. This reference unit
demonstrates the typed Validator Role contract; it must not be treated as a
security control without an independent deterministic enforcement layer.

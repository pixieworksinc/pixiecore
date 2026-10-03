# Travel document evidence Verifier

This reference Blueprint compares one set of normalized travel-form values
with one set of already extracted document values. It performs only
verification: extraction, normalization, validation, approval, persistence,
and routing remain separate operations.

## Contract

Six canonical fields are compared in a fixed order. Every extraction result is
one strict branch:

- `found` carries a typed value and page/text evidence;
- `not_found` carries neither a value nor evidence;
- `unreadable` carries no value but preserves page/text context.

Each output field is `matched`, `mismatched`, or `unverified`. A mismatch always
contains the submitted value, extracted value, and source evidence. An
unverified result distinguishes a missing submission, absent source field, and
unreadable source. It never turns insufficient evidence into a mismatch.

Strings and other non-numeric values use exact JSON value-and-type equality.
Two numeric values may match within the versioned absolute tolerance. No
trimming, case folding, parsing, translation, or normalization occurs inside
this Blueprint.

The aggregate `overall_status` uses explicit precedence: any mismatch produces
`mismatch`; otherwise any unverified field produces `incomplete`; all matched
fields produce `verified`.

The evaluation's first case embeds both
[`travel-document-evidence-v1.yaml`](fixtures/travel-document-evidence-v1.yaml)
and [`verification-policy-v1.yaml`](fixtures/verification-policy-v1.yaml). The
offline contract test checks those standalone fixtures for exact drift.

## Evaluation

The eight-case dataset covers exact matches, a numeric mismatch, a non-equal
numeric value within tolerance, absent source evidence, unreadable evidence,
a missing submitted value, mismatch precedence over incomplete evidence, and
complete source absence. Its canonical target is 8/8 exact schema and semantic
passes:

```bash
pixiecore blueprint eval \
  examples/blueprints/verifier/travel-document-evidence/evaluations/travel-document-evidence.yaml \
  --seed=travel-document-verifier-reference-1
```

The checked-in test uses only public runtime and evaluation APIs with an
offline fixture provider. Incidental negative-test data uses the run-wide seed.
Live-provider evaluation is opt-in and must preserve provider/model metadata,
temperature, seed-equivalent value, timestamps, dataset version, and artifacts.

## Known non-supported behavior

- Reading PDFs or screenshots directly; use an Extractor first.
- Parsing amount strings or normalizing dates, names, identifiers, or currency.
- Fuzzy, locale-aware, or case-insensitive comparison.
- Assigning a policy level, deciding whether a mismatch is acceptable, or
  approving the application.
- Persisting evidence, notifying users, or advancing the workflow.

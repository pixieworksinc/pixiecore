# Travel approval Router / Orchestrator

This reference Blueprint selects the next approval user from one caller-supplied
CSV routing table. It performs one routing decision and returns the matching
rule. It does not send a notification, approve or reject a request, update a
workflow engine, persist state, or execute downstream work.

## Routing contract

The application supplies normalized request facts, a semantic table version,
and CSV with this exact header:

```csv
rule_id,priority,rule_enabled,user_enabled,country_code,destination_level,amount_min,amount_max,currency,next_user
```

String conditions use exact matching; `*` is the only wildcard. Amount bounds
are inclusive, and `*` means unbounded. Disabled rules do not match. The lowest
numeric priority wins, independently of row order.

Four strict result branches make operational boundaries explicit:

- `routed`: one best-priority active rule targets an enabled user.
- `no_match`: no active row satisfies every condition.
- `ambiguous`: multiple rows share the best matching priority; all are returned.
- `unavailable`: the sole best row targets a disabled user. Lower-priority rows
  are not used as a silent fallback.

Every result retains `routing_table_version`. Successful and unavailable
results retain the exact row ID, priority, and user. Ambiguous results retain
every best-priority candidate in CSV order.

## Canonical table

[`fixtures/travel-approval-routing-v1.csv`](fixtures/travel-approval-routing-v1.csv)
covers domestic, Level A standard and high-cost, foreign default, same-priority
UK project, disabled-user, and disabled-rule behavior. The evaluation dataset
embeds the same bytes as a multiline input, and the offline test compares it to
the standalone CSV fixture to prevent drift.

## Evaluation

The eight-case dataset covers domestic, foreign, amount boundaries, priority,
no-match, same-priority ambiguity, disabled users, and disabled rules. Its
canonical target is 8/8 exact semantic and schema passes:

```bash
pixiecore blueprint eval \
  examples/blueprints/router/travel-approval-routing/evaluations/travel-approval-routing.yaml \
  --seed=travel-routing-reference-1
```

The checked-in test uses the public evaluation runner and an offline fixture
provider. A live provider comparison is opt-in and must record provider, model,
model version, temperature, seed-equivalent setting, execution time, dataset
version, and result artifact before making an accuracy claim.

## Known non-supported inputs

- CSV quoting, embedded commas/newlines, alternate delimiters, or columns not
  present in the documented header.
- Fuzzy, case-insensitive, range-unit, currency, or geographic normalization.
- Priority ties resolved by row order or by user seniority.
- Approval delegation, out-of-office lookup, notification, persistence, or
  mutation of the routing table.
- Falling back from a disabled best-priority user without an application-owned
  policy decision.

The application is responsible for CSV production and access control. It must
review table changes, keep rule IDs stable, and decide how to handle every
non-routed status.

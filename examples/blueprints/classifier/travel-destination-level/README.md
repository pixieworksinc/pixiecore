# Travel destination level Classifier

This reference Blueprint classifies one destination according to a versioned
travel policy supplied by the application. It does not own a global city list:
the policy defines special locations plus domestic and foreign defaults.

The unit performs one cognitive function. Extraction, address validation,
geocoding, expense calculation, currency conversion, approval routing, and
policy persistence remain separate responsibilities.

## Decision contract

The Classifier applies these rules in order:

1. Trim the city and compare it case-insensitively with policy canonical names
   and explicit aliases. No fuzzy or geographic matching is allowed.
2. If a country code is supplied, remove location candidates from other
   countries. If it is missing, never infer it.
3. One listed match returns that location's configured level and rule ID.
4. Multiple listed matches return every candidate as `ambiguous`.
5. No listed match with a country uses the domestic or foreign policy default.
6. No listed match without a country returns `unknown`, not a guessed level.

Every result records the exact `policy_version`. `classified`, `ambiguous`, and
`unknown` are separate strict JSON Schema branches, so an ambiguous result
cannot accidentally contain a selected level.

## Canonical policy

[`fixtures/travel-policy-v1.yaml`](fixtures/travel-policy-v1.yaml) defines:

- Level A: New York, San Francisco, Los Angeles, Chicago, London, and Paris,
  including explicit aliases such as `NYC`, `SF`, and `LA`.
- Level B: other foreign destinations by default.
- Level C: destinations in Japan by default.
- A same-name `Paris` in the United States to prove that a missing country is
  ambiguous instead of silently resolved to the better-known city.

The evaluation dataset embeds the same policy as input. The offline test
asserts exact equality with the standalone fixture to prevent drift.

## Evaluation

The 13-case dataset covers every named Level A city, unique aliases, domestic
and foreign defaults, Japanese cities, country-qualified same-name cities,
ambiguity, case/whitespace normalization, and an unknown location. Its
canonical target is 13/13 exact semantic and schema passes:

```bash
pixiecore blueprint eval \
  examples/blueprints/classifier/travel-destination-level/evaluations/travel-destination-level.yaml \
  --seed=destination-classifier-reference-1
```

The checked-in test uses the public evaluation runner and an offline fixture
provider. A live provider comparison is opt-in and must record provider, model,
model version, temperature, seed-equivalent setting, execution time, dataset
version, and result artifact before making an accuracy claim.

## Known non-supported inputs

- Fuzzy spellings, coordinates, airports, regions, or free-form postal
  addresses not explicitly represented by the policy.
- Country names in place of uppercase two-letter country codes.
- Inferring a country from language, popularity, timezone, or outside data.
- Resolving duplicate policy aliases by array order.
- Applying a policy that was not supplied in the current call.

Policy authors must keep IDs stable and review duplicate canonical names and
aliases deliberately. A future library contract may add broader ownership and
deprecation rules; this v1 unit does not invent them early.

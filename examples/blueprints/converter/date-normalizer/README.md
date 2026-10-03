# Explicit Gregorian date normalizer

This Converter Blueprint performs one cognitive operation: interpret one
explicit date expression and return a Gregorian `yyyy-mm-dd` value or a typed
reason for not converting it.

## Contract

Input:

```json
{ "date_text": "2026年2月4日" }
```

Successful output:

```json
{
  "status": "converted",
  "normalized_date": "2026-02-04",
  "reason_code": "none"
}
```

The v1 policy accepts explicit Gregorian dates written with Japanese
year/month/day markers, ISO `yyyy-mm-dd`, or an unambiguous four-digit
year-first numeric form. It trims surrounding whitespace and validates actual
Gregorian dates, including leap years.

It deliberately does not guess or silently convert:

- Japanese era years (`令和`, `平成`, or `昭和`);
- numeric forms with ambiguous month/day order;
- relative dates without a reference date;
- timestamps, UTC offsets, or timezone-bearing values;
- incomplete or impossible dates.

Those inputs return `invalid`, `ambiguous`, or `unsupported` with
`normalized_date: null`. A separate deterministic calendar tool may replace or
support this Blueprint when the accepted syntax is fully machine-defined.

## Execute and evaluate

```bash
npx --package @pixieworks/pixiecore pixiecore execute \
  examples/blueprints/converter/date-normalizer/date-normalizer.yaml \
  --inputs='{"date_text":"2026年2月4日"}'

npx --package @pixieworks/pixiecore pixiecore blueprint eval \
  examples/blueprints/converter/date-normalizer/evaluations/date-normalizer.yaml
```

The evaluation dataset keeps schema validity and semantic equality separate.
Its current release target is 100% exact semantic pass across all canonical
cases for any provider/model claimed as supported. Real-provider execution is
explicit and records provider, model, temperature, runner seed, hashes, and
timestamps in the evaluation artifact.

The offline contract test uses a fake provider and never requires paid
credentials. It verifies Blueprint loading, input/output enforcement, all
dataset cases, and same-seed evaluation replay. Known unsupported inputs remain
in the dataset instead of being inferred.

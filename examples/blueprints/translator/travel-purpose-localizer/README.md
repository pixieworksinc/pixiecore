# Travel purpose Translator / Localizer

This reference Blueprint translates one travel-purpose or approval-comment text
between English and Japanese and localizes it for `en-US` or `ja-JP`. It
performs one bounded language transformation. It does not summarize, add facts,
validate a request, route approval, or mutate application state.

## Preservation contract

The caller supplies protected terms classified as a person, organization,
place, identifier, or amount. Every exact, case-sensitive occurrence must be
copied byte-for-byte into the localized text. The result reports source and
output occurrence counts for each term, so the application can independently
check preservation instead of trusting a generic success flag.

Unprotected prose may be translated in a business-formal style. Only
unprotected locale-dependent punctuation, dates, or numbers may be reformatted,
and each material change is reported. Line-break count and order are preserved.

`localized` and `unchanged` are separate strict output branches. Same-language
text that needs no locale change is copied exactly and has an empty change
list. A translated result must identify at least one change.

## Canonical policy

[`fixtures/localization-policy-v1.yaml`](fixtures/localization-policy-v1.yaml)
pins exact case-sensitive term matching, line-break preservation,
business-formal style, and a 1,000-character output bound. Every evaluation case
embeds the same policy, and the offline test compares it with this standalone
fixture to prevent drift.

## Evaluation

The eight-case dataset covers both translation directions, same-language
identity, protected people, organizations, places, identifiers, amounts,
repeated terms, line breaks, and an input with no protected terms. Its canonical
target is 8/8 exact semantic and schema passes:

```bash
pixiecore blueprint eval \
  examples/blueprints/translator/travel-purpose-localizer/evaluations/travel-purpose-localizer.yaml \
  --seed=travel-localizer-reference-1
```

The checked-in test uses the public evaluation runner and an offline fixture
provider. A live provider comparison is opt-in and must record provider, model,
model version, temperature, seed-equivalent setting, execution time, dataset
version, and result artifact before making an accuracy claim.

## Known non-supported inputs

- Languages and locales outside `en`, `ja`, `en-US`, and `ja-JP`.
- Language detection, transliteration, glossary lookup, or fuzzy protected-term
  matching.
- Protected terms whose internal formatting is expected to change.
- Overlapping protected values whose occurrence boundaries require a tokenizer.
- Legal, cultural, or brand-review certification.

The application owns the protected-term list and must verify that important
values are included before relying on the localized result.

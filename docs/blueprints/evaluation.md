# Blueprint evaluation datasets

A PixieCore evaluation dataset records inputs, expected outputs, semantic
comparison policy, and tags for one versioned Blueprint target. The v1 format
is validated by the published JSON Schema at
`@pixieworks/pixiecore/eval/dataset-schema.json`.

Dataset validation fixes the shape of evaluation data. PixieCore executes the
dataset through `pixiecore blueprint eval` or `runBlueprintEvaluation()` and
publishes the result contract at `@pixieworks/pixiecore/eval/result-schema.json`.

Applications can import the comparison API from `@pixieworks/pixiecore/eval`:

```ts
import { compareEvaluationOutput } from '@pixieworks/pixiecore/eval';

const result = await compareEvaluationOutput(
  { date: '2026-02-04' },
  { date: '2026-02-04' },
  { mode: 'exact' },
);
```

## Seeded property corpus

`createEvaluationPropertyCorpus()` produces a versioned, JSON-only set of
date, amount, locale, Unicode, whitespace, and numeric-boundary cases. A seed
is required: the same seed and `casesPerKind` reproduce the exact artifact,
while another seed changes generated dates, amounts, Unicode suffixes, and case
IDs. Fixed Gregorian leap-year, zero/negative-cent, whitespace-family, and safe
integer boundary anchors ensure that random selection cannot omit core edges.

```ts
import { createEvaluationPropertyCorpus } from '@pixieworks/pixiecore/eval';

const corpus = createEvaluationPropertyCorpus({
  seed: process.env.TEST_SEED ?? 'documented-example',
  casesPerKind: 8,
});

const dateInputs = corpus.cases
  .filter(item => item.kind === 'date')
  .map(item => ({ date_text: item.value }));
```

The corpus supplies candidate values, not semantic expected outputs. A
Blueprint-specific dataset author must map each candidate into the Blueprint's
typed input and declare the expected result. The schema is published as
`@pixieworks/pixiecore/eval/property-corpus-schema.json`.

To execute a complete dataset from an application without writing an artifact
to disk:

```ts
import { runBlueprintEvaluation } from '@pixieworks/pixiecore/eval';

const artifact = await runBlueprintEvaluation({
  datasetPath: 'evaluations/date-converter.yaml',
  seed: 'release-candidate-1',
});
```

## CLI runner

```bash
pixiecore blueprint eval evaluations/date-converter.yaml
pixiecore blueprint eval evaluations/date-converter.yaml --seed=release-candidate-1
pixiecore blueprint eval evaluations/date-converter.yaml \
  --seed=release-candidate-1 \
  --output=artifacts/date-converter.json
```

Without `--output`, the complete result artifact is written to stdout and no
result file is created. File persistence requires the explicit option. A run
with any comparison failure or execution error exits with status `1` and writes
the Blueprint path/version, affected JSON Pointer fields when available,
same-seed replay command, and actionable correction suggestions to stderr.
Invalid command arguments exit with status `2`.

`blueprint play --mode=real` and `--mode=both` also exit with status `1` when
the real-provider result does not match the selected fixture. The JSON artifact
remains on stdout; the value-free diagnostic on stderr identifies the
Blueprint, differing fields, replay command, and next corrective action.

The runner seed identifies the run and is preserved in the artifact and replay
command. Its scope is recorded as `runner`; the current Provider contract does
not expose a universal model-decoding seed, so the value must not be presented
as proof that a remote model is deterministic.

## Real-provider usage and estimated cost

Every case produced by `runBlueprintEvaluation()` records `provider_usage`.
The real block produced by `runBlueprintPlayground()` does the same. Each
provider/model entry contains the call count, `input_tokens`, `output_tokens`,
`total_tokens`, estimated cost, cost status, and the pricing snapshot used for
the estimate. Mock playground executions do not contain provider accounting.

PixieCore includes one narrowly scoped default pricing snapshot for
`gpt-4.1-mini` when the configured provider is `openai` and the request uses
the official OpenAI API endpoint. The snapshot was verified on 2026-08-26 and
uses USD 0.40 per million input tokens and USD 1.60 per million output tokens.
The artifact retains those rates, their effective timestamp, and the official
pricing URL, so a later price change does not make an old estimate ambiguous.
All input tokens are charged at the standard input rate; cached-input discounts
are not inferred from the normalized Provider contract.

For another provider, model, or OpenAI-compatible endpoint, pass exact rules in
the `pricing` option. Explicit rules override the bundled rule for the same
provider/model pair:

```ts
const artifact = await runBlueprintEvaluation({
  datasetPath: 'evaluations/date-converter.yaml',
  pricing: [{
    provider: 'provider-name',
    model: 'model-name',
    currency: 'USD',
    inputPerMillionTokens: 1,
    outputPerMillionTokens: 4,
    source: 'https://provider.example/pricing',
    effectiveAt: '2026-08-26T00:00:00.000Z',
  }],
});
```

If the Provider omits complete usage, token fields and estimated cost are
`null` with `cost_status: 'missing_usage'`. Complete usage without an exact
pricing rule keeps the token values but records a null estimate with
`cost_status: 'missing_pricing'`. PixieCore does not guess either value.

## Opt-in provider/model benchmark

`runBlueprintBenchmark()` compares explicit provider/model targets over the
same dataset and repeated run count. It reports case accuracy, accuracy
standard deviation, mean/p50/p95 latency, token usage, and cost when the caller
supplies both complete provider usage and pricing. The versioned, value-free
artifact schema is published at `@pixieworks/pixiecore/eval/benchmark-schema.json`.

Each target must create a fresh explicit `Provider` instance for every run.
This makes remote execution and cost opt-in, prevents an environment default
from silently selecting a provider, and gives every target an independent
lifecycle. Provider/model identity must remain stable within one target.

```ts
import { createProvider } from '@pixieworks/pixiecore';
import { runBlueprintBenchmark } from '@pixieworks/pixiecore/eval';

const report = await runBlueprintBenchmark({
  datasetPath: 'evaluations/date-converter.yaml',
  runsPerTarget: 3,
  targets: [{
    id: 'openai-primary',
    pricing: {
      currency: 'USD',
      inputPerMillionTokens: 1,
      outputPerMillionTokens: 4,
    },
    createRuntimeOptions: () => ({
      provider: createProvider('openai', { model: 'configured-model' }),
      model: 'configured-model',
    }),
  }],
});
```

Pricing is caller-supplied because provider prices change independently of
PixieCore releases. A run without complete usage remains valid but publishes
`usage: null` and `cost: null`. Benchmark seeds identify dataset runs; they do
not claim control over remote model sampling.

## Reference quality regression gates

The eight repository-owned Role examples declare their canonical thresholds in
`examples/blueprints/quality-gates.yaml`. `npm run check:quality-gates`
requires exact coverage of the active Blueprint catalog, validates each
dataset/version pin and minimum case count, then runs all eight seeded offline
contract suites. CI executes this gate independently before the full test
suite.

The current threshold is 100% across 71 canonical cases, with zero comparison
failures and zero execution errors. This is a deterministic contract
regression claim: fixture Providers return declared expected outputs while the
tests verify prompt inputs, attachment handling, schema validation, and domain
guards. It is not a claim that a remote model achieves 100% accuracy. Real
provider quality must be measured with `runBlueprintBenchmark()` and reported
with provider, model, dataset version, run count, pricing source, and variance.

## Release scorecards

`renderBlueprintBenchmarkScorecard()` converts one value-free benchmark
artifact into stable Markdown. Publication metadata must include the release,
generation timestamp, exact reproduction command, and methodology. A pricing
source becomes mandatory whenever any target reports cost.

```ts
import { renderBlueprintBenchmarkScorecard } from '@pixieworks/pixiecore/eval';

const markdown = renderBlueprintBenchmarkScorecard(report, {
  release: '0.1.0',
  generatedAt: new Date().toISOString(),
  reproductionCommand: 'npm run benchmark:reference -- <explicit release options>',
  methodology: 'Exact and schema comparisons from the versioned dataset.',
  pricingSource: 'Provider price sheets captured on the generation date.',
});
```

Every percentage is rendered beside passed and total case counts, with dataset
and Blueprint hashes, runner seed, run count, provider/model identity,
variance, latency, usage, and cost. PixieCore does not ship a fabricated remote
provider scorecard or prior real-provider artifacts. The public quality catalog
contains deterministic offline-contract measurements only. A maintainer may
create a new local, value-free remote measurement through the bounded runner
after approving its provider, model, call ceiling, and budget.
The typechecked [reference release runner](../../examples/benchmarks/README.md)
provides the concrete opt-in command and refuses execution without explicit
remote-cost confirmation.

## Example

```yaml
schema: pixiecore.blueprint-eval-dataset/v1
name: Japanese date conversion
version: 1.0.0
description: Converts declared Japanese date expressions to ISO calendar dates.
blueprint:
  path: ../blueprints/date-converter.yaml
  version: '1.0'
tags: [converter, date, ja-JP]
cases:
  - id: japanese-long-date
    description: Converts a year-month-day expression without adding a timezone.
    tags: [ordinary]
    inputs:
      date_expression: 2026年2月4日
    expected_output:
      date: '2026-02-04'
    comparison:
      mode: exact
```

The Blueprint path is resolved relative to the dataset file. The runner rejects
absolute paths, lexical escapes, and symlinks that resolve outside the nearest
project root containing `package.json`. Without a project manifest, the dataset
directory is the permitted root. The optional Blueprint version asserts the
version expected by the dataset.

## Required dataset fields

| Field | Meaning |
|---|---|
| `schema` | Exact format identifier `pixiecore.blueprint-eval-dataset/v1`. |
| `name` | Human-readable dataset name. |
| `version` | Dataset SemVer, independent of the Blueprint version. |
| `blueprint.path` | Relative path to the Blueprint under evaluation. |
| `tags` | Dataset-level selection and reporting tags. |
| `cases` | One or more independently addressable evaluation cases. |

Each case requires a stable `id`, at least one tag, an `inputs` object, an
`expected_output` object, and one comparison policy. Case IDs must be unique in
the dataset; this semantic constraint is enforced by the runner because
JSON Schema cannot express property uniqueness across objects in an array.

Dataset and case tags are combined for selection and reporting. Tags describe
dimensions such as Role, language, ordinary input, ambiguity, boundary, or
known regression. They must not contain credentials or personal identifiers.

## Comparison policies

### `exact`

The actual JSON object must deeply equal `expected_output`. Object property
order is irrelevant; array order and duplicate values remain significant.

```yaml
comparison: { mode: exact }
```

### `schema`

The actual output and `expected_output` must both satisfy the Blueprint output
schema. Their semantic values are not compared. This mode measures structural
validity only and must never be presented as semantic accuracy.

```yaml
comparison: { mode: schema }
```

### `fields`

Only values selected by the listed RFC 6901 JSON Pointers are compared exactly.
Every pointer must exist in both actual and expected output.

```yaml
comparison:
  mode: fields
  pointers: [/date, /destination/level]
```

### `set`

Arrays at one JSON Pointer are compared as mathematical sets. Order and
duplicates are ignored. Use `exact` when multiplicity matters.

```yaml
comparison:
  mode: set
  pointer: /matched_fields
```

### `numeric_tolerance`

Numbers at the listed JSON Pointers are compared using an absolute tolerance,
a relative tolerance, or both. With both values present, the comparator
passes when the absolute difference is no greater than the larger permitted
difference: `max(absolute_tolerance, abs(expected) * relative_tolerance)`.

```yaml
comparison:
  mode: numeric_tolerance
  pointers: [/amount]
  absolute_tolerance: 0.01
  relative_tolerance: 0.001
```

### `custom`

A namespaced comparator ID selects explicitly registered trusted comparison
code. The dataset contains an ID and JSON configuration, never a module path or
executable source. An unregistered comparator is an evaluation configuration
error, not a failed case.

```yaml
comparison:
  mode: custom
  comparator: acme.travel-policy-v1
  config:
    require_evidence: true
```

An LLM judge can be implemented as a custom comparator only when its provider,
model, prompt, output schema, and evaluation result are recorded. Use a
deterministic comparator whenever possible.

Custom comparator code is registered by the application in a
`ReadonlyMap<string, EvaluationCustomComparator>` supplied to
`compareEvaluationOutput`. PixieCore reserves the `pixiecore.*` namespace for
built-in comparators and resolves those before an application map. The
comparator receives cloned actual, expected, configuration, and, when the
runner has it, case-input values so it cannot mutate caller evaluation data.

#### Built-in traceable summary comparator

`pixiecore.traceable-summary-v1` is a deterministic comparator for a bounded
summary with declared claims. It is not a general natural-language judge and
does not claim to determine whether two sentences mean the same thing. Its
configuration lists the closed source-field vocabulary and its priority order:

```yaml
comparison:
  mode: custom
  comparator: pixiecore.traceable-summary-v1
  config:
    source_fields: [request.purpose, request.start_date, request.end_date]
    priority: [request.purpose, request.start_date, request.end_date]
```

Given the case input, it verifies the following without a second provider call:

- `status`, `summary`, and `character_count` agree with the available source
  facts and the caller's Unicode character limit.
- Every listed source field appears exactly once across claim citations,
  omissions, and missing fields.
- Unavailable fields are reported as missing, supplied fields are not.
- A lower-priority field is not claimed while a higher-priority supplied field
  is omitted.
- Every claim is a literal substring of the returned summary, and every
  meaningful character in the summary is covered by a declared claim.

This permits alternate valid phrasing and omission boundaries while retaining
declared source-field attribution. It does not prove free-form paraphrase fidelity; a use case
that needs that claim must add a separately specified judge and record its
model evidence.

The traceable-summary and schema comparators emit the optional result metadata
`limitations: [factuality_not_evaluated]` on both passes and failures. This is
not an extra assertion and does not change their pass/fail rules. For example,
an input about travel to Tokyo and a claim about travel to Mars can pass the
traceable-summary structural checks when the claim cites a supplied field;
the limitation explicitly records that this is not evidence of factuality.
Case results, benchmark runs and targets, and value-free matrix checkpoints
retain the limitation. CLI and scorecard output call out the limited scope.
Benchmark `accuracy` fields retain their existing meaning and calculation:
the configured comparator pass rate, not a general factuality or hallucination
score. Older artifacts without `limitations` remain valid; an absent or empty
list does not establish factuality or imply an independent semantic review.

## Versioning

- Increment the dataset patch version when correcting metadata without changing
  expected outcomes.
- Increment the minor version when adding compatible cases or tags.
- Increment the major version when changing existing inputs, expected outputs,
  comparison meaning, or the declared evaluation domain.
- Pin the dataset content hash in a published result artifact so later changes
  cannot silently rewrite historical evidence.
- A Blueprint version and dataset version are separate and must both appear in
  evaluation results.

## Security and privacy

- Do not store provider credentials, access tokens, or executable comparator
  paths in a dataset.
- Use synthetic or explicitly authorized documents for committed fixtures.
- Treat attachment paths as untrusted input and resolve them within an allowed
  root before execution.
- Redact personal and confidential information before persisting result
  artifacts.
- A dataset does not authorize Tool side effects. Evaluation should use fake or
  read-only Tools unless an isolated environment explicitly permits otherwise.

## Result separation

The dataset records the question and expected answer. A result artifact records
what happened during a particular run, including dataset and Blueprint hashes,
provider/model configuration, time, runner seed, per-case latency, actual
output, comparison differences, and sanitized execution errors. Cost and model
version are not inferred when a Provider does not expose them. Keeping dataset
and result separate prevents transient execution data from changing the
evaluation contract.

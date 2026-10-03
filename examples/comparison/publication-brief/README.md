# Publication-brief adjacent-pattern comparison

The small `compare.ts` example sends one business input through two deliberately
different Blueprint shapes:

- `monolithic-publication-brief.yaml` performs extraction, classification,
  summarization, validation, and localization in one Blueprint execution.
- `compare.ts` also invokes the five independently testable Blueprints from the
  publication-brief reference application.

Build PixieCore, configure any supported provider as usual, and run:

```bash
npm run build
PIXIECORE_COMPARISON_SOURCE='Release Orion adds typed exports for operators.' \
PIXIECORE_COMPARISON_LOCALE='en-US' \
npx tsx examples/comparison/publication-brief/compare.ts
```

The output preserves both results and structural measurements. It does not
claim that one shape is automatically more accurate, faster, or cheaper.

## Reproducible four-approach benchmark

`benchmark.ts` extends the comparison to four executable approaches:

| Approach | Execution shape | Provider calls per case |
|---|---|---:|
| `pixiecore-composed` | Five independently testable PixieCore Blueprints composed by host code | 5 |
| `monolithic-prompt` | One combined Blueprint through the same PixieCore transport and schema boundary | 1 |
| `agent-graph` | One model-planned graph followed by five direct schema-constrained worker calls | 6 |
| `code-only` | A deterministic parser for explicitly labeled records | 0 |

All four receive the same four synthetic inputs and produce the same typed
publication-brief result. The public dataset uses deterministic field and term
assertions. A complete-case score requires every assertion to pass; assertion
accuracy also exposes partial correctness so one missing term does not turn an
otherwise useful result into an unexplained zero.

Inspect the exact plan without a provider call:

```bash
npm run benchmark:adjacent-patterns -- \
  --run-id=local-dry-run --seed=local-review --runs=3 --dry-run
```

Live execution is manual and refuses to start without explicit cost, key
rotation, call-cap, and budget confirmations. Choose the model, run ceiling,
and USD ceiling for the reviewed release, then retain the resulting value-free
report outside the source tree until it has passed the publication review.

The initial public snapshot intentionally contains no prior real-provider
scorecard or report. A published scorecard must identify its dataset, model,
run count, pricing source, and reproducible command.

This four-case corpus is intentionally narrow. It does not measure development
time or prove that one architecture is universally superior. In particular,
the code-only implementation supports the two labeled inputs and deliberately
rejects both prose inputs.

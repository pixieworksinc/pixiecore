# Reference Blueprint release benchmark

This runner turns the existing `runBlueprintBenchmark()` and scorecard APIs
into one reproducible release command. It is opt-in and refuses to contact a
provider unless `--confirm-remote-cost` is present. Credentials remain in the
provider's documented environment variables and are never accepted as command
arguments or written to the output artifacts.

Build and run one explicit provider/model target:

```bash
npm run build
npm run benchmark:reference -- \
  --dataset=examples/blueprints/converter/date-normalizer/evaluations/date-normalizer.yaml \
  --provider=openai \
  --model=configured-model \
  --runs=3 \
  --seed=release-0.1.0 \
  --release=0.1.0 \
  --artifact=benchmarks/results/date-normalizer.json \
  --scorecard=benchmarks/results/date-normalizer.md \
  --confirm-remote-cost
```

The command creates a fresh Provider instance for every run and disables MCP,
custom plugin discovery, retries, and file/console logging. Existing output
files are never overwritten. Add all four pricing options only when the exact
provider price sheet and effective date have been recorded:

```text
--currency=USD
--input-price=<per-million-input-tokens>
--output-price=<per-million-output-tokens>
--pricing-source=<source-and-effective-date>
```

Review the JSON artifact and Markdown scorecard before publication. A completed
command is still only one provider/model/dataset result and does not establish
general model quality. The initial public snapshot does not ship prior
real-provider evidence or link it from the quality catalog.

## OpenAI Blueprint matrix

`openai-blueprint-run-manifest.json` fixes the eight canonical Role datasets,
71 cases, attachment inventory, comparison modes, synthetic-data declaration,
model snapshot, pricing evidence, call ceilings, USD budget ceilings, and
artifact directories used by the staged OpenAI evaluation. Its colocated JSON
Schema and contract test detect drift from the actual datasets and fixtures.

The manifest is planning input, not permission to spend. A remote run still
requires the runner's explicit cost confirmation and an environment-provided
credential. Start with the one-call `canary` phase and proceed only when its
usage and pricing evidence are complete.

Inspect a phase without reading credentials or contacting OpenAI:

```bash
npm run build
npm run benchmark:openai -- \
  --phase=canary \
  --run-id=release-0.1.0-canary \
  --seed=release-0.1.0 \
  --source-revision=<reviewed-git-sha> \
  --dry-run
```

After reviewing the model, call ceiling, USD budget ceiling, and output path,
remove `--dry-run` and add both `--confirm-remote-cost` and
`--confirm-key-rotated`, plus explicit `--max-calls` and `--max-budget-usd`
ceilings no greater than the reviewed manifest phase. Live execution accepts
only the official OpenAI API endpoint and the model snapshot allowlisted in the
runner. It runs serially with retry disabled, refuses an existing run
directory, and atomically updates a value-free checkpoint after every
completed dataset.

New checkpoints bind the source revision, dataset and Blueprint versions,
SHA-256 source identities, and the effective comparison-policy identity. Legacy
v1 checkpoints and their reports remain historical evidence; the report command
does not regenerate them from newer dataset files.

Repository maintainers can also dispatch `.github/workflows/openai-blueprint-evaluation.yml`.
The `openai-live` GitHub environment must require reviewer approval and contain
the rotated `OPENAI_API_KEY` secret. The workflow has no push, pull-request, or
schedule trigger, serializes all live runs, requires operator call and budget
ceilings, and retains value-free checkpoints for 14 days.

# Evidence-admitted deterministic execution

PixieCore can promote a repeatedly measured Blueprint execution to a small,
deterministic data program. This path is optional. It is intended for narrow
operations such as field projection, arithmetic, lookup, comparison, and
formatting after those operations have been shown to preserve the expected
and model outputs.

Despite the `jit` package name, PixieCore does not execute generated JavaScript,
Wasm, shell commands, module paths, or source strings. A candidate is JSON data
using a closed expression vocabulary. The validator rejects unknown fields,
unknown operations, dangerous object keys, non-JSON values, and configured
size or depth excesses before interpretation.

## Boundary

The workflow has two separate parts:

1. An offline tool or author proposes a `JitProgram`. PixieCore does not infer a
   candidate from a prompt or silently compile a Blueprint.
2. `runJitAdmission()` measures the candidate against a versioned evaluation
   dataset and an explicitly supplied model execution callback.

Admission succeeds only when every run of every case:

- satisfies the case's evaluation comparison policy;
- exactly equals the model output as JSON;
- satisfies the Blueprint output schema; and
- completes without program or model errors.

Zero cases, partial agreement, a measurement error, or an invalid output
refuses promotion. The report stores case IDs, counts, JSON Pointer locations,
reason codes, provider/model identity, seed, timestamps, and digests. It does
not store input, expected, program, or model values.

## Program example

```ts
import type { JitProgram } from '@pixieworks/pixiecore/jit';
import { validateJitProgram } from '@pixieworks/pixiecore/jit';

const candidate: JitProgram = {
  outputs: {
    total: {
      kind: 'arithmetic',
      op: 'multiply',
      left: { kind: 'input', name: 'quantity' },
      right: { kind: 'input', name: 'unit_price' },
    },
  },
};

const program = validateJitProgram(candidate);
```

The complete vocabulary and its portable JSON contract are available as
`@pixieworks/pixiecore/jit` and `@pixieworks/pixiecore/jit/program-schema.json`.

## Measure and create a promotion

```ts
import {
  createJitPromotion,
  createJitPromotionFile,
  runJitAdmission,
  writeJitPromotionFile,
} from '@pixieworks/pixiecore/jit';

const report = await runJitAdmission({
  blueprint,
  dataset,
  program,
  provider: 'openai',
  model: 'gpt-4o-mini',
  runs: 3,
  seed: process.env.TEST_SEED ?? 'release-candidate-1',
  async executeModel(inputs, context) {
    // Call the ordinary Blueprint/model path here. Pass context.signal to the
    // provider and use context.seed when the provider supports seeded output.
    return executeThroughModel(inputs, context);
  },
});

if (!report.promoted) {
  throw new Error(`Promotion refused: ${report.refusal_reason}`);
}

const promotion = createJitPromotion(report, blueprint, program);
await writeJitPromotionFile(
  './artifacts/pixiecore-promotions.json',
  createJitPromotionFile([promotion]),
);
```

Use the same Blueprint, dataset, program, provider/model, `runs`, and `seed` to
replay a measurement. The callback receives that seed on every run. Provider
determinism remains provider-specific, so a provider that cannot honor a seed
can still be measured repeatedly but cannot promise bit-for-bit replay by seed
alone.

Published artifact schemas:

- `@pixieworks/pixiecore/jit/admission-report-schema.json`
- `@pixieworks/pixiecore/jit/promotions-schema.json`

## Enable the deterministic path

```ts
import { PromptRuntime } from '@pixieworks/pixiecore';

await using runtime = new PromptRuntime({
  promotionsPath: './artifacts/pixiecore-promotions.json',
  onJitEvent(event) {
    console.log(event.status, event.reason, event.artifact);
  },
});
```

Omitting `promotionsPath`, or setting it to `null` or `'disabled'`, leaves the
ordinary model path unchanged. A promotion is selected only when Blueprint
name, version, source digest, model, and program digest remain valid. A missing,
invalid, stale, or model-mismatched artifact falls back to the model path.

The deterministic path still applies permission checks, input validation,
before/after decorators, and output validation. Its audit and observation
events identify status and digests without retaining Blueprint inputs or
outputs. A runtime interpretation error also falls back to the model path.

## Operational rules

- Keep generated reports and promotion files in an artifact store with normal
  access control and retention policy. They are evidence, not source code.
- Re-run admission whenever the Blueprint, dataset, model, candidate program,
  or relevant provider behavior changes.
- Do not hand-edit promotion files. Regenerate them from an admission report.
- Treat a high agreement rate below 100 percent as refusal, not as permission
  to route a fraction of production traffic through the deterministic path.
- Use ordinary Blueprint evaluation and provider telemetry for quality and cost
  analysis. JIT admission proves only the declared dataset/model agreement.

# Execution telemetry

PixieCore publishes one value-free telemetry contract for standalone Blueprint
executions and application nodes. Import it from `@pixieworks/pixiecore/telemetry`; the JSON
Schema is available as `@pixieworks/pixiecore/telemetry/schema.json`.

## Unit boundary

`ExecutionTelemetryRecorder.runUnit()` records either:

- `unitType: 'blueprint'` for one independently executed Blueprint; or
- `unitType: 'node'` for one Blueprint invocation inside an application.

Each unit has a stable ID and pinned Blueprint version. The recorder aggregates
explicit attempts of the same unit, runtime output-correction retries,
provider/model calls, normalized token usage, duration, final result, failure
count, and value-free error codes. Application and host retries must pass their
one-based `attempt` and `retryOwner`; gaps and duplicate attempts are rejected.

The recorder gives each active unit a child trace ID. This prevents concurrent
units sharing a logger from attributing each other's provider calls.

## Usage and cost

Provider responses may report input, output, and total tokens. PixieCore never
estimates a missing token category. Aggregate token totals include only
complete provider usage and carry `token_complete: false` when any observed
call is incomplete. Each provider/model record therefore has
one of these cost states:

- `calculated`: complete usage and one exact pricing rule were supplied;
- `missing_usage`: at least one token category was unavailable; or
- `missing_pricing`: usage was complete but no exact pricing rule matched.

Pricing is caller-owned and must identify provider, model, currency, input and
output price per million tokens, a source, and an RFC 3339 UTC effective time.
Duplicate provider/model rules are rejected. Costs are kept as separate totals
per currency and are never converted with an implicit exchange rate.

The telemetry recorder itself never downloads or infers pricing. Evaluation
helpers may supply a documented, versioned pricing snapshot for a narrowly
identified official provider/model combination. The resulting artifact keeps
that complete snapshot. Callers must still supply pricing for every other
provider, model, or compatible endpoint.

`cost_complete` is true only when every observed provider/model call has both
complete usage and matching pricing. A deterministic unit with no provider
call has zero tokens, no currency total, and complete zero cost.

## Retry and failure semantics

Retry counts preserve their owner:

- `runtime` is emitted when `PromptRuntime` schedules another bounded output
  correction attempt;
- `application` is counted from a later explicit application-owned attempt;
  and
- `host` is counted from a later explicit host-owned attempt.

A failed attempt followed by success remains in `failure_count` and
`error_codes`, while the unit's final `result` is `succeeded`. Cancellation is
distinct from failure and is not counted as a retry. Raw inputs, outputs,
prompts, exception messages, credentials, and pricing credentials never enter
the artifact.

## Example

```ts
import { PromptRuntime } from '@pixieworks/pixiecore';
import { ExecutionTelemetryRecorder } from '@pixieworks/pixiecore/telemetry';

const runtime = new PromptRuntime();
const recorder = new ExecutionTelemetryRecorder({
  pricing: [{
    provider: runtime.providerName,
    model: runtime.model,
    currency: 'USD',
    inputPerMillionTokens: 1,
    outputPerMillionTokens: 4,
    source: 'https://provider.example/pricing',
    effectiveAt: '2026-08-25T00:00:00.000Z',
  }],
});

try {
  await recorder.runUnit({
    unitType: 'blueprint',
    unitId: 'example.date_converter',
    blueprintVersion: '1.0.0',
    retryOwner: 'runtime',
    logger: runtime.logger,
  }, () => runtime.execute('date-converter.yaml', {
    date_text: '2026-08-25',
  }));
} finally {
  await runtime.close();
}

const telemetry = recorder.finish();
```

The host decides where the frozen JSON artifact is exported, retained, or
discarded. Apply the [`@pixieworks/pixiecore/data-policy`](data-policy.md) boundary before
persisting telemetry or any Blueprint value.
